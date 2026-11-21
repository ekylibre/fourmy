import { sql } from "drizzle-orm";
import { tgwReference } from "@fourmy/certification-refs";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { CoverComponent, CoverCrop, CoverCropWrite, CoverSowingProposal, MixtureDose, SeedConversion, TgwOrigin } from "@fourmy/contracts";
import { coverFamilyOf, seedEquivalents, type CoverGroup } from "@fourmy/domain";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { coverGroupOf } from "./taxonomy.js";

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
  kind: CoverCrop["kind"];
  family: CoverCrop["family"];
  species: string;
  sown_on: string;
  destroyed_on: string | null;
  exported: boolean;
  biomass: CoverCrop["biomass"];
  destruction_mode: CoverCrop["destructionMode"];
  notes: string | null;
  sowing_intervention_id: string | null;
  components: CoverComponent[] | null;
};
const view = (r: Row): CoverCrop => ({
  id: r.id,
  parcelId: r.land_parcel_id,
  campaign: r.campaign,
  kind: r.kind,
  family: r.family,
  species: r.species,
  sownOn: r.sown_on,
  destroyedOn: r.destroyed_on,
  exported: r.exported,
  biomass: r.biomass,
  destructionMode: r.destruction_mode,
  notes: r.notes,
  sowingInterventionId: r.sowing_intervention_id,
  components: r.components,
});
const COLUMNS = sql`id, land_parcel_id, campaign, kind, family, species, sown_on::text, destroyed_on::text, exported, biomass, destruction_mode, notes, sowing_intervention_id, components`;
const SELECT = sql`SELECT ${COLUMNS} FROM cover_crops`;

export async function coversInTx(tx: Tx, parcelIds: string[], campaign: number): Promise<Map<string, CoverCrop>> {
  if (!parcelIds.length) return new Map();
  const list = await rows<Row>(tx, sql`${SELECT} WHERE campaign = ${campaign} AND land_parcel_id IN (SELECT unnest(${`{${parcelIds.join(",")}}`}::uuid[]))`);
  return new Map(list.map((r) => [r.land_parcel_id, view(r)]));
}

export async function saveCoverCrop(db: Database, farmId: string, parcelId: string, w: CoverCropWrite): Promise<CoverCrop> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!p) throw new NotFound("Parcelle introuvable.");
    if (w.sowingInterventionId) {
      const [i] = await rows(
        tx,
        sql`SELECT 1 FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
            WHERE i.id = ${w.sowingInterventionId} AND i.status = 'done'`,
      );
      if (!i) throw new BadRequest("Semis introuvable sur cette parcelle : il doit être réalisé.");
    }
    const [r] = await rows<Row>(
      tx,
      sql`INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, kind, family, species, sown_on, destroyed_on, exported, biomass, destruction_mode, notes,
                                   sowing_intervention_id, components)
          VALUES (${crypto.randomUUID()}, ${farmId}, ${parcelId}, ${w.campaign}, ${w.kind}, ${w.family}, ${w.species}, ${w.sownOn}::date, ${w.destroyedOn}::date,
                  ${w.exported}, ${w.biomass}, ${w.destructionMode}, ${w.notes}, ${w.sowingInterventionId}, ${w.components ? JSON.stringify(w.components) : null}::text::jsonb)
          ON CONFLICT (land_parcel_id, campaign) DO UPDATE SET kind = excluded.kind, family = excluded.family, species = excluded.species, sown_on = excluded.sown_on,
            destroyed_on = excluded.destroyed_on, exported = excluded.exported, biomass = excluded.biomass,
            destruction_mode = excluded.destruction_mode, notes = excluded.notes,
            sowing_intervention_id = excluded.sowing_intervention_id, components = excluded.components, updated_at = now()
          RETURNING ${COLUMNS}`,
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

// --- Couvert implanté par un semis (lot SE6, FR-SE-16) ------------------------------------

/** Libellé du couvert d'après ses espèces (« Avoine rude, Vesce commune… »), 200 caractères au plus. */
export const coverLabel = (components: CoverComponent[]) => {
  const label = components.map((c) => c.label).join(", ");
  return label.length > 200 ? `${label.slice(0, 199)}…` : label;
};

/**
 * Espèces semées par une intervention et leur dose en kg/ha : doses d'un
 * mélange, espèces d'un mélange sans doses, ou espèce d'une semence seule
 * (dose convertie avec le PMG figé, de la fiche ou du repère).
 */
export async function sowingComponents(tx: Tx, interventionId: string): Promise<CoverComponent[]> {
  const inputs = await rows<{
    article_id: string;
    name: string;
    quantity: string | null;
    unit: string | null;
    mixture: MixtureDose[] | null;
    conversion: SeedConversion | null;
    species: string | null;
    species_label: string | null;
    is_mixture: boolean | null;
    grains_per_dose: number | null;
    tgw_g: number | null;
    tgw_origin: TgwOrigin | null;
    worked_m2: number | null;
    components: { label: string; species: string | null }[] | null;
  }>(
    tx,
    sql`SELECT a.id AS article_id, a.name, ip.quantity, ip.unit, ip.attrs->'mixture' AS mixture, ip.attrs->'seedConversion' AS conversion,
               s.species, (SELECT t.label FROM taxonomy t WHERE t.reference_name = s.species) AS species_label, s.is_mixture, s.grains_per_dose,
               s.tgw_g::float8 AS tgw_g, s.tgw_origin,
               (SELECT sum(coalesce((t.attrs->>'workedAreaM2')::float8, (SELECT v.area_m2::float8 FROM land_parcel_versions v
                                                                          WHERE v.land_parcel_id = t.ref_id ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1)))
                FROM intervention_parameters t WHERE t.intervention_id = ip.intervention_id AND t.role = 'target' AND t.ref_type = 'land_parcel') AS worked_m2,
               (SELECT json_agg(json_build_object('label', c.label, 'species', c.species) ORDER BY c.position)
                FROM seed_mixture_components c WHERE c.article_id = a.id) AS components
        FROM intervention_parameters ip
        JOIN articles a ON a.id = ip.ref_id AND a.kind = 'seed'
        LEFT JOIN article_seeds s ON s.article_id = a.id
        WHERE ip.intervention_id = ${interventionId} AND ip.role = 'input' AND ip.ref_type = 'article'
        ORDER BY ip.id`,
  );
  const out: CoverComponent[] = [];
  for (const i of inputs) {
    if (i.mixture?.length) {
      out.push(...i.mixture.map((d) => ({ label: d.label, species: d.species, kgHa: d.kgHa })));
    } else if (i.is_mixture) {
      out.push(...(i.components ?? []).map((c) => ({ label: c.label, species: c.species, kgHa: null })));
    } else {
      const tgwG = i.conversion?.tgwG ?? i.tgw_g ?? tgwReference(i.species)?.typicalG ?? null;
      const eq =
        i.quantity !== null && i.unit
          ? seedEquivalents(Number(i.quantity), i.unit, { tgwG, grainsPerDose: i.conversion?.grainsPerDose ?? i.grains_per_dose }, i.worked_m2 ? i.worked_m2 / 10_000 : null)
          : null;
      const kgHa = eq?.kgPerHa ?? null;
      out.push({ label: i.species_label ?? i.name, species: i.species, kgHa: kgHa === null ? null : Math.round(kgHa * 100) / 100 });
    }
  }
  // Une espèce une fois : doses additionnées (deux semences de la même espèce).
  const merged = new Map<string, CoverComponent>();
  for (const c of out) {
    const key = (c.species ?? c.label).toLowerCase();
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, kgHa: prev.kgHa === null || c.kgHa === null ? null : Math.round((prev.kgHa + c.kgHa) * 100) / 100 } : c);
  }
  return [...merged.values()];
}

