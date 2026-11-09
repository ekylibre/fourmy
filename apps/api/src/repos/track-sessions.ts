import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { DEFAULT_TRACK_SETTINGS, trackSettings, type TrackSettings } from "@fourmy/contracts";
import { segmentSessions, settingsHash, type SessionSpan, type TrackPosition } from "@fourmy/domain";
import { uuidv5 } from "@fourmy/migrator-ekylibre";

/**
 * Parcours GPS matérialisés (lot O, docs/parcours-attelages-design.md §2.3
 * et §6). Pour chaque rattachement traceur :
 *  1. fenêtre : depuis la fin du dernier parcours moins 2 × `stopMin`
 *     (positions tardives), recul jusqu'au début du parcours libre qu'elle
 *     coupe ; tout l'historique la première fois ou si les réglages ont
 *     changé (`settings_hash` d'un parcours libre différent) ;
 *  2. positions de la fenêtre, sans celles des plages figées des parcours
 *     rattachés : on découpe chaque tronçon entre deux plages à part ;
 *  3. `segmentSessions`, puis une requête PostGIS par parcours (couverture,
 *     parcelles à la date) — mêmes règles que `trackCoverage` ;
 *  4. remplacement des parcours libres de la fenêtre ;
 *  5. dérive des parcours rattachés touchés par la fenêtre (FR-GPS-15) ;
 *  6. outil résolu : attelage déclaré, puis attribut `tool` de Traccar
 *     (`external_ids.traccarTool`, sinon nom identique), puis matériel d'une
 *     intervention réalisée sur la plage.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

/** Largeur d'outil par défaut quand le boîtier n'envoie pas `widthM` (comme la couverture). */
export const DEFAULT_WIDTH_M = 3;
const DEG_PER_M = 1 / 111_320;
/** Écart toléré avant de signaler qu'un parcours rattaché a changé (FR-GPS-15). */
const DRIFT_TOLERANCE_MS = 60_000;

export interface TrackSessionsResult {
  bindings: number;
  inserted: number;
  deleted: number;
  drifted: number;
}

