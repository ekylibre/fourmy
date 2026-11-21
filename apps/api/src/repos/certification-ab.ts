import { sql } from "drizzle-orm";
import type { Tx } from "@fourmy/db";
import type { FertilizerArticle } from "@fourmy/contracts";
import { copperOfAmm, cycleFromLexicon, type CropCycle } from "@fourmy/certification-refs";
import {
  splitUnit,
  unitScale,
  type AbApplication,
  type AbEquipmentEvent,
  type AbParcelInput,
  type AbProduction,
  type AbRotationYear,
  type ParcelCertificationRef,
} from "@fourmy/domain";
import { nitrogen } from "./fertilization-record.js";
import { fertilizersInTx } from "./fertilizers.js";
import { coverHasLegume } from "./taxonomy.js";

/**
 * Données de l'Agriculture biologique pour les contrôles (lot CT2) : intrants
 * apportés sur les parcelles AB ramenés à l'hectare (cuivre métal, azote,
 * statut AB), productions et cycle de culture.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const uuids = (ids: string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Article tel que les contrôles AB le lisent. */
interface AbArticle {
  id: string;
  name: string;
  kind: string;
  unit: string;
  amm: string | null;
  /** Mention « utilisable en AB » d'E-Phy (null : produit inconnu). */
  organic: boolean | null;
  copperG: number | null;
  copperPer: "kg" | "L" | null;
  categories: string[] | null;
  effluentOrigin: AbApplication["effluentOrigin"];
  organicStatus: AbApplication["organicStatus"];
  seedTreated: boolean | null;
}

const ARTICLE_COLUMNS = sql`a.id, a.name, a.kind, a.unit, a.amm,
  (SELECT pp.organic FROM phyto_products pp WHERE pp.amm = btrim(a.amm) ORDER BY (pp.state = 'authorized') DESC LIMIT 1) AS organic,
  a.copper_metal_g::float8 AS copper_g, a.copper_metal_per AS copper_per, f.ab_categories, f.effluent_origin, a.organic_status, a.seed_treated`;

type ArticleRow = {
  id: string;
  name: string;
  kind: string;
  unit: string;
  amm: string | null;
  organic: boolean | null;
  copper_g: number | null;
  copper_per: "kg" | "L" | null;
  ab_categories: string[] | null;
  effluent_origin: AbArticle["effluentOrigin"];
  organic_status: AbArticle["organicStatus"];
  seed_treated: boolean | null;
};
const articleOf = (r: ArticleRow): AbArticle => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  unit: r.unit,
  amm: r.amm,
  organic: r.organic,
  copperG: r.copper_g,
  copperPer: r.copper_per,
  categories: r.ab_categories,
  effluentOrigin: r.effluent_origin,
  organicStatus: r.organic_status,
  seedTreated: r.seed_treated,
});

/** Procédures de plantation de plants repiqués (plantules : pas de dérogation possible). */
const PLANT_PROCEDURES = new Set(["implanting"]);

type Derogation = { article_id: string | null; species: string; season: number; granted_on: string; reference: string | null };
/** Dérogation de la saison pour une semence : par article, sinon par espèce (nom de l'article). */
function derogationFor(derogations: Derogation[], article: AbArticle, day: string): AbApplication["derogation"] {
  const season = Number(day.slice(0, 4));
  const name = article.name.trim().toLowerCase();
  const hits = derogations
    .filter((d) => d.season === season && (d.article_id === article.id || (!d.article_id && name.includes(d.species.trim().toLowerCase()))))
    .sort((a, b) => a.granted_on.localeCompare(b.granted_on));
  // La plus ancienne : une dérogation antérieure au semis l'emporte sur une plus tardive.
  const d = hits[0];
  return d ? { grantedOn: d.granted_on, reference: d.reference } : null;
}

async function derogationsOf(tx: Tx): Promise<Derogation[]> {
  return rows<Derogation>(tx, sql`SELECT article_id, species, season, granted_on::text, reference FROM seed_derogations`);
}

/**
 * Un intrant sur une parcelle, ramené à l'hectare. `quantity` et `unit` sont
 * ceux de l'intervention (unité suffixée `_per_hectare` pour une dose) ; une
 * quantité totale se répartit sur la surface de toutes les parcelles
 * (comme le contrôle phyto).
 */
