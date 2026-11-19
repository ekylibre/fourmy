import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  COVER_LOSS,
  COVER_REMOVING_PROCEDURES,
  MIN_PARCEL_PIXELS,
  type CoverLossAnomaly,
  USABLE_VALID_RATIO,
  VEGETATION_INDICES,
  copernicusAttribution,
  type ParcelIndexSeries,
  type ParcelIndicesAt,
  type RemoteSensingStatus,
  type SatelliteImageKind,
  type SatelliteImageRef,
  type SatelliteScene,
  type VegetationIndex,
} from "@fourmy/contracts";
import { addDays, coverLossEvents, explainsCoverLoss, imageSize, isUsable, minusYears, parcelIndexStatus, referenceCurve, smoothDaily, utmEpsg, validRatio } from "@fourmy/domain";
import { INDEX_METHOD, type Bbox, type PolygonGeometry, type SentinelClient } from "@fourmy/sentinel";
import { NotFound } from "../routes/helpers.js";

/**
 * Télédétection par parcelle (docs/teledetection-design.md) : synchronisation
 * depuis Copernicus (CDSE) et lectures pour la frise, la carte, le plan 3D et
 * la fiche parcelle. Rien n'est inventé : un échec n'écrit rien.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const today = () => new Date().toISOString().slice(0, 10);
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** Une acquisition est retenue pour la ferme (images) si 30 % de ses parcelles sont visibles. */
export const SCENE_MIN_VALID_RATIO = 0.3;
/** Fenêtre reprise à chaque synchro : publications tardives et retraitements. */
const REFETCH_DAYS = 10;
export const DEFAULT_MONTHLY_REQUESTS = 3000;
const IMAGES_PER_SYNC = 20;

export class BudgetReached extends Error {
  constructor(budget: number) {
    super(`Budget mensuel atteint (${budget} requêtes Copernicus) : la synchronisation reprendra le 1er du mois.`);
  }
}

/** Historique par défaut : 1er janvier de l'année précédente (décision du 2026-11-10). */
export const defaultHistoryFrom = (day: string) => `${Number(day.slice(0, 4)) - 1}-01-01`;

export const monthlyBudget = (settings: Record<string, string>) => {
  const n = Number(settings.monthlyRequests);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MONTHLY_REQUESTS;
};

// --- Géométries -------------------------------------------------------------

/** Versions de parcelles valides sur [from, to] : centre et emprise de la ferme. */
async function farmFrame(tx: Tx, farmId: string, from: string, to: string): Promise<{ epsg: number; bbox: Bbox } | null> {
  const [r] = await rows<{ lon: number | null; lat: number | null; w: number; s: number; e: number; n: number }>(
    tx,
    sql`
      SELECT ST_X(ST_Centroid(ST_Collect(v.shape))) AS lon, ST_Y(ST_Centroid(ST_Collect(v.shape))) AS lat,
             ST_XMin(ST_Extent(v.shape)) AS w, ST_YMin(ST_Extent(v.shape)) AS s,
             ST_XMax(ST_Extent(v.shape)) AS e, ST_YMax(ST_Extent(v.shape)) AS n
      FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
      WHERE lp.farm_id = ${farmId} AND v.valid && tstzrange(${from}::date, ${to}::date + 1) AND NOT ST_IsEmpty(v.shape)`,
  );
  if (!r || r.lon === null || r.lat === null) return null;
  return { epsg: utmEpsg(r.lon, r.lat), bbox: [r.w, r.s, r.e, r.n] };
}

/** Emprise des parcelles valides aujourd'hui (test de l'intégration). */
export async function farmBbox(db: Database, farmId: string): Promise<Bbox | null> {
  const d = today();
  return (await withFarm(db, farmId, (tx) => farmFrame(tx, farmId, d, d)))?.bbox ?? null;
}

interface VersionRow {
  id: string;
  land_parcel_id: string;
  valid_from: string | null;
  valid_to: string | null;
  geom: PolygonGeometry | null;
  parcel_px: number;
  hash: string;
}

