import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { importDecisions, type ImportDecisions, type ImportRunView } from "@fourmy/contracts";
import { analyzeFile, buildPreview } from "@fourmy/importers";
import { Conflict, NotFound } from "../routes/helpers.js";

/**
 * Imports de fichiers DAPLOS, Geofolia, TelePAC, lot IM1
 * (claudedocs/conception_import_onboarding.md §7.1) : dépôt, analyse,
 * décisions, abandon. Rien n'est écrit dans les données de la ferme avant
 * l'écriture (lot IM2) : seulement le fichier et son suivi.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

const VIEW = sql`
  SELECT r.id, r.source, r.format, r.status, r.started_at, r.finished_at, r.preview, r.decisions, r.report,
         f.name AS file_name, f.size AS file_size, f.sha256 AS file_sha256, f.uploaded_at, f.expires_at
  FROM import_runs r LEFT JOIN import_files f ON f.id = r.file_id`;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Vue d'un import (fichier ou reprise Ekylibre) depuis une ligne de `VIEW`. */
export function toRunView(r: Record<string, unknown>): ImportRunView {
  const decisions = importDecisions.safeParse(r.decisions ?? {});
  return {
    id: r.id as string,
    source: r.source as string,
    format: (r.format as ImportRunView["format"]) ?? null,
    status: r.status as ImportRunView["status"],
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    file: r.file_name
      ? {
          name: r.file_name as string,
          size: Number(r.file_size),
          sha256: r.file_sha256 as string,
          uploadedAt: iso(r.uploaded_at)!,
          expiresAt: iso(r.expires_at)!,
        }
      : null,
    preview: (r.preview as ImportRunView["preview"]) ?? null,
    decisions: decisions.success ? decisions.data : {},
    report: r.report ?? null,
  };
}

export async function readRun(tx: Tx, id: string): Promise<ImportRunView> {
  const [row] = await rows<Record<string, unknown>>(tx, sql`${VIEW} WHERE r.id = ${id}`);
  if (!row) throw new NotFound(`Import ${id} introuvable.`);
  return toRunView(row);
}

/** Imports de la ferme, du plus récent au plus ancien. */
export async function listRuns(db: Database, farmId: string, limit = 50): Promise<ImportRunView[]> {
  return withFarm(db, farmId, async (tx) => (await rows<Record<string, unknown>>(tx, sql`${VIEW} ORDER BY r.started_at DESC LIMIT ${limit}`)).map(toRunView));
}

export async function getRun(db: Database, farmId: string, id: string): Promise<ImportRunView> {
  return withFarm(db, farmId, (tx) => readRun(tx, id));
}

/** Nom affichable d'un fichier déposé : sans dossier ni caractère de contrôle, 255 caractères au plus. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return clean || "fichier";
}

async function farmSiret(tx: Tx, farmId: string): Promise<string | null> {
  const [farm] = await rows<{ siret: string | null }>(tx, sql`SELECT siret FROM farms WHERE id = ${farmId}`);
  return farm?.siret ?? null;
}

/**
 * Dépôt d'un fichier : format reconnu et fichier lu avant tout écrit
 * (un fichier refusé ne laisse rien), puis fichier stocké (un même contenu
 * n'est stocké qu'une fois par ferme, son expiration repoussée) et import
 * « analysé ». Redéposer un fichier dont l'analyse est en attente reprend
 * cette analyse et ses décisions.
 */
export async function analyzeUpload(
  db: Database,
  farmId: string,
  userId: string,
  upload: { name: string; bytes: Uint8Array },
): Promise<{ run: ImportRunView; created: boolean }> {
  const name = cleanFileName(upload.name);
  const analysis = analyzeFile(name, upload.bytes);
  const sha256 = createHash("sha256").update(upload.bytes).digest("hex");

  return withFarm(db, farmId, async (tx) => {
    const [file] = await rows<{ id: string }>(
      tx,
      sql`
        INSERT INTO import_files (id, farm_id, format, name, size, sha256, bytes, uploaded_by)
        VALUES (${randomUUID()}, ${farmId}, ${analysis.format}, ${name}, ${upload.bytes.length}, ${sha256},
                ${Buffer.from(upload.bytes)}, ${userId})
        ON CONFLICT (farm_id, sha256) DO UPDATE
          SET name = excluded.name, uploaded_by = excluded.uploaded_by, uploaded_at = now(),
              expires_at = now() + interval '30 days'
        RETURNING id`,
    );
    const [pending] = await rows<{ id: string; decisions: unknown }>(
      tx,
      sql`SELECT id, decisions FROM import_runs WHERE file_id = ${file!.id} AND status = 'analyzed' ORDER BY started_at DESC LIMIT 1`,
    );
    const parsed = importDecisions.safeParse(pending?.decisions ?? {});
    const decisions = parsed.success ? parsed.data : {};
    const preview = buildPreview(analysis, { fileName: name, farmSiret: await farmSiret(tx, farmId), decisions });

    if (pending) {
      await tx.execute(sql`UPDATE import_runs SET preview = ${JSON.stringify(preview)}::jsonb WHERE id = ${pending.id}`);
      return { run: await readRun(tx, pending.id), created: false };
    }
    const id = randomUUID();
    await tx.execute(sql`
      INSERT INTO import_runs (id, farm_id, source, status, file_id, format, preview, created_by)
      VALUES (${id}, ${farmId}, ${`file:${analysis.format}`}, 'analyzed', ${file!.id}, ${analysis.format},
              ${JSON.stringify(preview)}::jsonb, ${userId})`);
    return { run: await readRun(tx, id), created: true };
  });
}

