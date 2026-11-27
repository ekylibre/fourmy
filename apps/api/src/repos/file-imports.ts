import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { importDecisions, type ImportDecisions, type ImportPreview, type ImportRunView } from "@fourmy/contracts";
import type { DomainCtx } from "@fourmy/domain";
import { analyzeFile, buildPreview, detectFormat, isBlocked, type FileAnalysis, type ReaderOptions } from "@fourmy/importers";
import { Conflict, NotFound } from "../routes/helpers.js";
import { applyPlan } from "./import-apply.js";
import { reconcile } from "./import-reconcile.js";
import { refreshImportedParcels } from "./parcel-sheet.js";

/**
 * Imports de fichiers DAPLOS, Geofolia, TelePAC
 * (claudedocs/conception_import_onboarding.md §7.1) : dépôt, analyse et
 * rapprochement avec la ferme (lecture seule), décisions, abandon, puis
 * écriture (`applyRun`, en tâche de fond, une transaction par fichier).
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/**
 * Libellés AgroEDI du jeu Lexicon réservé (`lexicon_agroedi_codes`), par
 * table : passés au lecteur DAPLOS, prioritaires sur ceux du paquet. Vide
 * sans clé Lexicon : le lecteur garde ses libellés.
 */
async function agroediDictionary(q: Pick<Tx, "execute">): Promise<ReaderOptions["dictionary"]> {
  const list = (await q.execute(sql`SELECT table_id::text AS t, trim(code) AS code, label FROM lexicon_agroedi_codes WHERE label IS NOT NULL`)) as unknown as {
    t: string;
    code: string;
    label: string;
  }[];
  if (!list.length) return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const r of list) (out[r.t] ??= {})[r.code] = r.label;
  return out;
}

/** Lecture d'un fichier, avec le référentiel dont son format a besoin (libellés AgroEDI pour DAPLOS). */
async function analyze(q: Pick<Tx, "execute">, name: string, bytes: Uint8Array): Promise<FileAnalysis> {
  const options: ReaderOptions = detectFormat(name, bytes) === "daplos" ? { dictionary: await agroediDictionary(q) } : {};
  return analyzeFile(name, bytes, options);
}

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

/** Aperçu complet : contenu du fichier, puis rapprochement avec la ferme s'il est lisible. */
async function previewOf(tx: Tx, farmId: string, analysis: FileAnalysis, fileName: string, decisions: ImportDecisions): Promise<ImportPreview> {
  const preview = buildPreview(analysis, { fileName, farmSiret: await farmSiret(tx, farmId), decisions });
  if (analysis.bundle) preview.reconciliation = (await reconcile(tx, farmId, analysis.bundle, decisions)).summary;
  return preview;
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
  const analysis = await analyze(db, name, upload.bytes);
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
    const preview = await previewOf(tx, farmId, analysis, name, decisions);

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
async function pendingRun(tx: Tx, id: string, allowEkylibre = false): Promise<{ status: string; file_id: string | null }> {
  const [run] = await rows<{ status: string; file_id: string | null; source: string }>(
    tx,
    sql`SELECT status, file_id, source FROM import_runs WHERE id = ${id} FOR UPDATE`,
  );
  if (!run || !(run.source.startsWith("file:") || (allowEkylibre && run.source.startsWith("ekylibre-file:")))) throw new NotFound(`Import ${id} introuvable.`);
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
    const preview = await previewOf(tx, farmId, await analyze(tx, file.name, new Uint8Array(file.bytes)), file.name, decisions);
    await tx.execute(sql`
      UPDATE import_runs SET decisions = ${JSON.stringify(decisions)}::jsonb, preview = ${JSON.stringify(preview)}::jsonb
      WHERE id = ${id}`);
    return readRun(tx, id);
  });
}