/** Versions avec leur géométrie projetée réduite de 10 m (bords mixtes) et leur nombre de pixels de 10 m. */
async function versions(tx: Tx, farmId: string, epsg: number, from: string, to: string): Promise<VersionRow[]> {
  return rows<VersionRow>(
    tx,
    sql`
      WITH v AS (
        SELECT v.id, v.land_parcel_id, v.shape, v.valid,
               ST_Buffer(ST_Transform(v.shape, ${epsg}::int), -10) AS inner_shape
        FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
        WHERE lp.farm_id = ${farmId} AND v.valid && tstzrange(${from}::date, ${to}::date + 1) AND NOT ST_IsEmpty(v.shape))
      SELECT id, land_parcel_id,
             (lower(valid) AT TIME ZONE 'Europe/Paris')::date::text AS valid_from,
             (upper(valid) AT TIME ZONE 'Europe/Paris')::date::text AS valid_to,
             CASE WHEN ST_IsEmpty(inner_shape) THEN NULL ELSE ST_AsGeoJSON(ST_Multi(inner_shape), 2)::json END AS geom,
             floor(ST_Area(inner_shape) / 100)::int AS parcel_px,
             md5(ST_AsBinary(shape)) AS hash
      FROM v ORDER BY land_parcel_id, lower(valid)`,
  );
}

/** Résolution du test de nuages sur la ferme (m) : voir SentinelClient.validPixels. */
const VALIDITY_RESOLUTION = 60;

/** Union réduite des parcelles valides à une date (projetée) et son nombre de pixels de VALIDITY_RESOLUTION m. */
async function farmUnion(tx: Tx, farmId: string, epsg: number, day: string): Promise<{ geom: PolygonGeometry; px: number } | null> {
  const [r] = await rows<{ geom: PolygonGeometry | null; px: number }>(
    tx,
    sql`
      WITH u AS (
        SELECT ST_Union(ST_Buffer(ST_Transform(v.shape, ${epsg}::int), -10)) AS g
        FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
        WHERE lp.farm_id = ${farmId} AND v.valid @> ${day}::date::timestamptz + interval '12 hours' AND NOT ST_IsEmpty(v.shape))
      SELECT CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(ST_Multi(g), 2)::json END AS geom,
             coalesce(floor(ST_Area(g) / ${VALIDITY_RESOLUTION * VALIDITY_RESOLUTION}), 0)::int AS px FROM u`,
  );
  return r?.geom ? { geom: r.geom, px: r.px } : null;
}

/** Union WGS84 des parcelles valides à une date (rendu d'image) et son emprise. */
async function farmShape4326(tx: Tx, farmId: string, day: string): Promise<{ geom: PolygonGeometry; bbox: Bbox } | null> {
  const [r] = await rows<{ geom: PolygonGeometry | null; w: number; s: number; e: number; n: number }>(
    tx,
    sql`
      WITH u AS (
        SELECT ST_Union(v.shape) AS g
        FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
        WHERE lp.farm_id = ${farmId} AND v.valid @> ${day}::date::timestamptz + interval '12 hours' AND NOT ST_IsEmpty(v.shape))
      SELECT CASE WHEN g IS NULL THEN NULL ELSE ST_AsGeoJSON(ST_Multi(g), 7)::json END AS geom,
             ST_XMin(g) AS w, ST_YMin(g) AS s, ST_XMax(g) AS e, ST_YMax(g) AS n FROM u`,
  );
  return r?.geom ? { geom: r.geom, bbox: [r.w, r.s, r.e, r.n] } : null;
}

// --- Synchronisation --------------------------------------------------------

export interface RemoteSensingReport {
  [key: string]: unknown;
  window: { from: string; to: string };
  acquisitions: number;
  scenes: number;
  usableScenes: number;
  images: number;
  parcels: number;
  parcelsTooSmall: number;
  values: number;
  requests: number;
  pu: number;
}

/**
 * Synchronise une ferme : acquisitions du catalogue, part visible de la
 * ferme par date, images des dates exploitables, puis indices des versions de
 * parcelles qui ont une nouvelle date exploitable. Idempotent (upserts) ;
 * reprend les 10 derniers jours à chaque passage.
 */
