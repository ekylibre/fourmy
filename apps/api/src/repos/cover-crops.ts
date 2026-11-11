import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { CoverCrop, CoverCropWrite } from "@fourmy/contracts";
import { NotFound } from "../routes/helpers.js";

/**
 * Couverts d'interculture (lot AI, FR-FERT-19, 23) : un par parcelle, avant
 * la culture principale d'une campagne. Ils nourrissent le cahier
 * d'enregistrement et le plan de fumure (MrCi, Ri après couvert).
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

type Row = {
  id: string;
  land_parcel_id: string;
  campaign: number;
  family: CoverCrop["family"];
  species: string;
  sown_on: string;
  destroyed_on: string | null;
  exported: boolean;
  biomass: CoverCrop["biomass"];
  destruction_mode: CoverCrop["destructionMode"];
  notes: string | null;
};
const view = (r: Row): CoverCrop => ({
  id: r.id,
  parcelId: r.land_parcel_id,
  campaign: r.campaign,
  family: r.family,
  species: r.species,
  sownOn: r.sown_on,
  destroyedOn: r.destroyed_on,
  exported: r.exported,
  biomass: r.biomass,
  destructionMode: r.destruction_mode,
  notes: r.notes,
});
const SELECT = sql`SELECT id, land_parcel_id, campaign, family, species, sown_on::text, destroyed_on::text, exported, biomass, destruction_mode, notes FROM cover_crops`;

export async function coversInTx(tx: Tx, parcelIds: string[], campaign: number): Promise<Map<string, CoverCrop>> {
  if (!parcelIds.length) return new Map();
  const list = await rows<Row>(tx, sql`${SELECT} WHERE campaign = ${campaign} AND land_parcel_id IN (SELECT unnest(${`{${parcelIds.join(",")}}`}::uuid[]))`);
  return new Map(list.map((r) => [r.land_parcel_id, view(r)]));
}

export async function saveCoverCrop(db: Database, farmId: string, parcelId: string, w: CoverCropWrite): Promise<CoverCrop> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!p) throw new NotFound("Parcelle introuvable.");
    const [r] = await rows<Row>(
      tx,
      sql`INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, family, species, sown_on, destroyed_on, exported, biomass, destruction_mode, notes)
          VALUES (${crypto.randomUUID()}, ${farmId}, ${parcelId}, ${w.campaign}, ${w.family}, ${w.species}, ${w.sownOn}::date, ${w.destroyedOn}::date,
                  ${w.exported}, ${w.biomass}, ${w.destructionMode}, ${w.notes})
          ON CONFLICT (land_parcel_id, campaign) DO UPDATE SET family = excluded.family, species = excluded.species, sown_on = excluded.sown_on,
            destroyed_on = excluded.destroyed_on, exported = excluded.exported, biomass = excluded.biomass,
            destruction_mode = excluded.destruction_mode, notes = excluded.notes, updated_at = now()
          RETURNING id, land_parcel_id, campaign, family, species, sown_on::text, destroyed_on::text, exported, biomass, destruction_mode, notes`,
    );
    return view(r!);
  });
}

export async function deleteCoverCrop(db: Database, farmId: string, parcelId: string, campaign: number): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(tx, sql`DELETE FROM cover_crops WHERE land_parcel_id = ${parcelId} AND campaign = ${campaign} RETURNING id`);
    if (!done.length) throw new NotFound("Couvert introuvable.");
    await tx.execute(sql`DELETE FROM regulatory_documents WHERE owner_type = 'cover_crop' AND owner_id = ${(done[0] as { id: string }).id}`);
  });
}