/** Famille du couvert et nombre de légumineuses, d'après les espèces (taxonomie). */
async function familyOf(tx: Tx, components: CoverComponent[]) {
  if (!components.length) return { family: null, legumes: 0 };
  const groups = await rows<{ grp: CoverGroup }>(
    tx,
    sql`SELECT ${coverGroupOf(sql`(x->>'species')`)} AS grp FROM jsonb_array_elements(${JSON.stringify(components)}::text::jsonb) x`,
  );
  return { family: coverFamilyOf(groups.map((g) => g.grp)), legumes: groups.filter((g) => g.grp === "legume").length };
}

/** Écart toléré entre la date du couvert saisi et celle du semis (jours). */
export const COVER_SOWING_DAYS = 15;

/**
 * À la réalisation (ou la correction) d'un semis : le couvert semé déjà saisi
 * sur chaque parcelle, à 15 jours près, est rattaché au semis ; il en reprend
 * les espèces, leur dose et la date (FR-SE-16). Rien n'est créé : sans couvert,
 * la page de la parcelle propose de reprendre le semis.
 */
export async function attachSowingToCovers(tx: Tx, interventionId: string, day: string): Promise<number> {
  const components = await sowingComponents(tx, interventionId);
  if (!components.length) return 0;
  const done = await rows(
    tx,
    sql`UPDATE cover_crops cc SET sowing_intervention_id = ${interventionId}, components = ${JSON.stringify(components)}::text::jsonb,
               species = ${coverLabel(components)}, sown_on = ${day}::date, updated_at = now()
        WHERE cc.kind = 'sown'
          AND cc.land_parcel_id IN (SELECT t.ref_id FROM intervention_parameters t WHERE t.intervention_id = ${interventionId} AND t.role = 'target' AND t.ref_type = 'land_parcel')
          AND (cc.sowing_intervention_id = ${interventionId}
               OR (cc.sowing_intervention_id IS NULL AND abs(cc.sown_on - ${day}::date) <= ${COVER_SOWING_DAYS}))
          AND (cc.destroyed_on IS NULL OR cc.destroyed_on >= ${day}::date)
        RETURNING cc.id`,
  );
  return done.length;
}

/**
 * Semis réalisés sur la parcelle pendant l'interculture qui précède la
 * campagne (de juin à décembre de l'année d'avant) : le couvert peut les
 * reprendre (« Reprendre le semis du 12/08 »), avec la famille déduite.
 */
export async function coverSowingProposals(db: Database, farmId: string, parcelId: string, campaign: number): Promise<CoverSowingProposal[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ id: string; started_at: string }>(
      tx,
      sql`SELECT i.id, i.started_at::date::text AS started_at FROM interventions i
          WHERE i.status = 'done' AND i.started_at >= make_date(${campaign - 1}, 6, 1) AND i.started_at < make_date(${campaign}, 1, 1)
            AND EXISTS (SELECT 1 FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId})
            AND EXISTS (SELECT 1 FROM intervention_parameters ip JOIN articles a ON a.id = ip.ref_id AND a.kind = 'seed'
                        WHERE ip.intervention_id = i.id AND ip.role = 'input')
            AND NOT EXISTS (SELECT 1 FROM cover_crops cc WHERE cc.land_parcel_id = ${parcelId} AND cc.campaign = ${campaign} AND cc.sowing_intervention_id = i.id)
          ORDER BY i.started_at DESC LIMIT 5`,
    );
    const out: CoverSowingProposal[] = [];
    for (const i of list) {
      const components = await sowingComponents(tx, i.id);
      if (!components.length) continue;
      out.push({ interventionId: i.id, startedAt: i.started_at, components, ...(await familyOf(tx, components)) });
    }
    return out;
  });
}