export async function syncRemoteSensing(
  db: Database,
  farmId: string,
  client: SentinelClient,
  opts: { today?: string; historyFrom?: string; imagesPerSync?: number; counter?: { requests: number; pu: number } } = {},
): Promise<RemoteSensingReport> {
  const to = opts.today ?? today();
  const defaultFrom = defaultHistoryFrom(to);
  const historyFrom = opts.historyFrom && opts.historyFrom < defaultFrom ? opts.historyFrom : defaultFrom;
  const counter = opts.counter ?? { requests: 0, pu: 0 };
  const report: RemoteSensingReport = { window: { from: historyFrom, to }, acquisitions: 0, scenes: 0, usableScenes: 0, images: 0, parcels: 0, parcelsTooSmall: 0, values: 0, requests: 0, pu: 0 };
  const done = () => ({ ...report, requests: counter.requests, pu: Math.round(counter.pu * 1000) / 1000 });

  // 1. Fenêtre à explorer : tout l'historique au premier passage (ou s'il recule), sinon les 10 derniers jours.
  const known = await withFarm(db, farmId, (tx) =>
    rows<{ first: string | null; last: string | null }>(tx, sql`SELECT min(acquired_on)::text AS first, max(acquired_on)::text AS last FROM satellite_scenes`),
  );
  const { first, last } = known[0] ?? { first: null, last: null };
  const sceneFrom = !first || !last || historyFrom < first ? historyFrom : addDays(last, -REFETCH_DAYS);
  const frame = await withFarm(db, farmId, (tx) => farmFrame(tx, farmId, historyFrom, to));
  if (!frame) return done();

  // 2. Acquisitions et part visible de la ferme par date.
  const acquisitions = await client.acquisitions(frame.bbox, sceneFrom, to);
  report.acquisitions = acquisitions.length;
  const knownDates = new Set(
    (await withFarm(db, farmId, (tx) => rows<{ d: string }>(tx, sql`SELECT acquired_on::text AS d FROM satellite_scenes WHERE acquired_on >= ${sceneFrom}::date`))).map((r) => r.d),
  );
  const recent = addDays(to, -REFETCH_DAYS);
  const toCheck = acquisitions.map((a) => a.date).filter((d) => !knownDates.has(d) || d >= recent);
  if (toCheck.length) {
    const union = await withFarm(db, farmId, (tx) => farmUnion(tx, farmId, frame.epsg, to));
    if (union && union.px > 0) {
      const { rows: valid } = await client.validPixels({ epsg: frame.epsg, geometry: union.geom }, toCheck[0]!, toCheck[toCheck.length - 1]!, VALIDITY_RESOLUTION);
      const byDate = new Map(valid.map((r) => [r.date, validRatio(r.validPx, union.px)]));
      await withFarm(db, farmId, async (tx) => {
        for (const d of toCheck) {
          const ratio = Math.round((byDate.get(d) ?? 0) * 1000) / 1000;
          await tx.execute(sql`
            INSERT INTO satellite_scenes (farm_id, acquired_on, valid_ratio) VALUES (${farmId}, ${d}::date, ${ratio})
            ON CONFLICT (farm_id, source, acquired_on) DO UPDATE SET valid_ratio = excluded.valid_ratio, fetched_at = now()`);
        }
      });
      report.scenes = toCheck.length;
      report.usableScenes = toCheck.filter((d) => (byDate.get(d) ?? 0) >= SCENE_MIN_VALID_RATIO).length;
    }
  }

  // 3. Images des dates exploitables qui n'en ont pas encore (les plus récentes d'abord, par lots).
  const missing = await withFarm(db, farmId, (tx) =>
    rows<{ d: string }>(
      tx,
      sql`SELECT s.acquired_on::text AS d FROM satellite_scenes s
          WHERE s.valid_ratio >= ${SCENE_MIN_VALID_RATIO} AND s.acquired_on >= ${historyFrom}::date
            AND NOT EXISTS (SELECT 1 FROM satellite_images i WHERE i.acquired_on = s.acquired_on AND i.kind = 'ndvi')
          ORDER BY s.acquired_on DESC LIMIT ${opts.imagesPerSync ?? IMAGES_PER_SYNC}`,
    ),
  );
  for (const { d } of missing) {
    const shape = await withFarm(db, farmId, (tx) => farmShape4326(tx, farmId, d));
    if (!shape) continue;
    const size = imageSize(shape.bbox);
    for (const kind of ["ndvi", "rgb"] as const) {
      const { png } = await client.render(shape.geom, d, kind, size);
      const etag = createHash("sha256").update(png).digest("hex").slice(0, 32);
      const [w, s, e, n] = shape.bbox;
      await withFarm(db, farmId, (tx) =>
        tx.execute(sql`
          INSERT INTO satellite_images (farm_id, acquired_on, kind, west, south, east, north, width, height, png, etag)
          VALUES (${farmId}, ${d}::date, ${kind}, ${w}, ${s}, ${e}, ${n}, ${size.width}, ${size.height}, ${Buffer.from(png)}, ${etag})
          ON CONFLICT (farm_id, acquired_on, kind) DO UPDATE SET west = excluded.west, south = excluded.south, east = excluded.east,
            north = excluded.north, width = excluded.width, height = excluded.height, png = excluded.png, etag = excluded.etag, fetched_at = now()`),
      );
      report.images++;
    }
  }

  // 4. Indices par version de parcelle, seulement s'il y a une date exploitable non encore couverte.
  const usableDates = (
    await withFarm(db, farmId, (tx) =>
      rows<{ d: string }>(tx, sql`SELECT acquired_on::text AS d FROM satellite_scenes WHERE valid_ratio >= ${SCENE_MIN_VALID_RATIO} AND acquired_on >= ${historyFrom}::date ORDER BY 1`),
    )
  ).map((r) => r.d);
  const hasUsable = (a: string, b: string) => usableDates.some((d) => d >= a && d <= b);
  const list = await withFarm(db, farmId, (tx) => versions(tx, farmId, frame.epsg, historyFrom, to));
  const cursors = new Map(
    (
      await withFarm(db, farmId, (tx) =>
        rows<{ id: string; from: string; until: string; hash: string }>(
          tx,
          sql`SELECT land_parcel_version_id AS id, fetched_from::text AS from, fetched_until::text AS until, geometry_hash AS hash FROM parcel_index_cursors`,
        ),
      )
    ).map((c) => [c.id, c]),
  );

  for (const v of list) {
    if (!v.geom || v.parcel_px < MIN_PARCEL_PIXELS) {
      report.parcelsTooSmall++;
      continue;
    }
    const vFrom = v.valid_from && v.valid_from > historyFrom ? v.valid_from : historyFrom;
    // `valid` est semi-ouvert : la borne haute est le premier jour de la version suivante.
    const vTo = v.valid_to && addDays(v.valid_to, -1) < to ? addDays(v.valid_to, -1) : to;
    if (vFrom > vTo) continue;
    // Curseur : [fetched_from, fetched_until] = période déjà demandée ; fetched_until
    // est la dernière date exploitable obtenue (une date publiée en retard reste
    // donc à prendre). On ne redemande une version que pour une date exploitable
    // nouvelle, ou pour un historique qui recule.
    const cursor = cursors.get(v.id);
    const same = cursor !== undefined && cursor.hash === v.hash;
    const ranges: [string, string][] = [];
    if (same) {
      if (vFrom < cursor.from && hasUsable(vFrom, addDays(cursor.from, -1))) ranges.push([vFrom, addDays(cursor.from, -1)]);
      const next = addDays(cursor.until, 1) > vFrom ? addDays(cursor.until, 1) : vFrom;
      if (hasUsable(next, vTo)) ranges.push([next, vTo]);
    } else {
      if (cursor) await withFarm(db, farmId, (tx) => tx.execute(sql`DELETE FROM parcel_indices WHERE land_parcel_version_id = ${v.id}`));
      if (hasUsable(vFrom, vTo)) ranges.push([vFrom, vTo]);
    }

    for (const [a, b] of ranges) {
      const { rows: values } = await client.parcelStats({ epsg: frame.epsg, geometry: v.geom }, a, b);
      await withFarm(db, farmId, async (tx) => {
        for (const r of values) {
          await tx.execute(sql`
            INSERT INTO parcel_indices (farm_id, land_parcel_version_id, acquired_on, vegetation_index, mean, std, p10, p50, p90, valid_px, parcel_px, method)
            VALUES (${farmId}, ${v.id}, ${r.date}::date, ${r.index}, ${r.mean}, ${r.std}, ${r.p10}, ${r.p50}, ${r.p90}, ${r.validPx}, ${v.parcel_px}, ${INDEX_METHOD})
            ON CONFLICT (land_parcel_version_id, acquired_on, vegetation_index) DO UPDATE SET
              mean = excluded.mean, std = excluded.std, p10 = excluded.p10, p50 = excluded.p50, p90 = excluded.p90,
              valid_px = excluded.valid_px, parcel_px = excluded.parcel_px, method = excluded.method, fetched_at = now()`);
        }
      });
      report.values += values.length;
    }
    const lastUsable = usableDates.filter((d) => d >= vFrom && d <= vTo).pop();
    const newFrom = same && cursor.from < vFrom ? cursor.from : vFrom;
    const covered = [same ? cursor.until : null, ranges.length ? lastUsable : null].filter((d): d is string => !!d).sort().pop();
    const newUntil = covered ?? addDays(vFrom, -1);
    await withFarm(db, farmId, (tx) =>
      tx.execute(sql`
        INSERT INTO parcel_index_cursors (land_parcel_version_id, farm_id, fetched_from, fetched_until, geometry_hash)
        VALUES (${v.id}, ${farmId}, ${newFrom}::date, ${newUntil}::date, ${v.hash})
        ON CONFLICT (land_parcel_version_id) DO UPDATE SET fetched_from = excluded.fetched_from,
          fetched_until = excluded.fetched_until, geometry_hash = excluded.geometry_hash, updated_at = now()`),
    );
    if (ranges.length) report.parcels++;
  }
  return done();
}

