import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import type { TrackReplay, TrackCoverage } from "@fourmy/contracts";

/**
 * Traces GPS et couverture (agent C, US-1 / US-3).
 * Les positions d'un matériel sont celles de ses rattachements traceur ; la
 * simplification (Douglas-Peucker) conserve l'horodatage en coordonnée M.
 */

const DEG_PER_M = 1 / 111_320;

export async function trackReplay(
  db: Database,
  farmId: string,
  q: { equipmentId: string; from: string; to: string; toleranceM: number },
): Promise<TrackReplay> {
  return withFarm(db, farmId, async (tx) => {
    // Simplification par tronçon d'état constant (au travail, largeur) : un
    // tronçon garde ses deux bouts, donc la bascule travail / relevé reste à
    // sa place (rejeu 3D : outil relevé, bande travaillée).
    const rows = (await tx.execute(sql`
      WITH pts AS (
        SELECT p.time, p.point, (p.attrs->>'working')::boolean AS working,
               CASE WHEN jsonb_typeof(p.attrs->'widthM') = 'number' AND (p.attrs->>'widthM')::float8 > 0
                    THEN (p.attrs->>'widthM')::float8 END AS width
        FROM positions p
        JOIN tracker_bindings b ON b.id = p.binding_id AND b.equipment_id = ${q.equipmentId}
        WHERE p.time >= ${q.from}::timestamptz AND p.time < ${q.to}::timestamptz
      ),
      marked AS (
        SELECT *, CASE WHEN (working, width) IS NOT DISTINCT FROM (lag(working) OVER w, lag(width) OVER w) THEN 0 ELSE 1 END AS change
        FROM pts WINDOW w AS (ORDER BY time)
      ),
      runs AS (
        SELECT *, sum(change) OVER (ORDER BY time) AS run FROM marked
      ),
      lines AS (
        SELECT run, min(working::int)::boolean AS working, min(width) AS width, count(*) AS n,
               ST_MakeLine(ST_MakePointM(ST_X(point), ST_Y(point), extract(epoch FROM time)) ORDER BY time) AS g
        FROM runs GROUP BY run
      ),
      samples AS (
        SELECT l.run, l.working, l.width, d.geom, to_timestamp(ST_M(d.geom)) AS t
        FROM lines l,
             LATERAL ST_DumpPoints(CASE WHEN l.n >= 2 THEN ST_Simplify(l.g, ${q.toleranceM * DEG_PER_M}, true) ELSE ST_StartPoint(l.g) END) d
      )
      SELECT (SELECT count(*) FROM pts)::int AS n, s.t, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, s.working, s.width
      FROM samples s
      WHERE (SELECT count(*) FROM pts) >= 2
      ORDER BY s.t, s.run`)) as unknown as {
      n: number;
      t: Date | string;
      lon: number;
      lat: number;
      working: boolean | null;
      width: number | null;
    }[];
    // Deux tronçons voisins ne partagent pas de sommet ; un même instant n'est gardé qu'une fois.
    const samples: TrackReplay["samples"] = [];
    for (const r of rows) {
      const t = new Date(r.t).toISOString();
      if (samples.length && samples.at(-1)![0] >= t) continue;
      samples.push([t, r.lon, r.lat, r.working, r.width === null ? null : Number(r.width)]);
    }
    const sessions = (await tx.execute(sql`
      SELECT kind, greatest(started_at, ${q.from}::timestamptz) AS f, least(stopped_at, ${q.to}::timestamptz) AS t
      FROM track_sessions
      WHERE equipment_id = ${q.equipmentId} AND stopped_at > ${q.from}::timestamptz AND started_at < ${q.to}::timestamptz
      ORDER BY started_at`)) as unknown as { kind: "work" | "transit"; f: Date | string; t: Date | string }[];
    return {
      equipmentId: q.equipmentId,
      from: q.from,
      to: q.to,
      rawCount: rows[0]?.n ?? 0,
      toleranceM: q.toleranceM,
      samples,
      sessions: sessions.map((x) => ({ kind: x.kind, from: new Date(x.f).toISOString(), to: new Date(x.t).toISOString() })),
    };
  });
}

