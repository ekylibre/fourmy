import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { COVER_REMOVING_PROCEDURES, MIN_PARCEL_PIXELS, USABLE_VALID_RATIO, type ParcelRowsWrite, type ParcelVegetation } from "@fourmy/contracts";
import { addDays, canopyAt, cropProfile, smoothDaily, utmEpsg } from "@fourmy/domain";
import { NotFound } from "../routes/helpers.js";

/**
 * Végétation du plan 3D (lot AA, docs/jumeau-3d.md) : pour chaque parcelle
 * valide au jour, ses rangs (saisis, sinon grand axe de la parcelle et
 * inter-rang de la culture) et l'état de son couvert (NDVI lissé des
 * 240 derniers jours, interventions qui retirent le couvert).
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Fenêtre de NDVI qui fonde l'état du couvert (un cycle de culture et sa reprise). */
const HISTORY_DAYS = 240;

export async function vegetationAt(db: Database, farmId: string, day: string): Promise<ParcelVegetation[]> {
  return withFarm(db, farmId, async (tx) => {
    const noon = sql`${day}::date::timestamptz + interval '12 hours'`;
    const [center] = await rows<{ lon: number | null; lat: number | null }>(
      tx,
      sql`SELECT ST_X(c) AS lon, ST_Y(c) AS lat FROM (SELECT ST_Centroid(ST_Collect(v.shape)) AS c FROM land_parcel_versions v
          JOIN land_parcels lp ON lp.id = v.land_parcel_id WHERE lp.farm_id = ${farmId} AND v.valid @> ${noon}) x`,
    );
    if (center?.lon == null || center.lat == null) return [];
    const epsg = utmEpsg(center.lon, center.lat);
    const parcels = await rows<{ id: string; nature: string | null; species: string | null; bearing: number | null; spacing: number | null; auto_bearing: number | null }>(
      tx,
      sql`
        SELECT v.land_parcel_id AS id, prod.nature, prod.species, pr.bearing_deg AS bearing, pr.spacing_m AS spacing,
               -- Grand axe du rectangle orienté minimal, en degrés depuis le nord, ramené à [0, 180[.
               CASE WHEN ST_Distance(e.p1, e.p2) >= ST_Distance(e.p2, e.p3)
                    THEN mod(degrees(ST_Azimuth(e.p1, e.p2))::numeric, 180)
                    ELSE mod(degrees(ST_Azimuth(e.p2, e.p3))::numeric, 180) END::float8 AS auto_bearing
        FROM land_parcel_versions v
        JOIN land_parcels lp ON lp.id = v.land_parcel_id
        LEFT JOIN LATERAL (
          SELECT p.nature, coalesce(p.cultivation, p.species) AS species FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          WHERE p.land_parcel_id = v.land_parcel_id AND c.year = extract(year FROM ${day}::date)::int AND NOT p.declared
          ORDER BY p.updated_at DESC LIMIT 1) prod ON true
        LEFT JOIN parcel_rows pr ON pr.land_parcel_id = v.land_parcel_id
        CROSS JOIN LATERAL (
          SELECT ST_PointN(r, 1) AS p1, ST_PointN(r, 2) AS p2, ST_PointN(r, 3) AS p3
          FROM (SELECT ST_ExteriorRing(ST_OrientedEnvelope(ST_Transform(v.shape, ${epsg}::int))) AS r) x) e
        WHERE lp.farm_id = ${farmId} AND v.valid @> ${noon} AND NOT ST_IsEmpty(v.shape)`,
    );
    if (parcels.length === 0) return [];
    const points = await rows<{ id: string; d: string; mean: number }>(
      tx,
      sql`SELECT v.land_parcel_id AS id, pi.acquired_on::text AS d, pi.mean
          FROM parcel_indices pi JOIN land_parcel_versions v ON v.id = pi.land_parcel_version_id
          JOIN land_parcels lp ON lp.id = v.land_parcel_id
          WHERE lp.farm_id = ${farmId} AND pi.vegetation_index = 'ndvi' AND pi.mean IS NOT NULL
            AND pi.parcel_px >= ${MIN_PARCEL_PIXELS} AND pi.valid_px >= ${USABLE_VALID_RATIO}::float8 * pi.parcel_px
            AND pi.acquired_on BETWEEN ${addDays(day, -HISTORY_DAYS)}::date AND ${day}::date
          ORDER BY 1, 2`,
    );
    const procedures = sql.join(COVER_REMOVING_PROCEDURES.map((c) => sql`${c}`), sql`, `);
    const removals = await rows<{ id: string; d: string }>(
      tx,
      sql`SELECT DISTINCT t.ref_id AS id, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS d
          FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target'
          WHERE i.status = 'done' AND i.procedure IN (${procedures})
            AND i.started_at >= ${addDays(day, -HISTORY_DAYS)}::date AND i.started_at < ${day}::date + 1`,
    );
    const byParcel = <T extends { id: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of list) m.set(r.id, [...(m.get(r.id) ?? []), r]);
      return m;
    };
    const pts = byParcel(points);
    const rem = byParcel(removals);
    return parcels.map((p) => {
      const profile = cropProfile(p.species, p.nature);
      const series = (pts.get(p.id) ?? []).map((r) => ({ date: r.d, value: r.mean }));
      return {
        parcelId: p.id,
        species: p.species,
        nature: p.nature,
        rows:
          p.bearing !== null && p.spacing !== null
            ? { bearingDeg: p.bearing, spacingM: p.spacing, auto: false }
            : { bearingDeg: Math.round((p.auto_bearing ?? 0) * 10) / 10, spacingM: profile.spacingM, auto: true },
        canopy: canopyAt({
          day,
          nature: p.nature,
          species: p.species,
          smoothed: smoothDaily(series, { from: addDays(day, -HISTORY_DAYS), to: day }),
          removals: (rem.get(p.id) ?? []).map((r) => r.d),
        }),
      };
    });
  });
}

export async function setParcelRows(db: Database, farmId: string, userId: string, parcelId: string, input: ParcelRowsWrite | null): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [parcel] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!parcel) throw new NotFound("Parcelle introuvable.");
    if (input === null) {
      await tx.execute(sql`DELETE FROM parcel_rows WHERE land_parcel_id = ${parcelId}`);
      return;
    }
    await tx.execute(sql`
      INSERT INTO parcel_rows (land_parcel_id, farm_id, bearing_deg, spacing_m, updated_by)
      VALUES (${parcelId}, ${farmId}, ${input.bearingDeg}, ${input.spacingM}, ${userId})
      ON CONFLICT (land_parcel_id) DO UPDATE SET bearing_deg = excluded.bearing_deg, spacing_m = excluded.spacing_m,
        updated_by = excluded.updated_by, updated_at = now()`);
  });
}