/** Compte une requête CDSE de la ferme pour le mois en cours. */
export async function recordUsage(db: Database, farmId: string, pu: number, day = today()): Promise<{ requests: number }> {
  const [r] = await withFarm(db, farmId, (tx) =>
    rows<{ requests: number }>(
      tx,
      sql`INSERT INTO remote_sensing_usage (farm_id, month, requests, pu) VALUES (${farmId}, ${monthOf(day)}::date, 1, ${pu})
          ON CONFLICT (farm_id, month) DO UPDATE SET requests = remote_sensing_usage.requests + 1, pu = remote_sensing_usage.pu + excluded.pu
          RETURNING requests`,
    ),
  );
  return { requests: r?.requests ?? 0 };
}

export async function monthUsage(db: Database, farmId: string, day = today()): Promise<{ requests: number; pu: number }> {
  const [r] = await withFarm(db, farmId, (tx) =>
    rows<{ requests: number; pu: number }>(tx, sql`SELECT requests, pu FROM remote_sensing_usage WHERE month = ${monthOf(day)}::date`),
  );
  return { requests: r?.requests ?? 0, pu: r?.pu ?? 0 };
}

// --- Lectures ---------------------------------------------------------------

const imageUrl = (farmId: string, date: string, kind: SatelliteImageKind) => `/api/v1/farms/${farmId}/remote-sensing/images/${date}/${kind}`;