/** Abandon d'un import analysé ; son fichier est supprimé s'il ne sert à aucun autre import. */
export async function discardRun(db: Database, farmId: string, id: string): Promise<ImportRunView> {
  return withFarm(db, farmId, async (tx) => {
    // Sauvegarde Ekylibre restaurée : abandonnée ici, sa base et son fichier supprimés par le worker.
    const run = await pendingRun(tx, id, true);
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

/**
 * Écriture d'un import analysé (lot IM2) : contrôlé ici (fichier présent,
 * aucun avertissement bloquant, aucun autre import en cours), puis mené en
 * tâche de fond dans une seule transaction — rapprochement recalculé, puis
 * écriture. Réponse immédiate : l'import passe « en cours ». Une fois
 * l'import terminé, les parcelles créées reçoivent leurs références cadastre
 * et RPG (API Carto), comme une parcelle dessinée sur la carte.
 */
export async function applyRun(
  db: Database,
  farmId: string,
  userId: string,
  id: string,
  onSettled?: (p: Promise<unknown>) => void,
): Promise<ImportRunView> {
  const run = await withFarm(db, farmId, async (tx) => {
    const current = await pendingRun(tx, id);
    const [busy] = await rows<{ id: string }>(
      tx,
      sql`SELECT id FROM import_runs WHERE status IN ('running', 'reverting') AND id <> ${id} AND started_at > now() - interval '6 hours'`,
    );
    if (busy) throw new Conflict("Un import est déjà en cours pour cette ferme.");
    const [file] = current.file_id ? await rows<{ name: string; bytes: Buffer }>(tx, sql`SELECT name, bytes FROM import_files WHERE id = ${current.file_id}`) : [];
    if (!file) throw new Conflict("Le fichier de cet import a expiré : déposez-le à nouveau.");
    const [d] = await rows<{ decisions: unknown }>(tx, sql`SELECT decisions FROM import_runs WHERE id = ${id}`);
    const decisions = importDecisions.safeParse(d?.decisions ?? {});
    const preview = await previewOf(tx, farmId, await analyze(tx, file.name, new Uint8Array(file.bytes)), file.name, decisions.success ? decisions.data : {});
    if (isBlocked(preview)) {
      const blocking = preview.warnings.filter((w) => w.level === "blocking").map((w) => w.message);
      throw new Conflict(`Import impossible : ${blocking.join(" ")}`);
    }
    await tx.execute(sql`UPDATE import_runs SET status = 'running', preview = ${JSON.stringify(preview)}::jsonb WHERE id = ${id}`);
    return readRun(tx, id);
  });

  const ctx: DomainCtx = { now: new Date().toISOString(), newId: () => crypto.randomUUID(), actor: userId, origin: "import" };
  const job = withFarm(db, farmId, async (tx) => {
    const [row] = await rows<{ name: string; bytes: Buffer; decisions: unknown }>(
      tx,
      sql`SELECT f.name, f.bytes, r.decisions FROM import_runs r JOIN import_files f ON f.id = r.file_id WHERE r.id = ${id}`,
    );
    const analysis = await analyze(tx, row!.name, new Uint8Array(row!.bytes));
    const parsed = importDecisions.safeParse(row!.decisions ?? {});
    const plan = await reconcile(tx, farmId, analysis.bundle!, parsed.success ? parsed.data : {});
    const report = await applyPlan(tx, farmId, ctx, id, analysis.bundle!, plan);
    await tx.execute(sql`
      UPDATE import_runs SET status = 'completed', finished_at = now(), report = ${JSON.stringify(report)}::jsonb WHERE id = ${id}`);
  }).then(
    // Import terminé : références cadastre et RPG des parcelles créées, après coup (#165).
    async () => {
      const refs = await refreshImportedParcels(db, farmId, id);
      if (refs.failed) console.warn(`[imports] import ${id} : références de ${refs.failed}/${refs.parcels} parcelles non rafraîchies (API Carto)`);
    },
    async (e: unknown) => {
      console.error(`[imports] import ${id} en échec :`, e);
      await withFarm(db, farmId, (tx) =>
        tx.execute(sql`
          UPDATE import_runs SET status = 'failed', finished_at = now(),
            report = ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}::jsonb
          WHERE id = ${id}`),
      );
    },
  );
  onSettled?.(job);
  return run;
}
