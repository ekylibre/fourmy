import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  DEFAULT_TRACK_SETTINGS,
  trackSettings,
  type TrackDraft,
  type TrackSession,
  type TrackSessionDetail,
  type TrackSessionList,
  type TrackSettings,
  type TrackSummary,
} from "@fourmy/contracts";
import { draftFromSessions, segmentSessions, settingsHash, type DraftContext, type SessionSpan, type TrackPosition } from "@fourmy/domain";
import { uuidv5 } from "@fourmy/migrator-ekylibre";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";
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
  width_m: number | string | null;
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
  -- Largeur de travail annoncée par le boîtier pendant le parcours (la plus fréquente).
  (SELECT mode() WITHIN GROUP (ORDER BY (p.attrs->>'widthM')::float8) FROM positions p
    WHERE p.binding_id = s.binding_id AND p.time >= s.started_at AND p.time <= s.stopped_at
      AND p.attrs->>'widthM' ~ '^[0-9]+(\.[0-9]+)?$') AS width_m,
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
    widthM: r.width_m === null ? null : Number(r.width_m),
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

// ---------------------------------------------------------------------------
// Parcours → intervention (lot P, FR-GPS-20 à 24)
// ---------------------------------------------------------------------------

const uuidList = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/**
 * Brouillon d'intervention depuis des parcours libres d'un même matériel
 * (design §4.3). Rien n'est écrit. 404 si un parcours est inconnu ; 409 s'il
 * est déjà rattaché, ou si les parcours sont de plusieurs matériels
 * (FR-GPS-25 hors v1).
 *  - outil : l'outil résolu des parcours (le plus long en durée), sinon le
 *    plus souvent attelé au matériel dans les interventions réalisées des
 *    12 mois précédents ;
 *  - conducteur : l'intervenant le plus fréquent avec ce matériel (12 mois) ;
 *  - procédures : les plus fréquentes avec l'outil (ou le matériel), 3 ans ;
 *  - zones : union des couvertures, découpée par parcelle (PostGIS).
 */
