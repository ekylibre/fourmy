import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";

/**
 * Éléments du paysage déclarés par la ferme (lot IM3) : haies, arbres,
 * mares, zones de densification des haies du dossier PAC. Servis en GeoJSON
 * pour la carte ; la campagne la plus récente quand aucune n'est demandée.
 */
export async function landscapeFeatures(db: Database, farmId: string, campaign: number | null) {
  return withFarm(db, farmId, async (tx) => {
    const list = (await tx.execute(sql`
      WITH latest AS (SELECT max(campaign) AS c FROM farm_landscape_features)
      SELECT f.id, f.kind, f.cap_type, f.width_m, f.area_m2, f.campaign, f.attrs->>'label' AS label, ST_AsGeoJSON(f.geom)::json AS geometry
      FROM farm_landscape_features f, latest
      WHERE f.campaign IS NOT DISTINCT FROM coalesce(${campaign}::int, latest.c)
      ORDER BY f.kind, f.id`)) as unknown as {
      id: string;
      kind: string;
      cap_type: string | null;
      width_m: number | null;
      area_m2: number | null;
      campaign: number | null;
      label: string | null;
      geometry: unknown;
    }[];
    return {
      type: "FeatureCollection" as const,
      features: list.map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: { id: f.id, kind: f.kind, label: f.label, capType: f.cap_type, widthM: f.width_m, areaM2: f.area_m2, campaign: f.campaign },
      })),
    };
  });
}
