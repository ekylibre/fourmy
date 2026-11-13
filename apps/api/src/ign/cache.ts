import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { DomainCtx } from "@fourmy/domain";
import { coveragePlan, estimateBytes, planTileCount, type PolygonRings, type TileKey } from "@fourmy/geo-ign";
import {
  DEFAULT_FARM_IGN,
  ignLayer,
  IGN_SERVER_CONFIRM_BYTES,
  type FarmIgnSettings,
  type IgnCacheJob,
  type IgnCacheState,
  type IgnLayer,
  type IgnLayerProgress,
} from "@fourmy/contracts";
import { Conflict, NotFound } from "../routes/helpers.js";
import { pgArray } from "./store.js";

/**
 * Préchargement des tuiles IGN d'une ferme (« Ma ferme », lot F4,
 * claudedocs/conception_ma_ferme.md §5.4) : réglages, plan de couverture,
 * tâches lancées par le responsable ou relancées quand un site bouge.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export type IgnPlan = Map<IgnLayer, TileKey[]>;

export async function ignSettingsTx(tx: Tx): Promise<FarmIgnSettings> {
  const [s] = await rows<{ ign: Partial<FarmIgnSettings> }>(tx, sql`SELECT ign FROM farm_settings`);
  const merged = { ...DEFAULT_FARM_IGN, ...(s?.ign ?? {}) };
  // Une couche retirée du produit ne doit pas casser une ferme qui l'avait choisie.
  const layers = merged.layers.filter((l): l is IgnLayer => (ignLayer.options as string[]).includes(l));
  return { ...merged, layers: layers.length ? layers : DEFAULT_FARM_IGN.layers };
}

export async function putIgnSettings(db: Database, farmId: string, ctx: DomainCtx, body: FarmIgnSettings): Promise<FarmIgnSettings> {
  return withFarm(db, farmId, async (tx) => {
    const before = await ignSettingsTx(tx);
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, ign) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET ign = excluded.ign, updated_at = now()`);
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
      VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'farm_settings', ${farmId}, 'update_ign', ${JSON.stringify({ before, after: body })}::jsonb)`);
    return ignSettingsTx(tx);
  });
}

/** Plan de la ferme : zones des sites placés, détail autour des parcelles en vigueur. Null sans site placé. */
export async function farmPlanTx(tx: Tx, settings: FarmIgnSettings): Promise<IgnPlan | null> {
  const sites = await rows<{ lon: number; lat: number; radius_m: number }>(
    tx,
    sql`SELECT ST_X(location) AS lon, ST_Y(location) AS lat, radius_m FROM farm_sites WHERE location IS NOT NULL`,
  );
  if (!sites.length) return null;
  const shapes = await rows<{ g: string }>(tx, sql`SELECT ST_AsGeoJSON(shape) AS g FROM land_parcel_versions WHERE valid @> now()`);
  const parcels: PolygonRings[] = shapes.flatMap((s) => (JSON.parse(s.g) as { coordinates: PolygonRings[] }).coordinates);
  return coveragePlan({
    sites: sites.map((s) => ({ location: { lon: Number(s.lon), lat: Number(s.lat) }, radiusM: Number(s.radius_m) })),
    parcels,
    layers: settings.layers,
    detailMarginM: settings.detailMarginM,
  });
}

/** Tuiles du plan déjà dans le cache du serveur (ign_tiles n'a pas de RLS : données publiques). */
async function cachedInPlan(tx: Tx, plan: IgnPlan): Promise<{ tiles: number; bytes: number }> {
  let tiles = 0;
  let bytes = 0;
  for (const [layer, keys] of plan) {
    for (let i = 0; i < keys.length; i += 5000) {
      const batch = keys.slice(i, i + 5000);
      const [r] = await rows<{ n: number; b: number }>(tx, sql`
        SELECT count(*)::int AS n, coalesce(sum(t.bytes), 0)::bigint AS b
        FROM unnest(${pgArray(batch.map((k) => k.z))}::int[], ${pgArray(batch.map((k) => k.x))}::int[], ${pgArray(batch.map((k) => k.y))}::int[]) AS k(z, x, y)
        JOIN ign_tiles t ON t.layer = ${layer} AND t.z = k.z AND t.x = k.x AND t.y = k.y`);
      tiles += r?.n ?? 0;
      bytes += Number(r?.b ?? 0);
    }
  }
  return { tiles, bytes };
}

type JobRow = {
  id: string; status: IgnCacheJob["status"]; layers: IgnLayer[]; tile_count: number; estimate_bytes: string | number;
  progress: IgnCacheJob["progress"]; error: string | null; created_at: unknown; started_at: unknown; finished_at: unknown;
};
const JOB_COLUMNS = sql`id, status, layers, tile_count, estimate_bytes, progress, error, created_at, started_at, finished_at`;
const toJob = (r: JobRow): IgnCacheJob => ({
  id: r.id,
  status: r.status,
  layers: r.layers,
  tileCount: r.tile_count,
  estimateBytes: Number(r.estimate_bytes),
  progress: r.progress ?? {},
  error: r.error,
  createdAt: iso(r.created_at)!,
  startedAt: iso(r.started_at),
  finishedAt: iso(r.finished_at),
});

export async function getCacheState(db: Database, farmId: string, canEdit: boolean): Promise<IgnCacheState> {
  return withFarm(db, farmId, async (tx) => {
    const settings = await ignSettingsTx(tx);
    const plan = await farmPlanTx(tx, settings);
    const [job] = await rows<JobRow>(tx, sql`SELECT ${JOB_COLUMNS} FROM ign_cache_jobs ORDER BY created_at DESC LIMIT 1`);
    return {
      settings,
      plan: plan && {
        tiles: planTileCount(plan),
        estimateBytes: estimateBytes(plan),
        layers: Object.fromEntries([...plan].map(([l, t]) => [l, t.length])),
      },
      cached: plan ? await cachedInPlan(tx, plan) : { tiles: 0, bytes: 0 },
      lastJob: job ? toJob(job) : null,
      confirmAboveBytes: IGN_SERVER_CONFIRM_BYTES,
      canEdit,
    };
  });
}

