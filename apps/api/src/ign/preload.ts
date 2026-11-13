import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import type { IgnLayer, IgnLayerProgress } from "@fourmy/contracts";
import { deleteTiles, ensureTile, IgnUnavailable } from "./store.js";
import { farmPlanTx, ignSettingsTx, type IgnPlan } from "./cache.js";

/**
 * Worker du préchargement IGN (« Ma ferme », lot F4, §5.4) : une tâche à la
 * fois, 8 requêtes en parallèle (cache et préchargement confirmés par
 * l'IGN le 2026-11-13 ; le WMTS n'a pas de limite de débit), progression
 * écrite régulièrement,
 * annulation prise en compte entre deux lots. Puis la purge du quota disque.
 */

export const preloadConfig = {
  concurrency: Number(process.env.FOURMY_IGN_PRELOAD_CONCURRENCY ?? 8),
  attempts: 3,
  retryDelayMs: 1000,
  progressEvery: 200,
  /** Progression écrite aussi au moins toutes les 5 s : sans cela, rien ne bouge à l'écran avant les 200 premières tuiles. */
  progressEveryMs: 5_000,
  lockFor: "10 minutes",
  /** Temps de travail par tour du worker : les autres tâches (Traccar…) passent entre deux tours. */
  budgetMs: 50_000,
  maxBytes: Number(process.env.FOURMY_IGN_CACHE_MAX_GB ?? 20) * 1e9,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof IgnUnavailable) || n >= preloadConfig.attempts) throw e;
      await sleep(preloadConfig.retryDelayMs * n);
    }
  }
}

async function claim(db: Database): Promise<{ id: string; farm_id: string } | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    const [r] = (await tx.execute(sql`SELECT * FROM fourmy_ign_claim_job(${preloadConfig.lockFor}::interval)`)) as unknown as { id: string; farm_id: string }[];
    return r ?? null;
  });
}

type Progress = Partial<Record<IgnLayer, IgnLayerProgress>>;

/** Écrit la progression et prolonge le verrou ; renvoie false si la tâche a été annulée. */
async function checkpoint(db: Database, farmId: string, jobId: string, progress: Progress): Promise<boolean> {
  return withFarm(db, farmId, async (tx) => {
    const [r] = (await tx.execute(sql`
      UPDATE ign_cache_jobs SET progress = ${JSON.stringify(progress)}::jsonb, locked_until = now() + ${preloadConfig.lockFor}::interval
      WHERE id = ${jobId} AND status = 'running' RETURNING id`)) as unknown as { id: string }[];
    return !!r;
  });
}

/**
 * Prend une tâche en attente (ou à reprendre) et y travaille au plus
 * `budgetMs`. Renvoie null s'il n'y avait rien à faire. Budget écoulé ou
 * arrêt du worker : la tâche reste « running », verrou rendu, et reprend au
 * tour suivant.
 */
export async function runIgnJob(db: Database, stopping: () => boolean = () => false): Promise<{ jobId: string; status: string; fetched: number; failed: number } | null> {
  const job = await claim(db);
  if (!job) return null;
  const started = Date.now();
  const previous = await withFarm(db, job.farm_id, async (tx) => {
    const [r] = (await tx.execute(sql`SELECT progress FROM ign_cache_jobs WHERE id = ${job.id}`)) as unknown as { progress: Progress }[];
    return r?.progress ?? {};
  });
  const plan = await withFarm(db, job.farm_id, async (tx) => farmPlanTx(tx, await ignSettingsTx(tx)));
  if (!plan) {
    await finish(db, job.farm_id, job.id, "failed", {}, "Aucun site placé : rien à précharger.");
    return { jobId: job.id, status: "failed", fetched: 0, failed: 0 };
  }
  // Reprise d'un tour précédent : les tuiles déjà en cache passent vite (index seul), on garde le compte des téléchargées.
  const progress: Progress = Object.fromEntries([...plan].map(([l, t]) => [l, { total: t.length, done: 0, fetched: previous[l]?.fetched ?? 0, failed: 0 }]));
  let sinceCheckpoint = 0;
  let checkpointAt = Date.now();
  let lastError: string | null = null;
  for (const [layer, tiles] of plan) {
    const p = progress[layer]!;
    for (let i = 0; i < tiles.length; i += preloadConfig.concurrency) {
      if (stopping() || Date.now() - started > preloadConfig.budgetMs) {
        await release(db, job.farm_id, job.id, progress);
        return { jobId: job.id, status: "running", ...totals(progress) };
      }
      await Promise.all(
        tiles.slice(i, i + preloadConfig.concurrency).map(async (t) => {
          try {
            if ((await withRetry(() => ensureTile(db, layer, t.z, t.x, t.y))) === "fetched") p.fetched++;
          } catch (e) {
            p.failed++;
            lastError = (e as Error).message;
          }
          p.done++;
        }),
      );
      sinceCheckpoint += preloadConfig.concurrency;
      if (sinceCheckpoint >= preloadConfig.progressEvery || Date.now() - checkpointAt >= preloadConfig.progressEveryMs) {
        sinceCheckpoint = 0;
        checkpointAt = Date.now();
        if (!(await checkpoint(db, job.farm_id, job.id, progress))) return { jobId: job.id, status: "cancelled", ...totals(progress) };
      }
    }
  }
  const { fetched, failed } = totals(progress);
  const total = Object.values(progress).reduce((n, l) => n + l.total, 0);
  const status = failed === 0 ? "done" : failed === total ? "failed" : "partial";
  await finish(db, job.farm_id, job.id, status, progress, failed ? `${failed} tuile(s) non téléchargée(s) : ${lastError}` : null);
  return { jobId: job.id, status, fetched, failed };
}