export async function remoteSensingStatus(db: Database, farmId: string): Promise<RemoteSensingStatus> {
  return withFarm(db, farmId, async (tx) => {
    const [integ] = await rows<{ enabled: boolean; settings: Record<string, string> }>(
      tx,
      sql`SELECT enabled, settings FROM integrations WHERE provider = 'copernicus' AND secret_ciphertext IS NOT NULL`,
    );
    const [scene] = await rows<{ d: string | null }>(tx, sql`SELECT max(acquired_on)::text AS d FROM satellite_scenes WHERE valid_ratio >= ${SCENE_MIN_VALID_RATIO}`);
    const month = monthOf(today());
    const [use] = await rows<{ requests: number; pu: number }>(tx, sql`SELECT requests, pu FROM remote_sensing_usage WHERE month = ${month}::date`);
    return {
      enabled: integ?.enabled ?? false,
      lastSceneOn: scene?.d ?? null,
      usage: { month, requests: use?.requests ?? 0, pu: Math.round((use?.pu ?? 0) * 100) / 100, budget: monthlyBudget(integ?.settings ?? {}) },
    };
  });
}

export async function listScenes(db: Database, farmId: string, from: string, to: string): Promise<SatelliteScene[]> {
  const list = await withFarm(db, farmId, (tx) =>
    rows<{ d: string; valid_ratio: number; kinds: SatelliteImageKind[] | null }>(
      tx,
      sql`SELECT s.acquired_on::text AS d, s.valid_ratio::float8 AS valid_ratio,
                 (SELECT array_agg(i.kind ORDER BY i.kind) FROM satellite_images i WHERE i.acquired_on = s.acquired_on) AS kinds
          FROM satellite_scenes s WHERE s.acquired_on BETWEEN ${from}::date AND ${to}::date ORDER BY s.acquired_on`,
    ),
  );
  return list.map((s) => ({ date: s.d, validRatio: s.valid_ratio, images: s.kinds ?? [] }));
}