export async function buildTrackDraft(tx: Tx, sessionIds: readonly string[]): Promise<TrackDraft> {
  const ids = [...new Set(sessionIds)];
  const list = await rows<{
    id: string;
    equipment_id: string;
    kind: "work" | "transit";
    started_at: string | Date;
    stopped_at: string | Date;
    covered_area_m2: string | null;
    parcels: TrackSession["parcels"];
    tool_hint: string | null;
    tool_equipment_id: string | null;
    tool_name: string | null;
    intervention_id: string | null;
  }>(
    tx,
    sql`SELECT s.id, s.equipment_id, s.kind, s.started_at, s.stopped_at, s.covered_area_m2, s.parcels, s.tool_hint,
               s.tool_equipment_id, t.name AS tool_name, s.intervention_id
        FROM track_sessions s LEFT JOIN equipments t ON t.id = s.tool_equipment_id
        WHERE s.id IN (${uuidList(ids)})`,
  );
  if (list.length < ids.length) throw new NotFound("Parcours introuvable.");
  if (list.some((s) => s.intervention_id)) throw new Conflict("Parcours déjà rattaché à une intervention : il n'est plus sélectionnable.");
  const trackers = new Set(list.map((s) => s.equipment_id));
  if (trackers.size > 1) throw new Conflict("Parcours de plusieurs matériels : créez l'intervention depuis un matériel, puis ajoutez l'autre attelage à la main.");
  const tracker = list[0]!.equipment_id;
  const settings = await trackSettingsTx(tx);
  const start = iso(list.reduce((a, s) => (ms(s.started_at) < ms(a) ? s.started_at : a), list[0]!.started_at));

  // Outil résolu des parcours, pondéré par la durée.
  const weight = new Map<string, { name: string; d: number }>();
  for (const s of list) {
    if (!s.tool_equipment_id) continue;
    const cur = weight.get(s.tool_equipment_id) ?? { name: s.tool_name!, d: 0 };
    weight.set(s.tool_equipment_id, { name: cur.name, d: cur.d + ms(s.stopped_at) - ms(s.started_at) });
  }
  const resolved = [...weight].sort((a, b) => b[1].d - a[1].d || a[0].localeCompare(b[0]))[0];
  let tool: DraftContext["tool"] = resolved ? { id: resolved[0], name: resolved[1].name, source: "traccar" } : null;
  let unlinkedToolHint: DraftContext["unlinkedToolHint"] = null;
  if (!tool) {
    const hint = mostFrequent(list.map((s) => s.tool_hint));
    if (hint) {
      const [look] = await rows<{ name: string }>(
        tx,
        sql`SELECT name FROM equipments
            WHERE id <> ${tracker} AND kind NOT IN ('tractor', 'self_propelled_equipment')
              AND strpos(lower(name), lower(trim(${hint}::text))) > 0
            ORDER BY length(name), name LIMIT 1`,
      );
      unlinkedToolHint = { hint, lookalike: look?.name ?? null };
    }
    {
      const [habit] = await rows<{ id: string; name: string }>(
        tx,
        sql`SELECT o.ref_id AS id, e.name
            FROM intervention_parameters me
            JOIN interventions i ON i.id = me.intervention_id AND i.status = 'done'
             AND coalesce(i.stopped_at, i.created_at) BETWEEN ${start}::timestamptz - interval '12 months' AND ${start}::timestamptz
            JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'tool' AND o.ref_type = 'equipment'
             AND o.ref_id <> me.ref_id AND (me.crew_id IS NULL OR o.crew_id = me.crew_id)
            JOIN equipments e ON e.id = o.ref_id AND e.kind NOT IN ('tractor', 'self_propelled_equipment')
            WHERE me.role = 'tool' AND me.ref_id = ${tracker}
            GROUP BY o.ref_id, e.name ORDER BY count(*) DESC, e.name LIMIT 1`,
      );
      if (habit) tool = { id: habit.id, name: habit.name, source: "habit" };
    }
  }
  const [driver] = await rows<{ id: string; name: string }>(
    tx,
    sql`SELECT d.ref_id AS id, pe.name
        FROM intervention_parameters me
        JOIN interventions i ON i.id = me.intervention_id AND i.status = 'done'
         AND coalesce(i.stopped_at, i.created_at) BETWEEN ${start}::timestamptz - interval '12 months' AND ${start}::timestamptz + interval '1 day'
        JOIN intervention_parameters d ON d.intervention_id = i.id AND d.role = 'doer' AND d.ref_type = 'person'
         AND (me.crew_id IS NULL OR d.crew_id = me.crew_id)
        JOIN people pe ON pe.id = d.ref_id AND pe.active
        WHERE me.role = 'tool' AND me.ref_id = ${tracker}
        GROUP BY d.ref_id, pe.name ORDER BY count(*) DESC, pe.name LIMIT 1`,
  );
  const procedures = await rows<{ procedure: string }>(
    tx,
    sql`SELECT i.procedure FROM interventions i
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'tool' AND p.ref_id = ${tool?.id ?? tracker}
        WHERE i.status = 'done' AND coalesce(i.stopped_at, i.created_at) > ${start}::timestamptz - interval '3 years'
        GROUP BY i.procedure ORDER BY count(*) DESC, i.procedure LIMIT 5`,
  );
  const work = list.filter((s) => s.kind === "work").map((s) => s.id);
  const parcelIds = [...new Set(list.filter((s) => s.kind === "work").flatMap((s) => (s.parcels ?? []).map((p) => p.landParcelId)))];
  const zones: Record<string, { areaM2: number; geometry: unknown }> = {};
  if (work.length && parcelIds.length) {
    const z = await rows<{ id: string; area: number; geometry: unknown }>(
      tx,
      sql`WITH u AS (SELECT ST_Union(coverage) AS g FROM track_sessions WHERE id IN (${uuidList(work)}) AND coverage IS NOT NULL),
               cut AS (
                 SELECT v.land_parcel_id AS id, ST_CollectionExtract(ST_Intersection(v.shape, u.g), 3) AS g
                 FROM u JOIN land_parcel_versions v ON v.valid @> ${start}::timestamptz AND ST_Intersects(v.shape, u.g)
                 WHERE u.g IS NOT NULL AND v.land_parcel_id IN (${uuidList(parcelIds)}))
          SELECT id, ST_Area(g::geography)::float8 AS area, ST_AsGeoJSON(ST_Multi(g), 7)::json AS geometry
          FROM cut WHERE NOT ST_IsEmpty(g)`,
    );
    for (const r of z) zones[r.id] = { areaM2: Number(r.area), geometry: r.geometry };
  }
  return draftFromSessions(
    list.map((s) => ({
      id: s.id,
      equipmentId: s.equipment_id,
      kind: s.kind,
      startedAt: iso(s.started_at),
      stoppedAt: iso(s.stopped_at),
      coveredAreaM2: s.covered_area_m2 === null ? null : Number(s.covered_area_m2),
      parcels: s.parcels ?? [],
    })),
    { settings, tool, driver: driver ?? null, unlinkedToolHint, zones, procedureSuggestions: procedures.map((p) => p.procedure) },
  );
}

const mostFrequent = (values: (string | null)[]) => {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
};

export async function draftTrackSessions(db: Database, farmId: string, sessionIds: readonly string[]): Promise<TrackDraft> {
  return withFarm(db, farmId, (tx) => buildTrackDraft(tx, sessionIds));
}

/** Parcours rattachés à une intervention (fiche, FR-GPS-23), dans l'ordre chronologique. */
export async function interventionTrackSessions(db: Database, farmId: string, interventionId: string): Promise<TrackSession[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<SessionRow>(
      tx,
      sql`SELECT ${SESSION_COLUMNS} FROM track_sessions s ${SESSION_JOINS}
          WHERE s.intervention_id = ${interventionId} ORDER BY s.started_at, s.id`,
    );
    return list.map((r) => toSession(r, r.equipment_id));
  });
}

