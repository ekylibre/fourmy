import { sql } from "drizzle-orm";
import postgres from "postgres";
import { withFarm, type Database } from "@fourmy/db";
import { migrate } from "@fourmy/migrator-ekylibre";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Imports Ekylibre depuis l'API (FR-MIG-1/3). Sécurité : le client ne fournit
 * qu'un **nom** de base source (`ekylibre_src_…`, restaurée en lecture seule
 * par restore-source.sh), jamais une URL ; le serveur source est fixé par la
 * configuration (EKYLIBRE_SOURCES_URL). Exécution en tâche de fond dans le
 * processus de l'API (v1 ; apps/worker ensuite) : réponse 202 + suivi.
 */

const SOURCE_DB = /^ekylibre_src_[a-z0-9_]{1,50}$/;

export class ImportsNotConfigured extends Error {}

export interface ImportRunView {
  id: string;
  source: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  report: unknown;
}

function sourceUrl(database: string): string {
  const base = process.env.EKYLIBRE_SOURCES_URL;
  if (!base) throw new ImportsNotConfigured("Imports Ekylibre non configurés (EKYLIBRE_SOURCES_URL).");
  if (!SOURCE_DB.test(database)) {
    throw new BadRequest("sourceDatabase : nom de base source attendu (ekylibre_src_…), jamais une URL.");
  }
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Lance un import ; renvoie l'identifiant de suivi sans attendre la fin. */
export async function startImport(
  db: Database,
  farmId: string,
  input: { sourceDatabase: string },
  onSettled?: (p: Promise<unknown>) => void,
): Promise<ImportRunView> {
  const src = sourceUrl(input.sourceDatabase);
  const targetUrl = process.env.DATABASE_URL;
  if (!targetUrl) throw new ImportsNotConfigured("DATABASE_URL manquant.");
  const runId = crypto.randomUUID();

  // Un seul import à la fois par ferme ; la ligne de suivi existe AVANT le
  // lancement, pour qu'un échec précoce (source injoignable…) soit tracé.
  const run = await withFarm(db, farmId, async (tx) => {
    const running = (await tx.execute(sql`
      SELECT id FROM import_runs WHERE status = 'running' AND started_at > now() - interval '6 hours'`)) as unknown[];
    if (running.length > 0) throw new Conflict("Un import est déjà en cours pour cette ferme.");
    const [row] = (await tx.execute(sql`
      INSERT INTO import_runs (id, farm_id, source, status)
      VALUES (${runId}, ${farmId}, ${`ekylibre:${input.sourceDatabase}`}, 'running')
      RETURNING id, source, status, started_at, finished_at, report`)) as unknown as Record<string, unknown>[];
    return toView(row!);
  });

  const job = migrate({ sourceUrl: src, targetUrl, farmId, runId }).catch(async (e: unknown) => {
    const sqlc = postgres(targetUrl, { max: 1, onnotice: () => {} });
    try {
      await sqlc`UPDATE import_runs SET status = 'failed', finished_at = now(),
                   report = ${sqlc.json({ error: String(e) })} WHERE id = ${runId} AND status = 'running'`;
    } finally {
      await sqlc.end();
    }
  });
  onSettled?.(job);
  return run;
}

function toView(r: Record<string, unknown>): ImportRunView {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: r.id as string,
    source: r.source as string,
    status: r.status as ImportRunView["status"],
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    report: r.report ?? null,
  };
}

export async function getImport(db: Database, farmId: string, id: string): Promise<ImportRunView> {
  return withFarm(db, farmId, async (tx) => {
    const [row] = (await tx.execute(sql`
      SELECT id, source, status, started_at, finished_at, report FROM import_runs WHERE id = ${id}`)) as unknown as Record<string, unknown>[];
    if (!row) throw new NotFound(`Import ${id} introuvable.`);
    return toView(row);
  });
}
