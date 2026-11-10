import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  DEFAULT_TRACK_SETTINGS,
  trackSettings,
  type TrackSession,
  type TrackSessionDetail,
  type TrackSessionList,
  type TrackSettings,
} from "@fourmy/contracts";
import { segmentSessions, settingsHash, type SessionSpan, type TrackPosition } from "@fourmy/domain";
import { uuidv5 } from "@fourmy/migrator-ekylibre";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { trackReplay } from "./tracks.js";

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

// ---------------------------------------------------------------------------
// Lecture (lot O3) : liste d'un matériel, détail, réglages
// ---------------------------------------------------------------------------

export interface TrackSessionQuery {
  equipmentId: string;
  from: string;
  to: string;
  kind?: "work" | "transit";
  parcelId?: string;
  state?: "free" | "linked";
  cursor?: string;
  limit: number;
}

type SessionRow = {
  id: string;
  equipment_id: string;
  kind: "work" | "transit";
  started_at: string | Date;
  stopped_at: string | Date;
  distance_m: string;
  covered_area_m2: string | null;
  parcels: TrackSession["parcels"];
  tool_hint: string | null;
  tool_id: string | null;
  tool_name: string | null;
  tracker_name: string;
  intervention_id: string | null;
  procedure: string | null;
  status: string | null;
  drift: TrackSession["drift"];
};

const SESSION_COLUMNS = sql`
  s.id, s.equipment_id, s.kind, s.started_at, s.stopped_at, s.distance_m, s.covered_area_m2, s.parcels, s.tool_hint,
  t.id AS tool_id, t.name AS tool_name, e.name AS tracker_name,
  i.id AS intervention_id, i.procedure, i.status, s.drift`;
const SESSION_JOINS = sql`
  JOIN equipments e ON e.id = s.equipment_id
  LEFT JOIN equipments t ON t.id = s.tool_equipment_id
  LEFT JOIN interventions i ON i.id = s.intervention_id`;

function toSession(r: SessionRow, viewer: string): TrackSession {
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    kind: r.kind,
    startedAt: iso(r.started_at),
    stoppedAt: iso(r.stopped_at),
    durationS: Math.round((ms(r.stopped_at) - ms(r.started_at)) / 1000),
    distanceM: Number(r.distance_m),
    coveredAreaM2: r.covered_area_m2 === null ? null : Number(r.covered_area_m2),
    parcels: r.parcels ?? [],
    toolHint: r.tool_hint,
    tool: r.tool_id ? { id: r.tool_id, name: r.tool_name! } : null,
    tracker: r.equipment_id === viewer ? null : { id: r.equipment_id, name: r.tracker_name },
    intervention: r.intervention_id ? { id: r.intervention_id, procedure: r.procedure!, status: r.status! } : null,
    drift: r.drift,
  };
}

/**
 * Parcours d'un matériel, du plus récent au plus ancien (FR-GPS-12, 13, 17) :
 * les siens s'il porte un boîtier ; pour un outil, ceux des matériels suivis
 * où il était attelé (outil résolu, ou attelage de l'intervention rattachée).
 * Curseur : « début|id » de la dernière ligne.
 */
export async function listTrackSessions(db: Database, farmId: string, q: TrackSessionQuery): Promise<TrackSessionList> {
  return withFarm(db, farmId, async (tx) => {
    let after = sql``;
    if (q.cursor) {
      const [at, id] = q.cursor.split("|");
      if (!at || !id || Number.isNaN(Date.parse(at))) throw new BadRequest("Curseur invalide.");
      after = sql`AND (s.started_at, s.id) < (${at}::timestamptz, ${id}::uuid)`;
    }
    const list = await rows<SessionRow>(
      tx,
      sql`SELECT ${SESSION_COLUMNS}
          FROM track_sessions s ${SESSION_JOINS}
          WHERE (s.equipment_id = ${q.equipmentId}
                 OR s.tool_equipment_id = ${q.equipmentId}
                 OR (s.crew_id IS NOT NULL AND EXISTS (SELECT 1 FROM intervention_parameters p
                       WHERE p.crew_id = s.crew_id AND p.role = 'tool' AND p.ref_id = ${q.equipmentId})))
            AND s.started_at < ${q.to}::timestamptz AND s.stopped_at > ${q.from}::timestamptz
            ${q.kind ? sql`AND s.kind = ${q.kind}` : sql``}
            ${q.state === "free" ? sql`AND s.intervention_id IS NULL` : q.state === "linked" ? sql`AND s.intervention_id IS NOT NULL` : sql``}
            ${q.parcelId ? sql`AND s.parcels @> ${JSON.stringify([{ landParcelId: q.parcelId }])}::jsonb` : sql``}
            ${after}
          ORDER BY s.started_at DESC, s.id DESC
          LIMIT ${q.limit + 1}`,
    );
    const page = list.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toSession(r, q.equipmentId)),
      nextCursor: list.length > q.limit && last ? `${iso(last.started_at)}|${last.id}` : null,
    };
  });
}

/** Un parcours, sa trace simplifiée et sa couverture. */
export async function getTrackSession(db: Database, farmId: string, id: string, viewer?: string): Promise<TrackSessionDetail> {
  const detail = await withFarm(db, farmId, async (tx) => {
    const [r] = await rows<SessionRow & { coverage: unknown }>(
      tx,
      sql`SELECT ${SESSION_COLUMNS}, ST_AsGeoJSON(s.coverage)::json AS coverage
          FROM track_sessions s ${SESSION_JOINS} WHERE s.id = ${id}`,
    );
    if (!r) throw new NotFound("Parcours introuvable.");
    return { session: toSession(r, viewer ?? r.equipment_id), coverage: r.coverage ?? null };
  });
  const s = detail.session;
  const track = await trackReplay(db, farmId, { equipmentId: s.equipmentId, from: s.startedAt, to: new Date(ms(s.stoppedAt) + 1000).toISOString(), toleranceM: 2 });
  return { ...s, samples: track.samples, coverage: detail.coverage };
}

export async function getTrackSettings(db: Database, farmId: string): Promise<TrackSettings> {
  return withFarm(db, farmId, trackSettingsTx);
}

/**
 * Réglages de la ferme (FR-GPS-16). Le changement de hash rend les parcours
 * libres « à recalculer » : le worker (ou `recompute`) les refait, les
 * parcours rattachés gardent leur étendue.
 */
export async function putTrackSettings(db: Database, farmId: string, body: TrackSettings): Promise<TrackSettings> {
  return withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, tracks) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET tracks = excluded.tracks, updated_at = now()`);
    return trackSettingsTx(tx);
  });
}
