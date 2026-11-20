import { sql } from "drizzle-orm";
import type { Tx } from "@fourmy/db";
import { PROCEDURES, type CertificationSettings } from "@fourmy/contracts";
import {
  departmentOf,
  fieldCropsReference,
  oldRegionOf,
  orchardReference,
  ORCHARD_OF_SPECIES,
  vineBasinOf,
  vineReference,
  type HveFamily,
  type IftReference,
} from "@fourmy/certification-refs";
import {
  splitUnit,
  unitScale,
  type HveFertilizationContext,
  type HveFertParcel,
  type HveIrrigation,
  type HveIrrigationContext,
  type HveParcel,
  type HvePhytoContext,
  type HveYear,
} from "@fourmy/domain";
import { nitrogenExportsOf } from "@fourmy/certification-refs";
import { abApplications } from "./certification-ab.js";

/**
 * Données HVE d'une période (lot CT3) : SAU par famille de cultures,
 * traitements, IFT enregistrés (API du ministère), références IFT du siège.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Segment IFT d'une ligne calculée avant le lot CT3 (libellé seul). */
const SEGMENT_OF_LABEL: Record<string, string> = {
  herbicides: "S3",
  insecticides_acaricides: "S4",
  fongicides_bactericides: "S5",
  autres: "S6",
  biocontrole: "S2",
  "traitement de semences": "S1",
};

/**
 * Famille HVE d'une production (Lexicon) : vigne ; prairie permanente (hors
 * IFT) ; arboriculture (fruits pérennes) ; légumes et fruits non arboricoles ;
 * horticulture ; sinon grandes cultures et prairies temporaires.
 */
export function hveFamilyOf(p: { nature: string | null; usage: string | null; lifeYears: number | null; specie: string | null; reference: string | null }): HveParcel["family"] {
  if (p.nature === "vine" || p.specie === "vitis" || p.specie?.startsWith("vitis")) return "vine";
  if (p.usage === "meadow" || /permanent_meadow|natural_meadow|permanent_grassland/.test(p.reference ?? "")) return "permanent_grassland";
  if (p.usage === "fruit") return (p.lifeYears ?? 0) >= 5 ? "orchard" : "vegetables";
  if (p.usage === "vegetable") return "vegetables";
  if (p.usage === "flower" || p.usage === "ornamental") return "horticulture";
  if (!p.nature && !p.usage && !p.specie) return null;
  return "field_crops";
}

async function parcelsOf(tx: Tx, from: string, to: string, campaign: number): Promise<HveParcel[]> {
  const list = await rows<{ id: string; name: string; area_m2: number; nature: string | null; usage: string | null; life_years: number | null; specie: string | null; reference: string | null; variety: string | null }>(
    tx,
    sql`SELECT DISTINCT ON (lp.id) lp.id, lp.name, v.area_m2::float8 AS area_m2,
               pr.nature, lx.usage, lx.life_years::float8 AS life_years,
               coalesce(a.cultivation, lx.specie, pr.cultivation) AS specie, a.reference, nullif(btrim(pr.species), '') AS variety
        FROM land_parcels lp
        JOIN land_parcel_versions v ON v.land_parcel_id = lp.id AND v.valid && tstzrange(${from}::date, (${to}::date + 1))
        LEFT JOIN LATERAL (
          SELECT p.* FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          WHERE p.land_parcel_id = lp.id AND c.year = ${campaign} ORDER BY p.created_at LIMIT 1) pr ON true
        LEFT JOIN activities a ON a.id = pr.activity_id
        LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        ORDER BY lp.id, upper(v.valid) DESC NULLS FIRST`,
  );
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    areaM2: r.area_m2,
    family: hveFamilyOf({ nature: r.nature, usage: r.usage, lifeYears: r.life_years, specie: r.specie, reference: r.reference }),
    species: r.specie,
    variety: r.variety,
    potato: !!r.specie?.startsWith("solanum_tuberosum"),
    orchard: r.specie ? (ORCHARD_OF_SPECIES[r.specie] ?? ORCHARD_OF_SPECIES[r.specie.split("_")[0]!] ?? "Autres") : null,
  }));
}