export function applicationOf(
  input: {
    interventionId: string;
    day: string;
    parcelId: string;
    quantity: number | null;
    unit: string | null;
    totalAreaHa: number | null;
    procedure?: string;
    justification?: string | null;
    derogations?: Derogation[];
  },
  article: AbArticle,
  fertilizers: Map<string, FertilizerArticle>,
): AbApplication | null {
  const base = { interventionId: input.interventionId, day: input.day, parcelId: input.parcelId, articleId: article.id, product: article.name };
  if (article.kind === "seed") {
    return {
      ...base,
      kind: "seed",
      organicStatus: article.organicStatus,
      seedTreated: article.seedTreated,
      plant: PLANT_PROCEDURES.has(input.procedure ?? ""),
      derogation: derogationFor(input.derogations ?? [], article, input.day),
    };
  }
  const { unit, per } = splitUnit(input.unit ?? article.unit);
  const scale = unitScale(unit);
  const perHa =
    input.quantity === null || !scale ? null : per === "hectare" ? input.quantity * scale.factor : input.totalAreaHa ? (input.quantity * scale.factor) / input.totalAreaHa : null;
  if (article.kind === "phyto") {
    const content = article.copperG && article.copperPer ? { g: article.copperG, per: article.copperPer } : copperOfAmm(article.amm?.trim());
    let copperKgHa: number | null | undefined = undefined;
    if (content === null) copperKgHa = null;
    else if (content) {
      const sameDim = scale && (content.per === "kg" ? scale.dim === "mass" : scale.dim === "volume");
      copperKgHa = perHa !== null && sameDim ? Math.round(((perHa * content.g) / 1000) * 100) / 100 : null;
    }
    return {
      ...base,
      kind: "phyto",
      organicAllowed: article.amm ? article.organic : null,
      justified: !!input.justification?.trim(),
      ...(copperKgHa !== undefined ? { copperKgHa } : {}),
    };
  }
  if (article.kind === "fertilizer") {
    const f = fertilizers.get(article.id);
    const n = input.quantity === null ? null : nitrogen(f, input.day, input.quantity, input.unit ?? article.unit, input.totalAreaHa);
    const composition = n && !("missing" in n) ? n.composition : (f?.composition ?? null);
    const syntheticNitrogen = composition?.nitrateType === "III" && (composition.nTotal ?? 0) > 0;
    return {
      ...base,
      kind: "fertilizer",
      categories: article.categories,
      effluentOrigin: article.effluentOrigin,
      syntheticNitrogen,
      nTotalKgHa: n && !("missing" in n) ? n.totalKgHa : null,
    };
  }
  return null;
}

/** Intrants réalisés sur des parcelles entre deux dates (sauf une intervention). */
export async function abApplications(tx: Tx, parcelIds: string[], from: string, to: string, exclude: string | null = null): Promise<AbApplication[]> {
  if (!parcelIds.length) return [];
  const list = await rows<ArticleRow & { intervention_id: string; day: string; parcel_id: string; quantity: string | null; input_unit: string | null; total_m2: number | null; procedure: string; justification: string | null }>(
    tx,
    sql`SELECT i.id AS intervention_id, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, t.ref_id AS parcel_id, i.procedure, i.justification,
               p.quantity::text AS quantity, p.unit AS input_unit,
               (SELECT sum(coalesce((t2.attrs->>'workedAreaM2')::numeric, v.area_m2))::float8
                FROM intervention_parameters t2
                JOIN land_parcel_versions v ON v.land_parcel_id = t2.ref_id AND v.valid @> i.started_at
                WHERE t2.intervention_id = i.id AND t2.role = 'target' AND t2.ref_type = 'land_parcel') AS total_m2,
               ${ARTICLE_COLUMNS}
        FROM interventions i
        JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel' AND t.ref_id = ANY(${uuids(parcelIds)})
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article'
        JOIN articles a ON a.id = p.ref_id AND a.kind IN ('phyto', 'fertilizer', 'seed')
        LEFT JOIN article_fertilizers f ON f.article_id = a.id
        WHERE i.status = 'done' AND i.started_at >= ${from}::date AND i.started_at < ${to}::date + 1
          ${exclude ? sql`AND i.id <> ${exclude}` : sql``}
        ORDER BY i.started_at`,
  );
  const fertilizers = new Map((await fertilizersInTx(tx)).map((f) => [f.id, f]));
  const derogations = await derogationsOf(tx);
  return list.flatMap((r) => {
    const a = applicationOf(
      {
        interventionId: r.intervention_id,
        day: r.day,
        parcelId: r.parcel_id,
        quantity: num(r.quantity),
        unit: r.input_unit,
        totalAreaHa: r.total_m2 ? r.total_m2 / 10_000 : null,
        procedure: r.procedure,
        justification: r.justification,
        derogations,
      },
      articleOf(r),
      fertilizers,
    );
    return a ? [a] : [];
  });
}