/**
 * Rattache des parcours à une intervention, dans sa transaction d'écriture
 * (design §5) : étendue figée, attelage qui contient le matériel suivi.
 * 409 si l'un d'eux est inconnu ou rattaché à une autre intervention.
 */
export async function linkTrackSessions(tx: Tx, interventionId: string, sessionIds: readonly string[]) {
  const ids = [...new Set(sessionIds)];
  if (!ids.length) return;
  const done = await rows<{ id: string }>(
    tx,
    sql`UPDATE track_sessions s
        SET intervention_id = ${interventionId},
            linked_extent = coalesce(s.linked_extent, tstzrange(s.started_at, s.stopped_at)),
            crew_id = (SELECT c.id FROM intervention_crews c
                       WHERE c.intervention_id = ${interventionId}
                         AND EXISTS (SELECT 1 FROM intervention_parameters p
                                     WHERE p.crew_id = c.id AND p.role = 'tool' AND p.ref_id = s.equipment_id)
                       ORDER BY c.rank LIMIT 1)
        WHERE s.id IN (${uuidList(ids)}) AND (s.intervention_id IS NULL OR s.intervention_id = ${interventionId})
        RETURNING s.id`,
  );
  if (done.length < ids.length) throw new Conflict("Parcours GPS introuvable ou déjà rattaché à une autre intervention.");
}

/**
 * Synthèse des parcours de la ferme sur [from, to[ (tableau de bord) : par
 * matériel suivi, travail et déplacements, parcours libres, parcelles.
 * `enabled` : intégration Traccar active (lisible par tous les membres, sans
 * rien révéler de sa configuration).
 */
export async function trackSummary(db: Database, farmId: string, from: string, to: string): Promise<TrackSummary> {
  return withFarm(db, farmId, async (tx) => {
    const [flag] = await rows<{ enabled: boolean }>(
      tx,
      sql`SELECT EXISTS (SELECT 1 FROM integrations WHERE farm_id = ${farmId} AND provider = 'traccar' AND enabled) AS enabled`,
    );
    const list = await rows<{
      id: string;
      name: string;
      work_count: number;
      work_s: number;
      work_m: number;
      work_area: number;
      transit_count: number;
      transit_s: number;
      transit_m: number;
      free_work: number;
      parcels: { landParcelId: string; name: string; areaM2: number }[] | null;
      first_at: Date | string;
      last_at: Date | string;
    }>(
      tx,
      sql`WITH s AS (
            SELECT * FROM track_sessions
            WHERE farm_id = ${farmId} AND started_at < ${to}::timestamptz AND stopped_at > ${from}::timestamptz
          ),
          p AS (
            SELECT s.equipment_id, e->>'landParcelId' AS id, max(e->>'name') AS name, sum((e->>'areaM2')::numeric) AS area
            FROM s, jsonb_array_elements(s.parcels) e
            WHERE s.kind = 'work'
            GROUP BY 1, 2
          )
          SELECT eq.id, eq.name,
                 count(*) FILTER (WHERE s.kind = 'work')::int AS work_count,
                 coalesce(sum(extract(epoch FROM s.stopped_at - s.started_at)) FILTER (WHERE s.kind = 'work'), 0)::float AS work_s,
                 coalesce(sum(s.distance_m) FILTER (WHERE s.kind = 'work'), 0)::float AS work_m,
                 coalesce(sum(s.covered_area_m2) FILTER (WHERE s.kind = 'work'), 0)::float AS work_area,
                 count(*) FILTER (WHERE s.kind = 'transit')::int AS transit_count,
                 coalesce(sum(extract(epoch FROM s.stopped_at - s.started_at)) FILTER (WHERE s.kind = 'transit'), 0)::float AS transit_s,
                 coalesce(sum(s.distance_m) FILTER (WHERE s.kind = 'transit'), 0)::float AS transit_m,
                 count(*) FILTER (WHERE s.kind = 'work' AND s.intervention_id IS NULL)::int AS free_work,
                 (SELECT jsonb_agg(jsonb_build_object('landParcelId', p.id, 'name', p.name, 'areaM2', round(p.area)) ORDER BY p.area DESC)
                    FROM p WHERE p.equipment_id = eq.id) AS parcels,
                 min(s.started_at) AS first_at, max(s.stopped_at) AS last_at
          FROM s JOIN equipments eq ON eq.id = s.equipment_id
          GROUP BY eq.id, eq.name
          ORDER BY work_s DESC, eq.name`,
    );
    return {
      enabled: flag?.enabled ?? false,
      from,
      to,
      items: list.map((r) => ({
        equipment: { id: r.id, name: r.name },
        work: { count: r.work_count, durationS: Math.round(r.work_s), distanceM: Math.round(r.work_m), coveredAreaM2: Math.round(r.work_area) },
        transit: { count: r.transit_count, durationS: Math.round(r.transit_s), distanceM: Math.round(r.transit_m) },
        freeWork: r.free_work,
        parcels: (r.parcels ?? []).map((x) => ({ ...x, areaM2: Number(x.areaM2) })),
        firstAt: iso(r.first_at),
        lastAt: iso(r.last_at),
      })),
    };
  });
}