async function yearOf(tx: Tx, from: string, to: string, campaign: number): Promise<HveYear> {
  const parcels = await parcelsOf(tx, from, to, campaign);
  const treatments = await rows<{
    intervention_id: string;
    day: string;
    parcel_id: string;
    article_id: string;
    product: string;
    authorization: string | null;
    biocontrol: boolean | null;
    treated_m2: number | null;
    hazard: number | null;
  }>(
    tx,
    sql`SELECT i.id AS intervention_id, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, t.ref_id AS parcel_id,
               a.id AS article_id, a.name AS product, nullif(btrim(a.amm), '') AS authorization, pp.biocontrol,
               (t.attrs->>'workedAreaM2')::float8 AS treated_m2,
               (SELECT min(CASE WHEN r.code ~ '^H3(40|50|60)' THEN 1 WHEN r.code ~ '^H3(41|51|61)' THEN 2 END) FROM phyto_risks r WHERE r.product_id = pp.id) AS hazard
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article'
        JOIN articles a ON a.id = p.ref_id AND a.kind = 'phyto'
        LEFT JOIN LATERAL (SELECT id, biocontrol FROM phyto_products WHERE amm = btrim(a.amm) ORDER BY (state = 'authorized') DESC LIMIT 1) pp ON true
        WHERE i.status = 'done' AND i.started_at >= ${from}::date AND i.started_at < ${to}::date + 1`,
  );
  const ifts = await rows<{ id: string; ift: { status?: string; lines?: { parcelId: string; ift: number | null; segment: string | null; segmentCode?: string | null; signature?: string | null }[] } | null }>(
    tx,
    sql`SELECT DISTINCT i.id, i.ift FROM interventions i
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article'
        JOIN articles a ON a.id = p.ref_id AND a.kind = 'phyto'
        WHERE i.status = 'done' AND i.started_at >= ${from}::date AND i.started_at < ${to}::date + 1`,
  );
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  return {
    campaign,
    parcels,
    treatments: treatments.map((t) => ({
      interventionId: t.intervention_id,
      day: t.day,
      parcelId: t.parcel_id,
      articleId: t.article_id,
      product: t.product,
      authorization: t.authorization,
      biocontrol: t.biocontrol,
      treatedM2: t.treated_m2,
      hazardCmr: t.hazard === 1 || t.hazard === 2 ? t.hazard : null,
    })),
    ift: ifts.flatMap((i) =>
      i.ift?.status === "ok"
        ? (i.ift.lines ?? []).map((l) => ({
            interventionId: i.id,
            parcelId: l.parcelId,
            segmentCode: l.segmentCode ?? (l.segment ? (SEGMENT_OF_LABEL[norm(l.segment)] ?? null) : null),
            ift: l.ift,
            signed: !!l.signature,
          }))
        : [],
    ),
    iftPending: ifts.filter((i) => i.ift?.status !== "ok").map((i) => i.id),
  };
}

/** Période d'une campagne antérieure, décalée d'années entières. */
const shift = (day: string, years: number) => `${Number(day.slice(0, 4)) - years}${day.slice(4)}`;