/** Intrants d'un brouillon d'intervention sur ses parcelles AB. */
export async function abDraftApplications(
  tx: Tx,
  draft: {
    day: string;
    interventionId: string;
    procedure: string;
    justification: string | null;
    parcels: { id: string; areaM2: number }[];
    abParcelIds: string[];
    inputs: { articleId: string; quantity: number; per: "hectare" | "total"; unit?: string }[];
  },
): Promise<AbApplication[]> {
  const ids = [...new Set(draft.inputs.map((i) => i.articleId))];
  if (!ids.length || !draft.abParcelIds.length) return [];
  const articles = new Map(
    (await rows<ArticleRow>(tx, sql`SELECT ${ARTICLE_COLUMNS} FROM articles a LEFT JOIN article_fertilizers f ON f.article_id = a.id WHERE a.id = ANY(${uuids(ids)})`)).map((r) => [r.id, articleOf(r)]),
  );
  const fertilizers = new Map((await fertilizersInTx(tx)).map((f) => [f.id, f]));
  const derogations = await derogationsOf(tx);
  const totalAreaHa = draft.parcels.reduce((sum, p) => sum + p.areaM2, 0) / 10_000 || null;
  return draft.abParcelIds.flatMap((parcelId) =>
    draft.inputs.flatMap((i) => {
      const article = articles.get(i.articleId);
      if (!article) return [];
      const unit = i.unit ?? article.unit;
      const a = applicationOf(
        {
          interventionId: draft.interventionId,
          day: draft.day,
          parcelId,
          quantity: i.quantity,
          unit: i.per === "hectare" ? `${unit}_per_hectare` : unit,
          totalAreaHa,
          procedure: draft.procedure,
          justification: draft.justification,
          derogations,
        },
        article,
        fertilizers,
      );
      return a ? [a] : [];
    }),
  );
}

/** Parcelles AB d'une période : début de la certification (de conversion) et niveau saisi. */
export function abParcelInputs(parcels: { id: string; name: string; areaM2: number }[], certifications: ParcelCertificationRef[]): AbParcelInput[] {
  return parcels.flatMap((p) => {
    const certs = certifications.filter((c) => c.kind === "ab" && c.parcelId === p.id).sort((a, b) => a.startedOn.localeCompare(b.startedOn));
    const last = certs.at(-1);
    return last ? [{ ...p, startedOn: last.startedOn, declaredLevel: last.level }] : [];
  });
}

