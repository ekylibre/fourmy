import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import type { Snapshot, Equipment, Production } from "@fourmy/contracts";
import { listParcelsAt } from "./parcels.js";
import { listPlacesAt } from "./places.js";
import { listContainersAt } from "./containers.js";

/** État consolidé de la ferme à une date (FR-TIME-1, US-3). */
export async function snapshotAt(db: Database, farmId: string, at: string): Promise<Snapshot> {
  const [landParcels, places, containers, rest] = await Promise.all([
    listParcelsAt(db, farmId, at),
    listPlacesAt(db, farmId, at),
    listContainersAt(db, farmId, at),
    withFarm(db, farmId, async (tx) => {
      const productions = (await tx.execute(sql`
        SELECT p.id, p.farm_id AS "farmId", p.campaign_id AS "campaignId", p.land_parcel_id AS "landParcelId",
               p.nature, p.species, p.activity_id AS "activityId", p.created_at AS "createdAt", p.updated_at AS "updatedAt"
        FROM productions p JOIN campaigns c ON c.id = p.campaign_id
        -- Productions déclarées (historique importé) : hors de la carte.
        WHERE c.year = extract(year FROM ${at}::timestamptz)::int AND NOT p.declared`)) as unknown as Production[];
      const equipments = (await tx.execute(sql`
        SELECT id, farm_id AS "farmId", name, kind, state, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM equipments ORDER BY name`)) as unknown as Equipment[];
      return { productions, equipments };
    }),
  ]);
  const iso = <T extends { createdAt: unknown; updatedAt: unknown }>(r: T) => ({
    ...r,
    createdAt: new Date(r.createdAt as string).toISOString(),
    updatedAt: new Date(r.updatedAt as string).toISOString(),
  });
  return {
    at,
    landParcels,
    productions: rest.productions.map(iso).map((p) => ({ ...p, species: p.species ?? undefined })),
    places,
    containers,
    equipments: rest.equipments.map(iso).map((e) => ({ ...e, state: e.state ?? undefined })),
  };
}