export async function sceneImage(db: Database, farmId: string, date: string, kind: SatelliteImageKind): Promise<{ bytes: Uint8Array; etag: string }> {
  const [r] = await withFarm(db, farmId, (tx) =>
    rows<{ png: Buffer; etag: string }>(tx, sql`SELECT png, etag FROM satellite_images WHERE acquired_on = ${date}::date AND kind = ${kind}`),
  );
  if (!r) throw new NotFound("Image satellite introuvable.");
  return { bytes: new Uint8Array(r.png), etag: r.etag };
}

/** Dernière valeur exploitable de chaque parcelle à la date `at` (jour), et dernière image exploitable. */
export async function parcelIndicesAt(db: Database, farmId: string, at: string, index: VegetationIndex): Promise<ParcelIndicesAt> {
  return withFarm(db, farmId, async (tx) => {
    const frame = await farmFrame(tx, farmId, at, at);
    const epsg = frame?.epsg ?? 32631;
    const list = await rows<{
      parcel_id: string;
      version_id: string;
      parcel_px: number;
      d: string | null;
      mean: number | null;
      p10: number | null;
      p50: number | null;
      p90: number | null;
      valid_px: number | null;
      row_px: number | null;
    }>(
      tx,
      sql`
        SELECT v.land_parcel_id AS parcel_id, v.id AS version_id,
               floor(coalesce(ST_Area(ST_Buffer(ST_Transform(v.shape, ${epsg}::int), -10)), 0) / 100)::int AS parcel_px,
               last.d, last.mean, last.p10, last.p50, last.p90, last.valid_px, last.parcel_px AS row_px
        FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id
        LEFT JOIN LATERAL (
          SELECT pi.acquired_on::text AS d, pi.mean, pi.p10, pi.p50, pi.p90, pi.valid_px, pi.parcel_px
          FROM parcel_indices pi JOIN land_parcel_versions pv ON pv.id = pi.land_parcel_version_id
          WHERE pv.land_parcel_id = v.land_parcel_id AND pi.vegetation_index = ${index}
            AND pi.acquired_on <= ${at}::date AND pi.mean IS NOT NULL
            AND pi.parcel_px >= ${MIN_PARCEL_PIXELS} AND pi.valid_px >= ${USABLE_VALID_RATIO}::float8 * pi.parcel_px
          ORDER BY pi.acquired_on DESC LIMIT 1) last ON true
        WHERE lp.farm_id = ${farmId} AND v.valid @> ${at}::date::timestamptz + interval '12 hours' AND NOT ST_IsEmpty(v.shape)
        ORDER BY lp.name`,
    );
    const images = await rows<{ d: string; kind: SatelliteImageKind; west: number; south: number; east: number; north: number }>(
      tx,
      sql`SELECT DISTINCT ON (i.kind) i.acquired_on::text AS d, i.kind, i.west, i.south, i.east, i.north
          FROM satellite_images i WHERE i.acquired_on <= ${at}::date ORDER BY i.kind, i.acquired_on DESC`,
    );
    const years = list.filter((r) => r.d).map((r) => Number(r.d!.slice(0, 4)));
    return {
      at,
      index,
      items: list.map((r) => {
        const { status, ageDays } = parcelIndexStatus(r.parcel_px, r.d, at);
        const shown = status === "ok" || status === "stale";
        return {
          parcelId: r.parcel_id,
          versionId: r.version_id,
          status,
          date: shown ? r.d : null,
          ageDays,
          mean: shown ? r.mean : null,
          p10: shown ? r.p10 : null,
          p50: shown ? r.p50 : null,
          p90: shown ? r.p90 : null,
          validRatio: shown && r.valid_px !== null && r.row_px ? Math.round(validRatio(r.valid_px, r.row_px) * 100) / 100 : null,
          parcelPixels: r.parcel_px,
        };
      }),
      images: images.map(
        (i): SatelliteImageRef => ({ date: i.d, kind: i.kind, bbox: [i.west, i.south, i.east, i.north], url: imageUrl(farmId, i.d, i.kind) }),
      ),
      attribution: copernicusAttribution([...years, ...images.map((i) => Number(i.d.slice(0, 4)))]),
    };
  });
}