/** Productions des parcelles récoltées pendant une période, avec leur cycle (saisi, sinon Lexicon). */
export async function abProductions(tx: Tx, parcelIds: string[], from: string, to: string): Promise<AbProduction[]> {
  if (!parcelIds.length) return [];
  const list = await rows<{
    id: string;
    land_parcel_id: string;
    label: string;
    cycle: CropCycle | null;
    life_years: number | null;
    usage: string | null;
    sown_on: string | null;
    harvest_on: string | null;
    specie: string | null;
    variety: string | null;
    cultivation_mode: string | null;
  }>(
    tx,
    sql`SELECT p.id, p.land_parcel_id, coalesce(a.name, lp.label, p.species, p.nature, 'Production') AS label, p.cycle,
               coalesce(a.cultivation, lp.specie, p.cultivation) AS specie, nullif(btrim(p.species), '') AS variety, p.cultivation_mode,
               lp.life_years::float8 AS life_years, lp.usage,
               coalesce(p.planted_on, p.started_on, make_date(c.year, 1, 1))::text AS sown_on,
               coalesce(p.stopped_on, make_date(c.year, 12, 31))::text AS harvest_on
        FROM productions p
        JOIN campaigns c ON c.id = p.campaign_id
        LEFT JOIN activities a ON a.id = p.activity_id
        LEFT JOIN lexicon_productions lp ON lp.reference_name = a.reference
        WHERE p.land_parcel_id = ANY(${uuids(parcelIds)}) AND coalesce(p.planted_on, p.started_on, make_date(c.year, 1, 1)) <= ${to}::date
          AND coalesce(p.stopped_on, make_date(c.year, 12, 31)) >= ${from}::date`,
  );
  return list.map((r) => ({
    id: r.id,
    parcelId: r.land_parcel_id,
    label: r.label,
    cycle: r.cycle ?? cycleFromLexicon(r.life_years, r.usage),
    sownOn: r.sown_on,
    harvestOn: r.harvest_on,
    species: r.specie,
    variety: r.variety,
    cultivationMode: r.cultivation_mode,
  }));
}

/** Productions des parcelles non AB de la campagne (mixité, R7). */
export async function nonAbProductions(tx: Tx, abParcelIds: string[], campaign: number): Promise<{ species: string; label: string; variety: string | null }[]> {
  const list = await rows<{ specie: string | null; label: string; variety: string | null }>(
    tx,
    sql`SELECT coalesce(a.cultivation, lp.specie, p.cultivation) AS specie, coalesce(a.name, lp.label, p.nature, 'Production') AS label, nullif(btrim(p.species), '') AS variety
        FROM productions p
        JOIN campaigns c ON c.id = p.campaign_id AND c.year = ${campaign}
        LEFT JOIN activities a ON a.id = p.activity_id
        LEFT JOIN lexicon_productions lp ON lp.reference_name = a.reference
        WHERE ${abParcelIds.length ? sql`p.land_parcel_id <> ALL(${uuids(abParcelIds)})` : sql`true`}`,
  );
  return list.flatMap((r) => (r.specie ? [{ species: r.specie, label: r.label, variety: r.variety }] : []));
}

// --- Lot CT5b : matériel à usage mixte, rotation ------------------------------------------

/** Certifications AB de toutes les parcelles (toutes dates), pour dire si un usage était en AB. */
async function organicSpans(tx: Tx): Promise<Map<string, { from: string; to: string | null }[]>> {
  const list = await rows<{ land_parcel_id: string; started_on: string; stopped_on: string | null }>(
    tx,
    sql`SELECT land_parcel_id, started_on::text, stopped_on::text FROM parcel_certifications WHERE kind = 'organic'`,
  );
  const out = new Map<string, { from: string; to: string | null }[]>();
  for (const c of list) out.set(c.land_parcel_id, [...(out.get(c.land_parcel_id) ?? []), { from: c.started_on, to: c.stopped_on }]);
  return out;
}
const isOrganic = (spans: Map<string, { from: string; to: string | null }[]>, parcelId: string, day: string) =>
  (spans.get(parcelId) ?? []).some((s) => s.from <= day && (s.to === null || s.to >= day));

/** Usages et nettoyages des matériels jusqu'à une date (R27). */
export async function equipmentEvents(tx: Tx, from: string, to: string): Promise<AbEquipmentEvent[]> {
  const list = await rows<{ equipment_id: string; equipment: string; intervention_id: string; at: string; procedure: string; parcel_ids: string[] | null }>(
    tx,
    sql`SELECT e.id AS equipment_id, e.name AS equipment, i.id AS intervention_id, i.started_at::text AS at, i.procedure,
               (SELECT array_agg(t.ref_id) FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') AS parcel_ids
        FROM interventions i
        JOIN intervention_parameters p ON p.intervention_id = i.id AND p.ref_type = 'equipment' AND (p.role = 'tool' OR (i.procedure = 'equipment_cleaning' AND p.role = 'target'))
        JOIN equipments e ON e.id = p.ref_id
        WHERE i.status = 'done' AND i.started_at >= ${from}::date AND i.started_at < ${to}::date + 1
        ORDER BY i.started_at`,
  );
  const spans = await organicSpans(tx);
  return list.flatMap((r): AbEquipmentEvent[] => {
    const day = new Date(r.at).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    const parcels = r.parcel_ids ?? [];
    if (r.procedure === "equipment_cleaning") return [{ equipmentId: r.equipment_id, equipment: r.equipment, interventionId: r.intervention_id, at: new Date(r.at).toISOString(), kind: "cleaning" as const, organic: true, parcelIds: [] }];
    if (!parcels.length) return [];
    return [
      {
        equipmentId: r.equipment_id,
        equipment: r.equipment,
        interventionId: r.intervention_id,
        at: new Date(r.at).toISOString(),
        kind: "use" as const,
        organic: parcels.every((p) => isOrganic(spans, p, day)),
        parcelIds: parcels,
      },
    ];
  });
}