export class ConfirmationRequired extends Error {
  constructor(readonly estimateBytes: number, readonly tiles: number) {
    super("Préchargement volumineux : confirmation demandée.");
  }
}

/**
 * Lance le préchargement. Refusé sans site placé, ou si une tâche est déjà
 * en cours ; au-delà du seuil, demande une confirmation (N3).
 */
export async function createJob(db: Database, farmId: string, ctx: DomainCtx, opts: { confirm?: boolean }): Promise<IgnCacheJob> {
  return withFarm(db, farmId, async (tx) => {
    const settings = await ignSettingsTx(tx);
    const plan = await farmPlanTx(tx, settings);
    if (!plan) throw new Conflict("Placez d'abord le siège sur la carte : la zone à précharger part des sites.");
    const bytes = estimateBytes(plan);
    if (bytes > IGN_SERVER_CONFIRM_BYTES && !opts.confirm) throw new ConfirmationRequired(bytes, planTileCount(plan));
    const job = await insertJob(tx, farmId, ctx.newId(), ctx.actor, settings, plan);
    if (!job) throw new Conflict("Un préchargement est déjà en cours pour cette ferme.");
    return job;
  });
}

async function insertJob(tx: Tx, farmId: string, id: string, actor: string | null, settings: FarmIgnSettings, plan: IgnPlan): Promise<IgnCacheJob | null> {
  const progress = Object.fromEntries([...plan].map(([l, t]) => [l, { total: t.length, done: 0, fetched: 0, failed: 0 } satisfies IgnLayerProgress]));
  const [r] = await rows<JobRow>(tx, sql`
    INSERT INTO ign_cache_jobs (id, farm_id, status, layers, requested_by, tile_count, estimate_bytes, progress)
    VALUES (${id}, ${farmId}, 'pending', ${pgArray(settings.layers)}::text[],
            ${actor},${planTileCount(plan)}, ${estimateBytes(plan)}, ${JSON.stringify(progress)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING ${JOB_COLUMNS}`);
  return r ? toJob(r) : null;
}

/**
 * Relance automatique après un changement de site (E12) : seulement si la
 * ferme l'a demandé, sans tâche déjà active, et sous le seuil de confirmation.
 */
export async function queueAutoRefresh(db: Database, farmId: string, ctx: DomainCtx): Promise<boolean> {
  return withFarm(db, farmId, async (tx) => {
    const settings = await ignSettingsTx(tx);
    if (!settings.autoRefresh) return false;
    const plan = await farmPlanTx(tx, settings);
    if (!plan || estimateBytes(plan) > IGN_SERVER_CONFIRM_BYTES) return false;
    return (await insertJob(tx, farmId, ctx.newId(), ctx.actor, settings, plan)) !== null;
  });
}

export async function cancelJob(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [r] = await rows<{ status: string }>(tx, sql`SELECT status FROM ign_cache_jobs WHERE id = ${id}`);
    if (!r) throw new NotFound("Préchargement introuvable");
    if (r.status !== "pending" && r.status !== "running") throw new Conflict("Ce préchargement est déjà terminé.");
    await tx.execute(sql`UPDATE ign_cache_jobs SET status = 'cancelled', finished_at = now(), locked_until = NULL WHERE id = ${id}`);
  });
}

/** Entrée du manifeste de la copie navigateur : URL servie par l'API, version, taille. */
export interface IgnManifestEntry {
  url: string;
  etag: string;
  bytes: number;
}

/**
 * Manifeste de la copie hors ligne (F5, §6.4) : les tuiles du plan de la
 * ferme **déjà sur le serveur**, pour que le navigateur ne déclenche jamais
 * d'appel à l'IGN. Fonds de carte par le relais, relief par la route de la
 * 3D ; les bâtiments arrivent avec la réponse du plan 3D.
 */
export async function cacheManifest(db: Database, farmId: string): Promise<{ entries: IgnManifestEntry[]; bytes: number }> {
  return withFarm(db, farmId, async (tx) => {
    const plan = await farmPlanTx(tx, await ignSettingsTx(tx));
    const entries: IgnManifestEntry[] = [];
    const base = `/api/v1/farms/${farmId}`;
    for (const [layer, keys] of plan ?? []) {
      if (layer === "buildings") continue;
      const path = layer === "elevation" ? "/terrain/heightmap" : `/ign/tiles/${layer}`;
      for (let i = 0; i < keys.length; i += 5000) {
        const batch = keys.slice(i, i + 5000);
        const found = await rows<{ z: number; x: number; y: number; sha1: string; bytes: number }>(tx, sql`
          SELECT t.z, t.x, t.y, t.sha1, t.bytes
          FROM unnest(${pgArray(batch.map((k) => k.z))}::int[], ${pgArray(batch.map((k) => k.x))}::int[], ${pgArray(batch.map((k) => k.y))}::int[]) AS k(z, x, y)
          JOIN ign_tiles t ON t.layer = ${layer} AND t.z = k.z AND t.x = k.x AND t.y = k.y`);
        for (const t of found) entries.push({ url: `${base}${path}/${t.z}/${t.x}/${t.y}`, etag: `"${t.sha1}"`, bytes: t.bytes });
      }
    }
    return { entries, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
  });
}
