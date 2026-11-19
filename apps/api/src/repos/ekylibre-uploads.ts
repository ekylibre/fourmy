import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { migrate } from "@fourmy/migrator-ekylibre";
import type { ImportRunView } from "@fourmy/contracts";
import { dropSourceDatabase, restoreDump, type RestoreReport } from "../ekylibre/restore.js";
import { zipEntryStream, zipEntryText, zipFileEntries, ZipFileError } from "../ekylibre/zip-file.js";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";
import { finishEkylibreImport } from "./imports.js";
import { readRun } from "./file-imports.js";

/**
 * Reprise d'Ekylibre depuis une sauvegarde de tenant déposée dans
 * l'interface (assistant « Mes fichiers », lot IM6) :
 *
 * 1. l'API reçoit le zip **en flux** (2 Go au plus), l'écrit sur le volume
 *    partagé avec le worker, vérifie que c'est une sauvegarde de tenant
 *    (`manifest.yml`, `<tenant>.sql`) et crée l'import « en cours »
 *    (`report.phase = queued`) ;
 * 2. le worker restaure le dump dans une base jetable (`ekylibre/restore.ts` :
 *    rôle restreint, liste blanche), puis l'import passe « à valider »
 *    (`analyzed`, `phase = restored`) ;
 * 3. la validation (`POST /imports/:id/apply`) le remet en file
 *    (`phase = migrate-queued`) ; le worker lance la migration existante
 *    (`@fourmy/migrator-ekylibre`), puis supprime la base et le fichier ;
 * 4. abandon ou échec : le worker supprime la base et le fichier.
 */

export const EKYLIBRE_MAX_BYTES = 2 * 1024 ** 3;
export const EKYLIBRE_SOURCE_PREFIX = "ekylibre-file:";

export const uploadsDir = () => process.env.FOURMY_EKYLIBRE_UPLOADS_DIR ?? join(tmpdir(), "fourmy-ekylibre-uploads");
const fileOf = (runId: string) => join(uploadsDir(), `${runId}.zip`);
const sourceDbOf = (runId: string) => `ekylibre_src_up_${runId.replace(/-/g, "").slice(0, 16)}`;

export class EkylibreUploadsNotConfigured extends Error {}
export class TooLarge extends Error {}

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

function adminUrl(): string {
  const url = process.env.EKYLIBRE_SOURCES_URL;
  if (!url) throw new EkylibreUploadsNotConfigured("Reprise d'Ekylibre non configurée (EKYLIBRE_SOURCES_URL).");
  return url;
}

/** Sauvegarde de tenant : manifeste, tenant, version, entrée du dump. */
export async function inspectBackup(path: string) {
  let entries;
  try {
    entries = await zipFileEntries(path);
  } catch (e) {
    throw new BadRequest(`Sauvegarde illisible : ${e instanceof ZipFileError ? e.message : "archive zip attendue."}`);
  }
  const manifestEntry = entries.find((e) => e.name === "manifest.yml");
  if (!manifestEntry) throw new BadRequest("Ce zip n'est pas une sauvegarde de tenant Ekylibre (manifest.yml absent).");
  const manifest = await zipEntryText(path, manifestEntry);
  const field = (k: string) => new RegExp(`^${k}: *(.*)$`, "m").exec(manifest)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || null;
  const tenant = field("tenant");
  if (!tenant || !/^[a-z0-9_-]{1,63}$/i.test(tenant)) throw new BadRequest("Sauvegarde Ekylibre : tenant illisible dans manifest.yml.");
  const formatVersion = field("format_version");
  if (formatVersion !== "3") throw new BadRequest(`Sauvegarde Ekylibre au format ${formatVersion ?? "inconnu"} : seul le format 3 est pris en charge.`);
  const dump = entries.find((e) => e.name === `${tenant}.sql`);
  if (!dump) throw new BadRequest(`Sauvegarde Ekylibre incomplète : ${tenant}.sql absent.`);
  return { tenant, databaseVersion: field("database_version"), dump, dumpBytes: dump.size };
}