/** Série d'une parcelle à travers ses versions, lissée, avec la référence des années précédentes. */
export async function parcelSeries(
  db: Database,
  farmId: string,
  parcelId: string,
  index: VegetationIndex,
  from: string,
  to: string,
): Promise<ParcelIndexSeries> {
  return withFarm(db, farmId, async (tx) => {
    const [parcel] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!parcel) throw new NotFound("Parcelle introuvable.");
    const all = await rows<{ d: string; mean: number | null; p10: number | null; p90: number | null; valid_px: number; parcel_px: number }>(
      tx,
      sql`SELECT pi.acquired_on::text AS d, pi.mean, pi.p10, pi.p90, pi.valid_px, pi.parcel_px
          FROM parcel_indices pi JOIN land_parcel_versions v ON v.id = pi.land_parcel_version_id
          WHERE v.land_parcel_id = ${parcelId} AND pi.vegetation_index = ${index}
            AND pi.acquired_on BETWEEN ${minusYears(from, 5)}::date AND ${to}::date
          ORDER BY pi.acquired_on`,
    );
    const frame = await farmFrame(tx, farmId, to, to);
    const [current] = await rows<{ px: number }>(
      tx,
      sql`SELECT floor(coalesce(ST_Area(ST_Buffer(ST_Transform(v.shape, ${frame?.epsg ?? 32631}::int), -10)), 0) / 100)::int AS px
          FROM land_parcel_versions v WHERE v.land_parcel_id = ${parcelId}
          ORDER BY (v.valid @> ${to}::date::timestamptz + interval '12 hours') DESC, upper(v.valid) DESC NULLS FIRST LIMIT 1`,
    );
    const interventions = await rows<{ id: string; procedure: string; at: string }>(
      tx,
      sql`SELECT DISTINCT i.id, i.procedure, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS at
          FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
          WHERE i.started_at >= ${from}::date AND i.started_at < ${to}::date + 1
          ORDER BY 3`,
    );
    const usable = all.filter((r) => r.mean !== null && isUsable(r.valid_px, r.parcel_px)).map((r) => ({ date: r.d, value: r.mean! }));
    const reference = referenceCurve(usable, { from, to });
    const parcelPixels = current?.px ?? 0;
    return {
      parcelId,
      index,
      from,
      to,
      parcelPixels,
      tooSmall: parcelPixels < MIN_PARCEL_PIXELS,
      points: all
        .filter((r) => r.d >= from)
        .map((r) => ({
          date: r.d,
          mean: r.mean,
          p10: r.p10,
          p90: r.p90,
          validRatio: Math.round(validRatio(r.valid_px, r.parcel_px) * 100) / 100,
          usable: r.mean !== null && isUsable(r.valid_px, r.parcel_px),
        })),
      smoothed: smoothDaily(usable, { from, to }),
      reference: reference.curve,
      referenceYears: reference.years,
      interventions,
      attribution: copernicusAttribution(all.map((r) => Number(r.d.slice(0, 4)))),
    };
  });
}

/**
 * Interventions probablement manquantes (lot Z) : chutes du NDVI vers le sol
 * nu, terminées dans [from, to], sans intervention réalisée qui retire le
 * couvert de 7 jours avant à 30 jours après (COVER_LOSS), dont ce délai est
 * écoulé à `asOf`, hors vignes (chute des feuilles) et hors chutes écartées.
 */