/** Réglages de découpage de la ferme (défauts complétés). */
export async function trackSettingsTx(tx: Tx): Promise<TrackSettings> {
  const [s] = await rows<{ tracks: Partial<TrackSettings> | null }>(tx, sql`SELECT tracks FROM farm_settings`);
  const parsed = trackSettings.safeParse({ ...DEFAULT_TRACK_SETTINGS, ...(s?.tracks ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_TRACK_SETTINGS;
}

/** Recalcule les parcours de tous les boîtiers de la ferme (une transaction par boîtier). */
export async function computeTrackSessions(db: Database, farmId: string): Promise<TrackSessionsResult> {
  const bindings = await withFarm(db, farmId, (tx) =>
    rows<{ id: string; equipment_id: string }>(tx, sql`SELECT id, equipment_id FROM tracker_bindings ORDER BY id`),
  );
  const total: TrackSessionsResult = { bindings: bindings.length, inserted: 0, deleted: 0, drifted: 0 };
  for (const b of bindings) {
    const r = await withFarm(db, farmId, (tx) => computeBinding(tx, farmId, b.id, b.equipment_id));
    total.inserted += r.inserted;
    total.deleted += r.deleted;
    total.drifted += r.drifted;
  }
  return total;
}

interface PositionRow {
  time: string | Date;
  lon: number;
  lat: number;
  speed: string | null;
  working: boolean | null;
  tool: string | null;
}
interface Linked {
  id: string;
  kind: "work" | "transit";
  started_at: string | Date;
  stopped_at: string | Date;
  lower: string | Date;
  upper: string | Date;
  drift: { startedAt: string; stoppedAt: string } | null;
}

const iso = (v: string | Date) => new Date(v).toISOString();
const ms = (v: string | Date) => new Date(v).getTime();

async function readPositions(tx: Tx, bindingId: string, from: string | null, to: string | null): Promise<TrackPosition[]> {
  const list = await rows<PositionRow>(
    tx,
    sql`SELECT p.time, ST_X(p.point) AS lon, ST_Y(p.point) AS lat, p.speed,
               (p.attrs->>'working')::boolean AS working, p.attrs->>'tool' AS tool
        FROM positions p JOIN tracker_bindings b ON b.id = p.binding_id
        WHERE p.binding_id = ${bindingId} AND b.valid @> p.time
          AND p.time >= ${from ?? "-infinity"}::timestamptz AND p.time <= ${to ?? "infinity"}::timestamptz
        ORDER BY p.time`,
  );
  return list.map((p) => ({
    time: iso(p.time),
    lon: Number(p.lon),
    lat: Number(p.lat),
    speedKmh: p.speed === null ? null : Number(p.speed),
    working: p.working,
    tool: p.tool,
  }));
}

async function computeBinding(tx: Tx, farmId: string, bindingId: string, equipmentId: string) {
  const settings = await trackSettingsTx(tx);
  const hash = settingsHash(settings);
  const stopMs = settings.stopMin * 60_000;

  // 1. Fenêtre.
  const [state] = await rows<{ last: string | Date | null; stale: boolean }>(
    tx,
    sql`SELECT max(stopped_at) AS last,
               coalesce(bool_or(intervention_id IS NULL AND settings_hash <> ${hash}), false) AS stale
        FROM track_sessions WHERE binding_id = ${bindingId}`,
  );
  let from: string | null = null;
  if (state?.last && !state.stale) {
    const cutoff = new Date(ms(state.last) - 2 * stopMs).toISOString();
    const [cut] = await rows<{ start: string | Date | null }>(
      tx,
      sql`SELECT min(started_at) AS start FROM track_sessions
          WHERE binding_id = ${bindingId} AND intervention_id IS NULL AND stopped_at > ${cutoff}::timestamptz`,
    );
    from = cut?.start && ms(cut.start) < ms(cutoff) ? iso(cut.start) : cutoff;
  }

  // 2. Positions, en tronçons séparés par les plages figées.
  const linked = await rows<Linked>(
    tx,
    sql`SELECT id, kind, started_at, stopped_at, lower(linked_extent) AS lower, upper(linked_extent) AS upper, drift
        FROM track_sessions WHERE binding_id = ${bindingId} AND intervention_id IS NOT NULL ORDER BY lower(linked_extent)`,
  );
  const positions = await readPositions(tx, bindingId, from, null);
  const chunks: TrackPosition[][] = [[]];
  let k = 0;
  for (const p of positions) {
    const t = ms(p.time);
    while (k < linked.length && ms(linked[k]!.upper) < t) {
      k++;
      if (chunks.at(-1)!.length) chunks.push([]);
    }
    const l = linked[k];
    if (l && ms(l.lower) <= t && t <= ms(l.upper)) {
      if (chunks.at(-1)!.length) chunks.push([]);
      continue;
    }
    chunks.at(-1)!.push(p);
  }
  const spans: { span: SessionSpan; pts: TrackPosition[] }[] = [];
  for (const pts of chunks) {
    for (const span of segmentSessions(pts, settings)) {
      if (ms(span.stoppedAt) > ms(span.startedAt)) spans.push({ span, pts });
    }
  }

  // 3-4. Remplacement des parcours libres de la fenêtre.
  const deleted = await rows<{ id: string }>(
    tx,
    sql`DELETE FROM track_sessions
        WHERE binding_id = ${bindingId} AND intervention_id IS NULL
          AND stopped_at > ${from ?? "-infinity"}::timestamptz
        RETURNING id`,
  );
  for (const { span } of spans) {
    await insertSession(tx, { farmId, bindingId, equipmentId, span, settings, hash });
  }

  // 5. Dérive des parcours rattachés touchés par la fenêtre.
  let drifted = 0;
  for (const l of linked) {
    if (from && ms(l.upper) < ms(from) - 2 * stopMs) continue;
    const around = await readPositions(
      tx,
      bindingId,
      new Date(ms(l.lower) - 2 * stopMs).toISOString(),
      new Date(ms(l.upper) + 2 * stopMs).toISOString(),
    );
    const drift = driftOf(l, segmentSessions(around, settings));
    if (drift) drifted++;
    if (JSON.stringify(drift) !== JSON.stringify(l.drift)) {
      await tx.execute(sql`UPDATE track_sessions SET drift = ${drift ? JSON.stringify(drift) : null}::jsonb WHERE id = ${l.id}`);
    }
  }
  return { inserted: spans.length, deleted: deleted.length, drifted };
}

/**
 * Bornes recalculées d'un parcours rattaché : le parcours du même type qui
 * recouvre le plus sa plage figée. Null si rien n'a bougé de plus d'une
 * minute (ou si plus aucun parcours ne la recouvre : rien à proposer).
 */
export function driftOf(
  l: { kind: string; lower: string | Date; upper: string | Date },
  spans: readonly SessionSpan[],
): { startedAt: string; stoppedAt: string } | null {
  const lo = ms(l.lower);
  const hi = ms(l.upper);
  let best: SessionSpan | null = null;
  let bestOverlap = 0;
  for (const s of spans) {
    if (s.kind !== l.kind) continue;
    const overlap = Math.min(hi, ms(s.stoppedAt)) - Math.max(lo, ms(s.startedAt));
    if (overlap > bestOverlap) [best, bestOverlap] = [s, overlap];
  }
  if (!best) return null;
  const moved = Math.abs(ms(best.startedAt) - lo) > DRIFT_TOLERANCE_MS || Math.abs(ms(best.stoppedAt) - hi) > DRIFT_TOLERANCE_MS;
  return moved ? { startedAt: best.startedAt, stoppedAt: best.stoppedAt } : null;
}

/**
 * Un parcours et sa géométrie, en une requête :
 *  - couverture = union des bandes de largeur d'outil des segments « au
 *    travail » (comme `trackCoverage`), simplifiée à 0,5 m ;
 *  - parcelles valides au début du parcours, avec la surface couverte dans
 *    chacune ; gardées si la part couverte atteint `parcelMinShare` ou la
 *    surface `parcelMinAreaM2` ;
 *  - outil résolu (voir l'en-tête).
 */
async function insertSession(
  tx: Tx,
  a: { farmId: string; bindingId: string; equipmentId: string; span: SessionSpan; settings: TrackSettings; hash: string },
) {
  const { span, settings } = a;
  const id = uuidv5(`track-session:${a.bindingId}:${span.startedAt}:${span.kind}`);
  const work = span.kind === "work";
  await tx.execute(sql`
    WITH pts AS (
      SELECT p.time, p.point,
             coalesce((p.attrs->>'working')::boolean, false) AS working,
             coalesce((p.attrs->>'widthM')::float8, ${DEFAULT_WIDTH_M}) AS width,
             lead(p.time) OVER w AS next_time, lead(p.point) OVER w AS next_point
      FROM positions p
      WHERE p.binding_id = ${a.bindingId}
        AND p.time >= ${span.startedAt}::timestamptz AND p.time <= ${span.stoppedAt}::timestamptz
      WINDOW w AS (ORDER BY p.time)
    ),
    cov AS (
      SELECT ST_Union(ST_Buffer(ST_MakeLine(point, next_point)::geography, width / 2)::geometry) AS g
      FROM pts
      WHERE ${work} AND working AND next_time IS NOT NULL
        AND ST_Distance(point::geography, next_point::geography) > 0.1
    ),
    parcels AS (
      SELECT lp.id, lp.name, v.area_m2::float8 AS parcel_area,
             ST_Area(ST_Intersection(v.shape, cov.g)::geography)::float8 AS area
      FROM cov
      JOIN land_parcel_versions v ON v.valid @> ${span.startedAt}::timestamptz AND ST_Intersects(v.shape, cov.g)
      JOIN land_parcels lp ON lp.id = v.land_parcel_id
      WHERE cov.g IS NOT NULL
    ),
    kept AS (
      SELECT id, name, area, CASE WHEN parcel_area > 0 THEN area / parcel_area ELSE 0 END AS share
      FROM parcels
    ),
    tool AS (
      SELECT coalesce(
        -- Attelage déclaré : un outil du même attelage que le matériel suivi, sur la plage.
        (SELECT o.ref_id FROM intervention_parameters me
           JOIN intervention_parameters o ON o.crew_id = me.crew_id AND o.role = 'tool' AND o.ref_type = 'equipment' AND o.ref_id <> me.ref_id
           JOIN intervention_periods w ON w.crew_id = me.crew_id
           JOIN interventions i ON i.id = me.intervention_id AND i.status = 'done'
           JOIN equipments e ON e.id = o.ref_id AND e.kind NOT IN ('tractor', 'self_propelled_equipment')
          WHERE me.role = 'tool' AND me.ref_id = ${a.equipmentId} AND me.crew_id IS NOT NULL
            AND w.started_at < ${span.stoppedAt}::timestamptz AND w.stopped_at > ${span.startedAt}::timestamptz
          ORDER BY least(w.stopped_at, ${span.stoppedAt}::timestamptz) - greatest(w.started_at, ${span.startedAt}::timestamptz) DESC, o.ref_id
          LIMIT 1),
        -- Attribut Traccar : lien posé à la main, sinon nom identique (jamais par inclusion).
        (SELECT e.id FROM equipments e
          WHERE ${span.toolHint}::text IS NOT NULL AND e.id <> ${a.equipmentId}
            AND (lower(trim(e.external_ids->>'traccarTool')) = lower(trim(${span.toolHint}::text))
                 OR lower(trim(e.name)) = lower(trim(${span.toolHint}::text)))
          ORDER BY (e.external_ids->>'traccarTool') IS NULL, e.id
          LIMIT 1),
        -- Déduction actuelle : seul outil d'une intervention réalisée sur la plage (mode libre).
        (SELECT min(o.ref_id::text)::uuid FROM interventions i
           JOIN intervention_periods w ON w.intervention_id = i.id
           JOIN intervention_parameters me ON me.intervention_id = i.id AND me.role = 'tool' AND me.ref_id = ${a.equipmentId}
           JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'tool' AND o.ref_type = 'equipment' AND o.ref_id <> ${a.equipmentId}
           JOIN equipments e ON e.id = o.ref_id AND e.kind NOT IN ('tractor', 'self_propelled_equipment')
          WHERE i.status = 'done' AND i.staffing = 'free'
            AND w.started_at < ${span.stoppedAt}::timestamptz AND w.stopped_at > ${span.startedAt}::timestamptz
          HAVING count(DISTINCT o.ref_id) = 1)
      ) AS id
    )
    INSERT INTO track_sessions (id, farm_id, equipment_id, binding_id, kind, started_at, stopped_at, position_count,
                                distance_m, covered_area_m2, coverage, parcels, tool_hint, tool_equipment_id, settings_hash)
    SELECT ${id}, ${a.farmId}, ${a.equipmentId}, ${a.bindingId}, ${span.kind},
           ${span.startedAt}::timestamptz, ${span.stoppedAt}::timestamptz, ${span.positionCount}, ${span.distanceM},
           CASE WHEN ${work} THEN coalesce(round(ST_Area(cov.g::geography)::numeric, 1), 0) END,
           ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(cov.g, ${0.5 * DEG_PER_M})), 3)),
           coalesce((SELECT jsonb_agg(jsonb_build_object('landParcelId', id, 'name', name, 'areaM2', round(area::numeric),
                                                         'share', round(share::numeric, 4)) ORDER BY area DESC, id)
                     FROM kept WHERE share >= ${settings.parcelMinShare} OR area >= ${settings.parcelMinAreaM2}), '[]'::jsonb),
           ${span.toolHint}, (SELECT id FROM tool), ${a.hash}
    FROM cov`);
}