/** Réception du zip (corps brut de la requête) et création de l'import. */
export async function receiveEkylibreBackup(
  db: Database,
  farmId: string,
  userId: string,
  name: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<ImportRunView> {
  adminUrl();
  if (!body) throw new BadRequest("Corps de requête vide : le zip est attendu tel quel (application/zip).");
  await withFarm(db, farmId, async (tx) => {
    const running = await rows(tx, sql`SELECT id FROM import_runs WHERE status = 'running' AND started_at > now() - interval '6 hours'`);
    if (running.length) throw new Conflict("Un import est déjà en cours pour cette ferme.");
  });
  const runId = crypto.randomUUID();
  const path = fileOf(runId);
  await mkdir(uploadsDir(), { recursive: true });
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > EKYLIBRE_MAX_BYTES) done(new TooLarge("Sauvegarde trop volumineuse : 2 Go au plus."));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as never), limit, createWriteStream(path, { mode: 0o600 }));
    const backup = await inspectBackup(path);
    return await withFarm(db, farmId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO import_runs (id, farm_id, source, status, created_by, report)
        VALUES (${runId}, ${farmId}, ${`${EKYLIBRE_SOURCE_PREFIX}${backup.tenant}`}, 'running', ${userId},
                ${JSON.stringify({ phase: "queued", file: { name: name.slice(0, 200), size }, tenant: backup.tenant, databaseVersion: backup.databaseVersion })}::jsonb)`);
      return readRun(tx, runId);
    });
  } catch (e) {
    await rm(path, { force: true });
    throw e;
  }
}

/** Validation d'une sauvegarde restaurée : la migration passe en file pour le worker. */
export async function queueEkylibreMigration(db: Database, farmId: string, runId: string): Promise<ImportRunView> {
  return withFarm(db, farmId, async (tx) => {
    const [run] = await rows<{ status: string; source: string }>(tx, sql`SELECT status, source FROM import_runs WHERE id = ${runId} FOR UPDATE`);
    if (!run?.source.startsWith(EKYLIBRE_SOURCE_PREFIX)) throw new NotFound(`Import ${runId} introuvable.`);
    if (run.status !== "analyzed") throw new Conflict(`Cet import n'est plus modifiable (état : ${run.status}).`);
    const running = await rows(tx, sql`SELECT id FROM import_runs WHERE status = 'running' AND id <> ${runId} AND started_at > now() - interval '6 hours'`);
    if (running.length) throw new Conflict("Un autre import est en cours pour cette ferme.");
    await tx.execute(sql`
      UPDATE import_runs SET status = 'running', report = report || '{"phase": "migrate-queued"}'::jsonb WHERE id = ${runId}`);
    return readRun(tx, runId);
  });
}

// --- Worker ----------------------------------------------------------------------------

const setReport = (db: Database, runId: string, patch: Record<string, unknown>, status?: string) =>
  db.execute(sql`
    UPDATE import_runs SET report = coalesce(report, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
      ${status ? sql`, status = ${status}` : sql``}${status === "failed" || status === "completed" ? sql`, finished_at = now()` : sql``}
    WHERE id = ${runId}`);

/** Prend en charge une tâche (connexion propriétaire, hors RLS : toutes fermes). */
async function claim(db: Database, phase: string, next: string) {
  const [r] = (await db.execute(sql`
    UPDATE import_runs SET report = report || ${JSON.stringify({ phase: next })}::jsonb
    WHERE id = (SELECT id FROM import_runs WHERE source LIKE ${`${EKYLIBRE_SOURCE_PREFIX}%`} AND status = 'running' AND report->>'phase' = ${phase}
                ORDER BY started_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, farm_id, report`)) as unknown as { id: string; farm_id: string; report: Record<string, unknown> }[];
  return r ?? null;
}

async function cleanup(runId: string): Promise<void> {
  await dropSourceDatabase(adminUrl(), sourceDbOf(runId)).catch((e: unknown) => console.warn(`[worker] base ${sourceDbOf(runId)} non supprimée :`, e));
  await rm(fileOf(runId), { force: true });
}