/**
 * Couverture par parcelle : segments consécutifs « au travail » (écart borné
 * à `maxGapS`), attribués à la parcelle valide qui contient leur milieu.
 * Surface = union des bandes de largeur d'outil (Traccar `workingWidth`,
 * sinon `defaultWidthM`) intersectée avec la parcelle.
 */
export async function trackCoverage(
  db: Database,
  farmId: string,
  q: { equipmentId: string; from: string; to: string; defaultWidthM: number; maxGapS: number },
): Promise<TrackCoverage> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      WITH pts AS (
        SELECT p.time, p.point,
               coalesce((p.attrs->>'working')::boolean, false) AS working,
               coalesce((p.attrs->>'widthM')::float8, ${q.defaultWidthM}) AS width,
               p.attrs->>'tool' AS tool,
               lead(p.time) OVER w AS next_time,
               lead(p.point) OVER w AS next_point
        FROM positions p
        JOIN tracker_bindings b ON b.id = p.binding_id AND b.equipment_id = ${q.equipmentId}
        WHERE p.time >= ${q.from}::timestamptz AND p.time < ${q.to}::timestamptz
        WINDOW w AS (PARTITION BY p.binding_id ORDER BY p.time)
      ),
      segs AS (
        SELECT time, least(extract(epoch FROM next_time - time), ${q.maxGapS}) AS dt,
               ST_MakeLine(point, next_point) AS seg, width, tool
        FROM pts
        WHERE working AND next_time IS NOT NULL
          AND ST_Distance(point::geography, next_point::geography) > 0.1
      ),
      attributed AS (
        SELECT lp.id, lp.name, v.shape, v.area_m2, s.dt, s.seg, s.width, s.tool
        FROM segs s
        JOIN land_parcel_versions v ON v.valid @> s.time
         AND ST_Intersects(v.shape, ST_LineInterpolatePoint(s.seg, 0.5))
        JOIN land_parcels lp ON lp.id = v.land_parcel_id
      )
      SELECT id, name, area_m2::float8 AS parcel_area_m2,
             sum(dt)::float8 AS duration_s,
             ST_Area(ST_Intersection(
               shape, ST_Union(ST_Buffer(seg::geography, width / 2)::geometry))::geography)::float8 AS area_m2,
             array_remove(array_agg(DISTINCT tool), NULL) AS tools
      FROM attributed
      GROUP BY id, name, area_m2, shape
      ORDER BY duration_s DESC`)) as unknown as {
      id: string;
      name: string;
      parcel_area_m2: number;
      duration_s: number;
      area_m2: number;
      tools: string[];
    }[];
    return {
      equipmentId: q.equipmentId,
      from: q.from,
      to: q.to,
      byParcel: rows.map((r) => ({
        landParcelId: r.id,
        parcelName: r.name,
        durationS: Math.round(r.duration_s),
        areaM2: Math.round(r.area_m2),
        parcelAreaM2: Math.round(r.parcel_area_m2),
        tools: r.tools,
      })),
    };
  });
}

/**
 * CZML pour Cesium (ADR-8) : un paquet document (horloge) + une entité par
 * matériel, positions échantillonnées sur la même horloge que la frise.
 */
export function toCzml(track: TrackReplay, name: string): unknown[] {
  const first = track.samples[0]?.[0] ?? track.from;
  const last = track.samples.at(-1)?.[0] ?? track.to;
  const epoch = Date.parse(first);
  const cartographicDegrees: number[] = [];
  for (const [t, lon, lat] of track.samples) {
    cartographicDegrees.push((Date.parse(t) - epoch) / 1000, lon, lat, 0);
  }
  return [
    {
      id: "document",
      name: `Trace ${name}`,
      version: "1.0",
      clock: { interval: `${first}/${last}`, currentTime: first, multiplier: 60, range: "CLAMPED" },
    },
    {
      id: `equipment/${track.equipmentId}`,
      name,
      availability: `${first}/${last}`,
      position: { epoch: first, interpolationAlgorithm: "LINEAR", cartographicDegrees },
      point: { pixelSize: 10, color: { rgba: [232, 93, 4, 255] }, heightReference: "CLAMP_TO_GROUND" },
      path: {
        leadTime: 0,
        trailTime: 1800,
        width: 3,
        resolution: 5,
        material: { solidColor: { color: { rgba: [232, 93, 4, 200] } } },
      },
    },
  ];
}