export async function coverLossAnomalies(db: Database, farmId: string, from: string, to: string, asOf = today()): Promise<CoverLossAnomaly[]> {
  return withFarm(db, farmId, async (tx) => {
    const lookFrom = addDays(from, -COVER_LOSS.maxDays);
    const points = await rows<{ parcel_id: string; name: string; d: string; mean: number }>(
      tx,
      sql`SELECT v.land_parcel_id AS parcel_id, lp.name, pi.acquired_on::text AS d, pi.mean
          FROM parcel_indices pi JOIN land_parcel_versions v ON v.id = pi.land_parcel_version_id
          JOIN land_parcels lp ON lp.id = v.land_parcel_id
          WHERE lp.farm_id = ${farmId} AND pi.vegetation_index = 'ndvi' AND pi.mean IS NOT NULL
            AND pi.parcel_px >= ${MIN_PARCEL_PIXELS} AND pi.valid_px >= ${USABLE_VALID_RATIO}::float8 * pi.parcel_px
            AND pi.acquired_on BETWEEN ${lookFrom}::date AND ${addDays(to, COVER_LOSS.confirmDays)}::date
          ORDER BY 1, 3`,
    );
    if (points.length === 0) return [];
    const procedures = sql.join(COVER_REMOVING_PROCEDURES.map((c) => sql`${c}`), sql`, `);
    const done = await rows<{ parcel_id: string; d: string }>(
      tx,
      sql`SELECT DISTINCT t.ref_id AS parcel_id, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS d
          FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target'
          WHERE i.status = 'done' AND i.procedure IN (${procedures})
            AND i.started_at >= ${lookFrom}::date AND i.started_at < ${addDays(to, COVER_LOSS.afterDays + 1)}::date`,
    );
    const vines = await rows<{ parcel_id: string; year: number }>(
      tx,
      sql`SELECT p.land_parcel_id AS parcel_id, c.year FROM productions p JOIN campaigns c ON c.id = p.campaign_id WHERE p.nature = 'vine' AND NOT p.declared`,
    );
    const dismissed = await rows<{ parcel_id: string; d: string }>(tx, sql`SELECT land_parcel_id AS parcel_id, event_to::text AS d FROM remote_sensing_dismissals`);

    const byParcel = new Map<string, { name: string; pts: { date: string; value: number }[] }>();
    for (const p of points) {
      const e = byParcel.get(p.parcel_id) ?? { name: p.name, pts: [] };
      e.pts.push({ date: p.d, value: p.mean });
      byParcel.set(p.parcel_id, e);
    }
    const doneBy = (id: string) => done.filter((d) => d.parcel_id === id).map((d) => d.d);
    const isVine = new Set(vines.map((v) => `${v.parcel_id}:${v.year}`));
    const isDismissed = new Set(dismissed.map((d) => `${d.parcel_id}:${d.d}`));
    const out: CoverLossAnomaly[] = [];
    for (const [parcelId, { name, pts }] of byParcel) {
      for (const e of coverLossEvents(pts, COVER_LOSS)) {
        if (e.to < from || e.to > to) continue;
        const dueSince = addDays(e.to, COVER_LOSS.afterDays);
        if (dueSince >= asOf) continue; // la récolte peut encore venir
        if (isVine.has(`${parcelId}:${Number(e.to.slice(0, 4))}`)) continue;
        if (isDismissed.has(`${parcelId}:${e.to}`)) continue;
        if (explainsCoverLoss(e, doneBy(parcelId), COVER_LOSS)) continue;
        out.push({ parcelId, parcelName: name, ...e, dueSince, suggestedProcedure: "harvesting" });
      }
    }
    return out.sort((a, b) => b.to.localeCompare(a.to) || a.parcelName.localeCompare(b.parcelName));
  });
}

/** Écarte une chute signalée (« ce n'est pas une récolte »). */
export async function dismissCoverLoss(db: Database, farmId: string, userId: string, parcelId: string, to: string, reason: string | null): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [parcel] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!parcel) throw new NotFound("Parcelle introuvable.");
    await tx.execute(sql`
      INSERT INTO remote_sensing_dismissals (farm_id, land_parcel_id, event_to, reason, dismissed_by)
      VALUES (${farmId}, ${parcelId}, ${to}::date, ${reason}, ${userId})
      ON CONFLICT (land_parcel_id, event_to) DO UPDATE SET reason = excluded.reason, dismissed_by = excluded.dismissed_by, dismissed_at = now()`);
  });
}

export const isVegetationIndex = (v: string | undefined): v is VegetationIndex => VEGETATION_INDICES.includes(v as VegetationIndex);