/** Saisie : matériels dont le dernier usage avant l'intervention était hors AB, sans nettoyage depuis. */
export async function uncleanedEquipment(tx: Tx, equipmentIds: string[], before: string, exclude: string | null): Promise<{ equipment: string; lastUseOn: string }[]> {
  if (!equipmentIds.length) return [];
  const events = (await equipmentEvents(tx, `${Number(before.slice(0, 4)) - 2}-01-01`, before.slice(0, 10)))
    .filter((e) => equipmentIds.includes(e.equipmentId) && e.interventionId !== exclude && e.at < before);
  return equipmentIds.flatMap((id) => {
    const last = events.filter((e) => e.equipmentId === id).at(-1);
    return last && last.kind === "use" && !last.organic ? [{ equipment: last.equipment, lastUseOn: last.at.slice(0, 10) }] : [];
  });
}

/** Historique des cultures des parcelles AB sur N campagnes (R11). */
export async function rotationHistory(tx: Tx, parcels: { id: string; name: string }[], campaign: number, years: number): Promise<Map<string, { name: string; years: AbRotationYear[] }>> {
  const out = new Map(parcels.map((p) => [p.id, { name: p.name, years: [] as AbRotationYear[] }]));
  if (!parcels.length) return out;
  const list = await rows<{
    land_parcel_id: string;
    year: number;
    specie: string | null;
    label: string | null;
    usage: string | null;
    life_years: number | null;
    cycle: CropCycle | null;
    legume: boolean;
    cover_legume: boolean;
  }>(
    tx,
    sql`SELECT DISTINCT ON (p.land_parcel_id, c.year) p.land_parcel_id, c.year,
               coalesce(a.cultivation, lp.specie, p.cultivation) AS specie, coalesce(a.name, lp.label, p.nature) AS label,
               lp.usage, lp.life_years::float8 AS life_years, p.cycle,
               EXISTS (WITH RECURSIVE l AS (
                         SELECT reference_name, parent, 0 AS depth FROM taxonomy WHERE reference_name = coalesce(a.cultivation, lp.specie, p.cultivation)
                         UNION ALL SELECT x.reference_name, x.parent, l.depth + 1 FROM taxonomy x JOIN l ON x.reference_name = l.parent WHERE l.depth < 30)
                       SELECT 1 FROM l WHERE reference_name = 'fabaceae') AS legume,
               EXISTS (SELECT 1 FROM cover_crops cc WHERE cc.land_parcel_id = p.land_parcel_id AND cc.campaign = c.year AND ${coverHasLegume("cc")}) AS cover_legume
        FROM productions p
        JOIN campaigns c ON c.id = p.campaign_id
        LEFT JOIN activities a ON a.id = p.activity_id
        LEFT JOIN lexicon_productions lp ON lp.reference_name = a.reference
        WHERE p.land_parcel_id = ANY(${uuids(parcels.map((p) => p.id))}) AND c.year > ${campaign - years} AND c.year <= ${campaign}
        ORDER BY p.land_parcel_id, c.year, p.created_at`,
  );
  for (const r of list) {
    const cycle = r.cycle ?? cycleFromLexicon(r.life_years, r.usage);
    out.get(r.land_parcel_id)!.years.push({
      campaign: r.year,
      species: r.specie,
      label: r.label,
      legume: r.legume,
      coverLegume: r.cover_legume,
      vegetable: r.usage === "vegetable",
      perennial: cycle !== "annual",
    });
  }
  return out;
}