export async function loadHvePhyto(tx: Tx, campaign: number, period: { from: string; to: string }, settings: CertificationSettings): Promise<HvePhytoContext> {
  const average = settings.hveMethod === "average";
  const years: HveYear[] = [];
  for (const back of average ? [0, 1, 2] : [0]) {
    const y = await yearOf(tx, shift(period.from, back), shift(period.to, back), campaign - back);
    if (back === 0 || y.parcels.some((p) => p.family)) years.push(y);
  }
  const [hq] = await rows<{ insee: string | null }>(tx, sql`SELECT insee_code AS insee FROM farm_sites WHERE is_headquarters LIMIT 1`);
  const insee = hq?.insee ?? null;
  const region = insee ? oldRegionOf(departmentOf(insee)) : null;
  const current = years[0]!;
  const areaOf = (f: HveFamily) => current.parcels.filter((p) => p.family === f).reduce((s, p) => s + p.areaM2, 0);
  const references: Partial<Record<HveFamily, IftReference | null>> = {};
  const referenceIssues: Partial<Record<HveFamily, string>> = {};
  const noSite = "commune du siège de l'exploitation (Ma ferme)";
  if (areaOf("field_crops")) {
    const potato = current.parcels.filter((p) => p.family === "field_crops" && p.potato).reduce((s, p) => s + p.areaM2, 0) / areaOf("field_crops");
    references.field_crops = region ? fieldCropsReference(region, potato, settings.hveIftScale) : null;
    if (!references.field_crops) referenceIssues.field_crops = region ? `références de la région ${region}` : noSite;
  }
  if (areaOf("vine")) {
    const basin = insee ? vineBasinOf(insee, settings.hveBeaujolais) : null;
    references.vine = basin ? vineReference(basin) : null;
    if (!references.vine) referenceIssues.vine = !insee ? noSite : !basin ? "bassin viticole (Rhône et Saône-et-Loire : périmètre de l'AOC Beaujolais, dans les réglages)" : `références du bassin ${basin}`;
  }
  if (areaOf("orchard")) {
    const orchards = current.parcels.filter((p) => p.family === "orchard").map((p) => ({ orchard: p.orchard ?? "Autres", areaM2: p.areaM2 }));
    references.orchard = region ? orchardReference(region, orchards) : null;
    if (!references.orchard) referenceIssues.orchard = region ? `références arboricoles de la région ${region}` : noSite;
  }
  const treatedSeeds = await rows<{ intervention_id: string; article_id: string; product: string }>(
    tx,
    sql`SELECT DISTINCT i.id AS intervention_id, a.id AS article_id, a.name AS product
        FROM interventions i
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article'
        JOIN articles a ON a.id = p.ref_id AND a.kind = 'seed' AND a.seed_treated
        WHERE i.status = 'done' AND i.started_at >= ${period.from}::date AND i.started_at < ${period.to}::date + 1`,
  );
  return {
    years,
    average,
    references,
    referenceIssues,
    treatedSeeds: treatedSeeds.map((s) => ({ interventionId: s.intervention_id, articleId: s.article_id, product: s.product })),
  };
}

// --- Fertilisation (lot CT3b) -----------------------------------------------------------