const totals = (p: Progress) => ({
  fetched: Object.values(p).reduce((n, l) => n + l.fetched, 0),
  failed: Object.values(p).reduce((n, l) => n + l.failed, 0),
});

/** Rend la main au worker ; la tâche reste en cours et sera reprise au tour suivant. */
async function release(db: Database, farmId: string, jobId: string, progress: Progress) {
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      UPDATE ign_cache_jobs SET progress = ${JSON.stringify(progress)}::jsonb, locked_until = now() - interval '1 second'
      WHERE id = ${jobId} AND status = 'running'`),
  );
}

async function finish(db: Database, farmId: string, jobId: string, status: string, progress: Progress, error: string | null) {
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      UPDATE ign_cache_jobs SET status = ${status}, progress = ${JSON.stringify(progress)}::jsonb, error = ${error}, finished_at = now(), locked_until = NULL
      WHERE id = ${jobId} AND status = 'running'`),
  );
}

// --- Quota disque (politique LRU, comme les « disk quotas » de GeoWebCache)

const keyOf = (layer: string, z: number, x: number, y: number) => `${layer}/${z}/${x}/${y}`;

async function protectedTiles(db: Database): Promise<Set<string>> {
  const farms = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return (await tx.execute(sql`SELECT farm_id FROM fourmy_ign_cached_farms()`)) as unknown as { farm_id: string }[];
  });
  const keep = new Set<string>();
  for (const { farm_id } of farms) {
    const plan: IgnPlan | null = await withFarm(db, farm_id, async (tx) => farmPlanTx(tx, await ignSettingsTx(tx)));
    for (const [layer, tiles] of plan ?? []) for (const t of tiles) keep.add(keyOf(layer, t.z, t.x, t.y));
  }
  return keep;
}

/**
 * Au-delà du quota, supprime d'abord les tuiles hors du plan de toutes les
 * fermes, les moins récemment lues d'abord ; celles d'un plan seulement en
 * dernier recours. Tout passe par l'index, jamais par un parcours du disque.
 */
export async function purgeIgnCache(db: Database, maxBytes = preloadConfig.maxBytes): Promise<{ deleted: number; freedBytes: number; protectedDeleted: number }> {
  const [{ total }] = (await db.execute(sql`SELECT coalesce(sum(bytes), 0)::bigint AS total FROM ign_tiles`)) as unknown as [{ total: string }];
  let excess = Number(total) - maxBytes;
  const result = { deleted: 0, freedBytes: 0, protectedDeleted: 0 };
  if (excess <= 0) return result;
  const keep = await protectedTiles(db);
  type T = { layer: IgnLayer; z: number; x: number; y: number; bytes: number };
  for (const pass of ["unprotected", "protected"] as const) {
    let after: { at: string; key: string } | null = null;
    while (excess > 0) {
      const batch = (await db.execute(sql`
        SELECT layer, z, x, y, bytes, last_read_at::text AS at FROM ign_tiles
        ${after ? sql`WHERE (last_read_at, layer || '/' || z || '/' || x || '/' || y) > (${after.at}::timestamptz, ${after.key})` : sql``}
        ORDER BY last_read_at, layer || '/' || z || '/' || x || '/' || y
        LIMIT 2000`)) as unknown as (T & { at: string })[];
      if (!batch.length) break;
      const last = batch[batch.length - 1]!;
      after = { at: last.at, key: keyOf(last.layer, last.z, last.x, last.y) };
      const victims: T[] = [];
      for (const t of batch) {
        if (excess <= 0) break;
        if ((pass === "unprotected") === keep.has(keyOf(t.layer, t.z, t.x, t.y))) continue;
        victims.push(t);
        excess -= t.bytes;
      }
      await deleteTiles(db, victims);
      result.deleted += victims.length;
      result.freedBytes += victims.reduce((n, t) => n + t.bytes, 0);
      if (pass === "protected") result.protectedDeleted += victims.length;
    }
  }
  return result;
}