/** Restauration d'une sauvegarde déposée. */
async function restoreOne(db: Database): Promise<boolean> {
  const run = await claim(db, "queued", "restoring");
  if (!run) return false;
  const tenant = String(run.report.tenant);
  try {
    const path = fileOf(run.id);
    await stat(path).catch(() => {
      throw new Error("fichier de la sauvegarde introuvable sur le serveur (volume partagé entre l'API et le worker ?)");
    });
    const backup = await inspectBackup(path);
    let lastSaved = Date.now();
    const report: RestoreReport = await restoreDump(adminUrl(), sourceDbOf(run.id), tenant, await zipEntryStream(path, backup.dump), (bytes) => {
      if (Date.now() - lastSaved < 5000) return;
      lastSaved = Date.now();
      void setReport(db, run.id, { progress: Math.min(99, Math.round((bytes / Math.max(1, backup.dumpBytes)) * 100)) });
    });
    await setReport(db, run.id, { phase: "restored", progress: 100, restore: report }, "analyzed");
    console.log(`[worker] sauvegarde Ekylibre ${tenant} restaurée (${report.copiedRows} lignes, ${report.errors} erreurs)`);
  } catch (e) {
    console.error(`[worker] restauration Ekylibre ${tenant} en échec :`, e);
    await setReport(db, run.id, { phase: "cleaned", error: `Restauration impossible : ${e instanceof Error ? e.message : String(e)}` }, "failed");
    await cleanup(run.id);
  }
  return true;
}

/** Migration d'une sauvegarde restaurée et validée. */
async function migrateOne(db: Database): Promise<boolean> {
  const run = await claim(db, "migrate-queued", "migrating");
  if (!run) return false;
  const tenant = String(run.report.tenant);
  const keep = { file: run.report.file, tenant, restore: run.report.restore, phase: "cleaned" };
  const url = new URL(adminUrl());
  url.pathname = `/${sourceDbOf(run.id)}`;
  try {
    const report = await migrate({ sourceUrl: url.toString(), targetUrl: process.env.DATABASE_URL!, farmId: run.farm_id, runId: run.id, tenant });
    await finishEkylibreImport(db, run.farm_id, run.id, report.secrets);
    await setReport(db, run.id, keep);
  } catch (e) {
    console.error(`[worker] migration Ekylibre ${tenant} en échec :`, e);
    await setReport(db, run.id, { ...keep, error: String(e) }, "failed");
  } finally {
    await cleanup(run.id);
  }
  return true;
}

/** Bases et fichiers des imports abandonnés ou échoués, pas encore nettoyés. */
async function cleanupStale(db: Database): Promise<void> {
  const stale = (await db.execute(sql`
    SELECT id FROM import_runs WHERE source LIKE ${`${EKYLIBRE_SOURCE_PREFIX}%`} AND status IN ('discarded', 'failed')
      AND coalesce(report->>'phase', '') <> 'cleaned'`)) as unknown as { id: string }[];
  for (const { id } of stale) {
    await cleanup(id);
    await setReport(db, id, { phase: "cleaned" });
  }
}

let busy = false;
/**
 * Tâches de la reprise d'Ekylibre, pour le worker : une à la fois, en tâche de
 * fond (une grosse sauvegarde se restaure en plusieurs minutes, les autres
 * tâches du worker continuent).
 */
export function ekylibreUploadsTick(db: Database): void {
  if (busy || !process.env.EKYLIBRE_SOURCES_URL) return;
  busy = true;
  void (async () => {
    try {
      await cleanupStale(db);
      if (!(await restoreOne(db))) await migrateOne(db);
    } catch (e) {
      console.error("[worker] reprise Ekylibre :", e);
    } finally {
      busy = false;
    }
  })();
}

/** Pour les tests : exécute les tâches en attente jusqu'au bout. */
export async function runEkylibreUploadJobs(db: Database): Promise<void> {
  await cleanupStale(db);
  while ((await restoreOne(db)) || (await migrateOne(db))) {
    /* tâche suivante */
  }
}