const uuidList = (ids: string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;

/** Données de l'indicateur fertilisation de la période (SAU de la campagne contrôlée). */
export async function loadHveFertilization(
  tx: Tx,
  campaign: number,
  period: { from: string; to: string },
  settings: CertificationSettings,
  parcels: HveParcel[],
): Promise<HveFertilizationContext> {
  const ids = parcels.map((p) => p.id);
  if (!ids.length) return { parcels: [], inputs: [], harvests: [], livestock: settings.hveLivestock, planParcelIds: [], rshParcelIds: [], steeringParcelIds: [] };
  // Production de référence et ancêtres de l'espèce (table des exportations, légumineuses).
  const lineage = await rows<{ id: string; reference: string | null; ancestors: string[] | null }>(
    tx,
    sql`SELECT lp.id, a.reference,
               (WITH RECURSIVE l AS (
                  SELECT reference_name, parent, 0 AS depth FROM taxonomy WHERE reference_name = coalesce(a.cultivation, lx.specie, pr.cultivation)
                  UNION ALL SELECT x.reference_name, x.parent, l.depth + 1 FROM taxonomy x JOIN l ON x.reference_name = l.parent WHERE l.depth < 30)
                SELECT array_agg(reference_name ORDER BY depth) FROM l WHERE depth > 0) AS ancestors
        FROM land_parcels lp
        LEFT JOIN LATERAL (SELECT p.* FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                           WHERE p.land_parcel_id = lp.id AND c.year = ${campaign} ORDER BY p.created_at LIMIT 1) pr ON true
        LEFT JOIN activities a ON a.id = pr.activity_id
        LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        WHERE lp.id = ANY(${uuidList(ids)})`,
  );
  const lin = new Map(lineage.map((l) => [l.id, l]));
  const fertParcels: HveFertParcel[] = parcels.map((p) => {
    const l = lin.get(p.id);
    const ancestors = l?.ancestors ?? [];
    const exports = nitrogenExportsOf(p.species, ancestors, l?.reference ?? null);
    // Légumineuses (6.6) : fabacées en grandes cultures ou fourrages, hors légumes récoltés en vert et prairies permanentes.
    const legume = (p.family === "field_crops") && [p.species, ...ancestors].includes("fabaceae");
    return { ...p, exports, legume };
  });
  const applications = (await abApplications(tx, ids, period.from, period.to)).filter((a) => a.kind === "fertilizer");
  const areaOf = new Map(parcels.map((p) => [p.id, p.areaM2]));
  const outputs = await rows<{ intervention_id: string; parcel_id: string; product: string; quantity: string | null; unit: string | null; total_m2: number | null }>(
    tx,
    sql`SELECT i.id AS intervention_id, t.ref_id AS parcel_id, a.name AS product, o.quantity::text, o.unit,
               (SELECT sum(coalesce((t2.attrs->>'workedAreaM2')::numeric, v.area_m2))::float8
                FROM intervention_parameters t2 JOIN land_parcel_versions v ON v.land_parcel_id = t2.ref_id AND v.valid @> i.started_at
                WHERE t2.intervention_id = i.id AND t2.role = 'target' AND t2.ref_type = 'land_parcel') AS total_m2
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel' AND t.ref_id = ANY(${uuidList(ids)})
        JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'output' AND o.ref_type = 'article'
        JOIN articles a ON a.id = o.ref_id
        WHERE i.status = 'done' AND i.started_at >= ${period.from}::date AND i.started_at < ${period.to}::date + 1`,
  );
  const harvests = outputs.map((o) => {
    const { unit, per } = splitUnit(o.unit);
    const scale = unitScale(unit);
    const q = o.quantity === null ? null : Number(o.quantity);
    const parcelHa = (areaOf.get(o.parcel_id) ?? 0) / 10_000;
    let tonnes: number | null = null;
    if (q !== null && scale?.dim === "mass") {
      const kg = q * scale.factor;
      // Dose par ha × surface de la parcelle ; quantité totale répartie au prorata des surfaces.
      tonnes = (per === "hectare" ? kg * parcelHa : o.total_m2 ? (kg * (areaOf.get(o.parcel_id) ?? 0)) / o.total_m2 : null) as number | null;
      if (tonnes !== null) tonnes = Math.round(tonnes) / 1000;
    }
    return { interventionId: o.intervention_id, parcelId: o.parcel_id, product: o.product, tonnes, straw: /paille/i.test(o.product) };
  });
  const plans = await rows<{ land_parcel_id: string }>(
    tx,
    sql`SELECT DISTINCT land_parcel_id FROM fertilization_plans WHERE campaign = ${campaign} AND current_version IS NOT NULL AND land_parcel_id = ANY(${uuidList(ids)})`,
  );
  const rsh = await rows<{ land_parcel_id: string }>(
    tx,
    sql`SELECT DISTINCT land_parcel_id FROM soil_analyses WHERE kind = 'rsh' AND sampled_on >= ${period.from}::date - 120 AND sampled_on <= ${period.to}::date AND land_parcel_id = ANY(${uuidList(ids)})`,
  );
  const steering = await rows<{ land_parcel_id: string }>(
    tx,
    sql`SELECT DISTINCT fp.land_parcel_id FROM steering_measurements m JOIN fertilization_plans fp ON fp.id = m.plan_id
        WHERE fp.campaign = ${campaign} AND fp.land_parcel_id = ANY(${uuidList(ids)})`,
  );
  return {
    parcels: fertParcels,
    inputs: applications.map((a) => ({ interventionId: a.interventionId, parcelId: a.parcelId, articleId: a.articleId, product: a.product, nTotalKgHa: a.nTotalKgHa ?? null, organic: !a.syntheticNitrogen })),
    harvests,
    livestock: settings.hveLivestock,
    planParcelIds: plans.map((p) => p.land_parcel_id),
    rshParcelIds: rsh.map((p) => p.land_parcel_id),
    steeringParcelIds: steering.map((p) => p.land_parcel_id),
  };
}

// --- Irrigation (lot CT3c) ---------------------------------------------------------------

/** Procédures de semis et de plantation (date de semis d'une parcelle irriguée). */
const SOWING = PROCEDURES.filter((p) => p.shape === "sowing").map((p) => p.code);

/** Apports d'irrigation de la période, parcelles irriguées et matériel d'irrigation au parc. */
export async function loadHveIrrigation(tx: Tx, campaign: number, period: { from: string; to: string }): Promise<HveIrrigationContext> {
  const list = await rows<{
    id: string;
    day: string;
    irrigation: { depthMm?: number; method?: string | null; origin?: HveIrrigation["origin"]; trigger?: string | null; mobile?: boolean | null };
    parcel_ids: string[];
    area_m2: number | null;
    equipment: boolean;
  }>(
    tx,
    sql`SELECT i.id, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, i.irrigation,
               array_agg(t.ref_id) AS parcel_ids,
               sum(coalesce((t.attrs->>'workedAreaM2')::numeric, v.area_m2))::float8 AS area_m2,
               EXISTS (SELECT 1 FROM intervention_parameters e WHERE e.intervention_id = i.id AND e.role = 'tool') AS equipment
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
        LEFT JOIN land_parcel_versions v ON v.land_parcel_id = t.ref_id AND v.valid @> i.started_at
        WHERE i.status = 'done' AND i.irrigation IS NOT NULL AND i.started_at >= ${period.from}::date AND i.started_at < ${period.to}::date + 1
        GROUP BY i.id, i.started_at, i.irrigation
        ORDER BY i.started_at`,
  );
  const irrigations: HveIrrigation[] = list.map((r) => ({
    interventionId: r.id,
    day: r.day,
    parcelIds: r.parcel_ids,
    depthMm: typeof r.irrigation.depthMm === "number" ? r.irrigation.depthMm : null,
    areaM2: r.area_m2 ?? 0,
    method: r.irrigation.method ?? null,
    origin: r.irrigation.origin ?? null,
    trigger: r.irrigation.trigger ?? null,
    mobile: r.irrigation.mobile ?? null,
    equipment: r.equipment,
  }));
  const ids = [...new Set(irrigations.flatMap((i) => i.parcelIds))];
  const parcels = ids.length
    ? await rows<{ id: string; name: string; production_id: string | null; crop: string | null; drought_tolerant: boolean | null; sown_on: string | null; water_saving: string | null; harvested: boolean }>(
        tx,
        sql`SELECT lp.id, lp.name, pr.id AS production_id, coalesce(a.name, pr.species, pr.nature) AS crop, pr.drought_tolerant, pr.water_saving,
                   coalesce(pr.planted_on, pr.started_on,
                     (SELECT min(i.started_at)::date FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = lp.id
                      WHERE i.status = 'done' AND i.procedure = ANY(${`{${SOWING.join(",")}}`}::text[])
                        AND i.started_at >= ${period.from}::date - 365 AND i.started_at < ${period.to}::date + 1))::text AS sown_on,
                   EXISTS (SELECT 1 FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = lp.id
                           JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'output'
                           WHERE i.status = 'done' AND i.started_at >= ${period.from}::date AND i.started_at < ${period.to}::date + 1) AS harvested
            FROM land_parcels lp
            LEFT JOIN LATERAL (SELECT p.* FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                               WHERE p.land_parcel_id = lp.id AND c.year = ${campaign} ORDER BY p.created_at LIMIT 1) pr ON true
            LEFT JOIN activities a ON a.id = pr.activity_id
            WHERE lp.id = ANY(${uuidList(ids)})
            ORDER BY lp.name`,
      )
    : [];
  const equipment = await rows<{ name: string }>(
    tx,
    sql`SELECT name FROM equipments WHERE name ~* '(enrouleur|pivot|rampe d.arrosage|irrigat|asperseur|goutte|arros)' ORDER BY name LIMIT 5`,
  );
  return {
    irrigations,
    parcels: parcels.map((p) => ({
      id: p.id,
      name: p.name,
      productionId: p.production_id,
      crop: p.crop,
      droughtTolerant: p.drought_tolerant,
      sownOn: p.sown_on,
      waterSaving: p.water_saving,
      harvested: p.harvested,
    })),
    irrigationEquipment: equipment.map((e) => e.name),
  };
}
