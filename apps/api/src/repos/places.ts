import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import type { PlaceAt, GeoJsonGeometry } from "@fourmy/contracts";

/** Bâtiments et locaux valides à une date, emprise en GeoJSON. */
export async function listPlacesAt(db: Database, farmId: string, at: string): Promise<PlaceAt[]> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.id, p.name, v.id AS version_id, v.kind,
             CASE WHEN v.footprint IS NULL THEN NULL ELSE ST_AsGeoJSON(v.footprint)::json END AS footprint,
             v.height_m, v.source, lower(v.valid) AS lower, upper(v.valid) AS upper
      FROM places p
      JOIN place_versions v ON v.place_id = p.id AND v.valid @> ${at}::timestamptz
      ORDER BY p.name`)) as unknown as {
      id: string;
      name: string;
      version_id: string;
      kind: "building" | "room" | "storage";
      footprint: GeoJsonGeometry | null;
      height_m: string | null;
      source: "ign" | "ekylibre" | "manual";
      lower: string;
      upper: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: {
        id: r.version_id,
        placeId: r.id,
        kind: r.kind,
        footprint: r.footprint ?? undefined,
        heightM: r.height_m === null ? undefined : Number(r.height_m),
        source: r.source,
        valid: { lower: r.lower, upper: r.upper },
      },
    }));
  });
}