/** Import encore modifiable (analysé) et son fichier, sinon erreur explicite. */
async function pendingRun(tx: Tx, id: string): Promise<{ status: string; file_id: string | null }> {
  const [run] = await rows<{ status: string; file_id: string | null; source: string }>(
    tx,
    sql`SELECT status, file_id, source FROM import_runs WHERE id = ${id} FOR UPDATE`,
  );
  if (!run || !run.source.startsWith("file:")) throw new NotFound(`Import ${id} introuvable.`);
  if (run.status !== "analyzed") throw new Conflict(`Cet import n'est plus modifiable (état : ${run.status}).`);
  return run;
}

/**
 * Décisions de l'utilisateur (remplacent les précédentes) ; l'aperçu est
 * recalculé depuis le fichier, qui doit être encore là.
 */
export async function saveDecisions(db: Database, farmId: string, id: string, decisions: ImportDecisions): Promise<ImportRunView> {
  return withFarm(db, farmId, async (tx) => {
    const run = await pendingRun(tx, id);
    const [file] = run.file_id
      ? await rows<{ name: string; bytes: Buffer }>(tx, sql`SELECT name, bytes FROM import_files WHERE id = ${run.file_id}`)
      : [];
    if (!file) throw new Conflict("Le fichier de cet import a expiré : déposez-le à nouveau.");
    const preview = buildPreview(analyzeFile(file.name, new Uint8Array(file.bytes)), {
      fileName: file.name,
      farmSiret: await farmSiret(tx, farmId),
      decisions,
    });
    await tx.execute(sql`
      UPDATE import_runs SET decisions = ${JSON.stringify(decisions)}::jsonb, preview = ${JSON.stringify(preview)}::jsonb
      WHERE id = ${id}`);
    return readRun(tx, id);
  });
}

/** Abandon d'un import analysé ; son fichier est supprimé s'il ne sert à aucun autre import. */
export async function discardRun(db: Database, farmId: string, id: string): Promise<ImportRunView> {
  return withFarm(db, farmId, async (tx) => {
    const run = await pendingRun(tx, id);
    await tx.execute(sql`UPDATE import_runs SET status = 'discarded', finished_at = now() WHERE id = ${id}`);
    if (run.file_id) {
      await tx.execute(sql`
        DELETE FROM import_files f WHERE f.id = ${run.file_id}
          AND NOT EXISTS (SELECT 1 FROM import_runs r WHERE r.file_id = f.id AND r.id <> ${id} AND r.status <> 'discarded')`);
    }
    return readRun(tx, id);
  });
}

/**
 * Worker : fichiers expirés supprimés (sauf pendant une écriture ou une
 * annulation) ; les analyses restées sans fichier sont abandonnées. Toutes
 * fermes confondues : connexion propriétaire, hors RLS.
 */
export async function purgeExpiredImportFiles(db: Database): Promise<{ files: number; runs: number }> {
  return db.transaction(async (tx) => {
    const files = await rows<{ id: string }>(
      tx,
      sql`
        DELETE FROM import_files f WHERE f.expires_at < now()
          AND NOT EXISTS (SELECT 1 FROM import_runs r WHERE r.file_id = f.id AND r.status IN ('running', 'reverting'))
        RETURNING f.id`,
    );
    const runs = await rows<{ id: string }>(
      tx,
      sql`UPDATE import_runs SET status = 'discarded', finished_at = now()
          WHERE status = 'analyzed' AND file_id IS NULL AND source LIKE 'file:%' RETURNING id`,
    );
    return { files: files.length, runs: runs.length };
  });
}
