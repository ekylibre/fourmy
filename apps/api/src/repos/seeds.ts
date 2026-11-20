import { sql } from "drizzle-orm";
import { tgwReference, type TgwReferenceEntry } from "@fourmy/certification-refs";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type {
  LotSeed,
  MixtureComponent,
  SeedDetail,
  SeedInterventionUse,
  SeedListItem,
  SeedSheet,
  SeedSheetSave,
  SeedSpeciesOption,
  SeedTgwReference,
  TgwOrigin,
} from "@fourmy/contracts";
import { looksLikeMixture, parseSeedUnit, resolveTgw, seedEquivalents, seedFlags } from "@fourmy/domain";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { legumeOf } from "./taxonomy.js";

/**
 * Semences de la ferme (lot SE3, claudedocs/conception_semences.md §4) :
 * liste, fiche (article_seeds), PMG des lots, interventions qui les
 * utilisent. Les semences restent des articles (`kind = 'seed'`).
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type Row = {
  id: string;
  name: string;
  unit: string;
  lexicon_ref: string | null;
  organic_status: SeedListItem["organicStatus"];
  seed_treated: boolean | null;
  imported_species: string | null;
  imported_gnis: string | null;
  has_sheet: boolean;
  species: string | null;
  species_label: string | null;
  variety_name: string | null;
  gnis_code: string | null;
  category: SeedSheet["category"];
  is_mixture: boolean | null;
  grains_per_dose: number | null;
  bag_kg: string | null;
  tgw_g: string | null;
  tgw_origin: TgwOrigin | null;
  tgw_on: string | null;
  updated_at: string | null;
  component_count: number;
  stock: number;
};

const SELECT = (at: string) => sql`
  SELECT a.id, a.name, a.unit, a.lexicon_ref, a.organic_status, a.seed_treated,
         nullif(a.custom->>'species', '') AS imported_species, nullif(a.custom->>'gnis', '') AS imported_gnis,
         s.article_id IS NOT NULL AS has_sheet, s.species,
         coalesce((SELECT t.label FROM taxonomy t WHERE t.reference_name = s.species),
                  (SELECT initcap(lower(v.species_label)) FROM lexicon_seed_varieties v WHERE v.species = s.species LIMIT 1)) AS species_label,
         s.variety_name, s.gnis_code, s.category, s.is_mixture, s.grains_per_dose, s.bag_kg, s.tgw_g, s.tgw_origin,
         s.tgw_on::text AS tgw_on, s.updated_at::text AS updated_at,
         (SELECT count(*)::int FROM seed_mixture_components c WHERE c.article_id = a.id) AS component_count,
         coalesce((SELECT sum(m.quantity)::float8 FROM stock_movements m JOIN lots l ON l.id = m.lot_id
                   WHERE l.article_id = a.id AND m.occurred_at <= ${at}::timestamptz), 0) AS stock
  FROM articles a LEFT JOIN article_seeds s ON s.article_id = a.id
  WHERE a.kind = 'seed'`;

/** Campagne d'une intervention : celle de la culture en place sur sa première parcelle, sinon l'année de début. */
const CAMPAIGN_OF = sql`coalesce((
  SELECT c.year FROM intervention_parameters t
  JOIN productions p ON p.id = fourmy_production_at(t.ref_id, i.started_at::date)
  JOIN campaigns c ON c.id = p.campaign_id
  WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel' LIMIT 1),
  extract(year FROM i.started_at)::int)`;

function referenceView(r: TgwReferenceEntry | null): SeedTgwReference | null {
  if (!r) return null;
  return { label: r.label, typicalG: r.typicalG, minG: r.minG, maxG: r.maxG, typicalStated: r.typicalStated, org: r.source.org, url: r.source.url, note: r.note ?? null };
}

function sheetOf(r: Row): SeedSheet | null {
  if (!r.has_sheet) return null;
  return {
    articleId: r.id,
    species: r.species,
    varietyName: r.variety_name,
    gnisCode: r.gnis_code,
    category: r.category,
    isMixture: r.is_mixture ?? false,
    grainsPerDose: r.grains_per_dose,
    bagKg: num(r.bag_kg),
    tgwG: num(r.tgw_g),
    tgwOrigin: r.tgw_origin,
    tgwOn: r.tgw_on,
    updatedAt: r.updated_at!,
  };
}

function itemOf(r: Row, usage: SeedListItem["usage"]): SeedListItem {
  const sheet = sheetOf(r);
  const ref = sheet?.isMixture ? null : tgwReference(sheet?.species);
  const unit = parseSeedUnit(r.unit, sheet?.grainsPerDose ?? null);
  return {
    articleId: r.id,
    name: r.name,
    unit: r.unit,
    unitDim: unit?.dim ?? null,
    lexiconRef: r.lexicon_ref,
    organicStatus: r.organic_status,
    seedTreated: r.seed_treated,
    sheet,
    speciesLabel: r.species_label,
    importedSpecies: r.imported_species,
    importedGnis: r.imported_gnis,
    componentCount: r.component_count,
    reference: referenceView(ref),
    tgw: sheet?.isMixture ? null : resolveTgw({ article: sheet ? { tgwG: sheet.tgwG, origin: sheet.tgwOrigin } : null, reference: ref }),
    flags: seedFlags({ unit: r.unit, seed: sheet, componentCount: r.component_count, reference: ref }),
    looksLikeMixture: !sheet?.isMixture && looksLikeMixture(r.name, r.imported_species),
    stock: r.stock,
    usage,
  };
}

async function usageOf(tx: Tx, articleId?: string): Promise<Map<string, SeedListItem["usage"]>> {
  const list = await rows<{ article_id: string; campaign: number; n: number }>(
    tx,
    sql`SELECT ip.ref_id AS article_id, ${CAMPAIGN_OF} AS campaign, count(DISTINCT i.id)::int AS n
        FROM intervention_parameters ip
        JOIN interventions i ON i.id = ip.intervention_id
        JOIN articles a ON a.id = ip.ref_id AND a.kind = 'seed'
        WHERE ip.role = 'input' AND ip.ref_type = 'article' ${articleId ? sql`AND ip.ref_id = ${articleId}` : sql``}
        GROUP BY 1, 2 ORDER BY 2 DESC`,
  );
  const out = new Map<string, SeedListItem["usage"]>();
  for (const u of list) out.set(u.article_id, [...(out.get(u.article_id) ?? []), { campaign: u.campaign, interventions: u.n }]);
  return out;
}

export async function listSeeds(db: Database, farmId: string, at: string): Promise<SeedListItem[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<Row>(tx, sql`${SELECT(at)} ORDER BY a.name`);
    const usage = await usageOf(tx);
    return list.map((r) => itemOf(r, usage.get(r.id) ?? []));
  });
}

async function seedRow(tx: Tx, articleId: string, at: string): Promise<Row> {
  const [r] = await rows<Row>(tx, sql`${SELECT(at)} AND a.id = ${articleId}`);
  if (!r) throw new NotFound("Semence introuvable.");
  return r;
}

export async function getSeedIn(tx: Tx, articleId: string, at: string): Promise<SeedDetail> {
  const r = await seedRow(tx, articleId, at);
  const usage = await usageOf(tx, articleId);
  const item = itemOf(r, usage.get(articleId) ?? []);
  const components = await rows<{ id: string; species: string | null; label: string; variety_name: string | null; gnis_code: string | null; position: number }>(
    tx,
    sql`SELECT id, species, label, variety_name, gnis_code, position FROM seed_mixture_components WHERE article_id = ${articleId} ORDER BY position`,
  );
  const lots = await rows<{ id: string; code: string; seed: LotSeed | null; stock: number }>(
    tx,
    sql`SELECT l.id, l.code, l.attrs->'seed' AS seed,
               coalesce((SELECT sum(m.quantity)::float8 FROM stock_movements m WHERE m.lot_id = l.id AND m.occurred_at <= ${at}::timestamptz), 0) AS stock
        FROM lots l WHERE l.article_id = ${articleId} ORDER BY l.created_at, l.code`,
  );
  const uses = await rows<{
    intervention_id: string;
    started_at: string;
    status: string;
    campaign: number;
    quantity: string | null;
    unit: string | null;
    lot_id: string | null;
    parcels: string[] | null;
    worked_m2: number | null;
  }>(
    tx,
    sql`SELECT i.id AS intervention_id, i.started_at::text AS started_at, i.status, ${CAMPAIGN_OF} AS campaign,
               ip.quantity, ip.unit, ip.attrs->>'lotId' AS lot_id,
               (SELECT array_agg(lp.name ORDER BY lp.name) FROM intervention_parameters t JOIN land_parcels lp ON lp.id = t.ref_id
                WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') AS parcels,
               (SELECT sum((t.attrs->>'workedAreaM2')::float8) FROM intervention_parameters t
                WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') AS worked_m2
        FROM intervention_parameters ip JOIN interventions i ON i.id = ip.intervention_id
        WHERE ip.role = 'input' AND ip.ref_type = 'article' AND ip.ref_id = ${articleId}
        ORDER BY i.started_at DESC`,
  );
  const lotTgw = new Map(lots.map((l) => [l.id, l.seed]));
  const ref = item.sheet?.isMixture ? null : tgwReference(item.sheet?.species);
  const interventions: SeedInterventionUse[] = uses.map((u) => {
    const lot = u.lot_id ? lotTgw.get(u.lot_id) : null;
    const tgw = item.sheet?.isMixture
      ? null
      : resolveTgw({ lot: lot ? { tgwG: lot.tgwG, origin: lot.origin } : null, article: item.sheet ? { tgwG: item.sheet.tgwG, origin: item.sheet.tgwOrigin } : null, reference: ref });
    const areaHa = u.worked_m2 ? u.worked_m2 / 10_000 : null;
    const quantity = num(u.quantity);
    const eq =
      quantity !== null && u.unit ? seedEquivalents(quantity, u.unit, { tgwG: tgw?.tgwG ?? null, grainsPerDose: item.sheet?.grainsPerDose ?? null }, areaHa) : null;
    const grainsUsed = eq?.grainsPerM2 !== null && eq?.grainsPerM2 !== undefined;
    const kgUsed = eq?.kgPerHa !== null && eq?.kgPerHa !== undefined;
    // « Estimée » : une valeur obtenue en passant par un PMG repère.
    const crossed = parseSeedUnit(u.unit?.replace(/_per_(hectare|square_meter)$/, "") ?? "", item.sheet?.grainsPerDose)?.dim;
    const usedTgw = (crossed === "mass" && grainsUsed) || ((crossed === "grain" || crossed === "dose") && kgUsed);
    return {
      interventionId: u.intervention_id,
      startedAt: u.started_at,
      status: u.status,
      campaign: u.campaign,
      parcels: u.parcels ?? [],
      quantity,
      unit: u.unit,
      areaHa,
      grainsPerM2: eq?.grainsPerM2 ?? null,
      kgPerHa: eq?.kgPerHa ?? null,
      estimated: usedTgw && (tgw?.estimated ?? false),
    };
  });
  const comps: MixtureComponent[] = components.map((c) => ({ id: c.id, species: c.species, label: c.label, varietyName: c.variety_name, gnisCode: c.gnis_code, position: c.position }));
  return { ...item, components: comps, lots: lots.map((l) => ({ id: l.id, code: l.code, stock: l.stock, seed: l.seed })), interventions };
}

export async function getSeed(db: Database, farmId: string, articleId: string, at: string): Promise<SeedDetail> {
  return withFarm(db, farmId, (tx) => getSeedIn(tx, articleId, at));
}

/** Deux unités de semence équivalentes (même dimension, même facteur) : la changer ne change pas les stocks. */
function sameUnit(a: string, b: string, grainsPerDose: number | null): boolean {
  const x = parseSeedUnit(a, grainsPerDose);
  const y = parseSeedUnit(b, grainsPerDose);
  return !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
}

/**
 * Enregistre la fiche (FR-SE-5 à 7). L'unité de stock ne change que si la
 * semence n'a aucun mouvement, ou si la nouvelle unité est équivalente
 * (« Sac de 50 000 grains » → dose de 50 000 grains).
 */
export async function saveSeed(db: Database, farmId: string, userId: string, articleId: string, w: SeedSheetSave, at: string): Promise<SeedDetail> {
  return withFarm(db, farmId, async (tx) => {
    const r = await seedRow(tx, articleId, at);
    if (w.unit && w.unit !== r.unit) {
      if (!parseSeedUnit(w.unit, w.grainsPerDose)) throw new BadRequest(`Unité ${w.unit} non reconnue pour une semence.`);
      const [moved] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE l.article_id = ${articleId}`);
      if (moved!.n > 0 && !sameUnit(r.unit, w.unit, w.grainsPerDose)) {
        throw new BadRequest(`Cette semence a des mouvements de stock en ${r.unit} : son unité ne peut devenir ${w.unit} sans changer les stocks passés.`);
      }
      await tx.execute(sql`UPDATE articles SET unit = ${w.unit}, updated_at = now() WHERE id = ${articleId}`);
    }
    await tx.execute(sql`
      INSERT INTO article_seeds (article_id, farm_id, species, variety_name, gnis_code, category, is_mixture, grains_per_dose, bag_kg, tgw_g, tgw_origin, tgw_on, updated_by, updated_at)
      VALUES (${articleId}, ${farmId}, ${w.species}, ${w.varietyName}, ${w.gnisCode}, ${w.category}, ${w.isMixture}, ${w.grainsPerDose}, ${w.bagKg}, ${w.tgwG}, ${w.tgwOrigin}, ${w.tgwOn}, ${userId}, now())
      ON CONFLICT (article_id) DO UPDATE SET species = EXCLUDED.species, variety_name = EXCLUDED.variety_name, gnis_code = EXCLUDED.gnis_code,
        category = EXCLUDED.category, is_mixture = EXCLUDED.is_mixture, grains_per_dose = EXCLUDED.grains_per_dose, bag_kg = EXCLUDED.bag_kg,
        tgw_g = EXCLUDED.tgw_g, tgw_origin = EXCLUDED.tgw_origin, tgw_on = EXCLUDED.tgw_on, updated_by = EXCLUDED.updated_by, updated_at = now()`);
    // L'article suit (mobile, registre) : sa date de mise à jour bouge.
    await tx.execute(sql`UPDATE articles SET updated_at = now() WHERE id = ${articleId}`);
    return getSeedIn(tx, articleId, at);
  });
}

/** PMG d'un lot de semence (S5) ; null l'efface : le lot reprend celui de l'article. */
export async function saveLotSeed(db: Database, farmId: string, lotId: string, seed: LotSeed | null, at: string): Promise<SeedDetail> {
  return withFarm(db, farmId, async (tx) => {
    const [lot] = await rows<{ article_id: string }>(
      tx,
      sql`SELECT l.article_id FROM lots l JOIN articles a ON a.id = l.article_id AND a.kind = 'seed' WHERE l.id = ${lotId}`,
    );
    if (!lot) throw new NotFound("Lot de semence introuvable.");
    await tx.execute(
      seed
        ? sql`UPDATE lots SET attrs = jsonb_set(coalesce(attrs, '{}'::jsonb), '{seed}', ${JSON.stringify(seed)}::jsonb), updated_at = now() WHERE id = ${lotId}`
        : sql`UPDATE lots SET attrs = coalesce(attrs, '{}'::jsonb) - 'seed', updated_at = now() WHERE id = ${lotId}`,
    );
    return getSeedIn(tx, lot.article_id, at);
  });
}

/**
 * Espèces proposées sur la fiche : celles du catalogue des variétés et de la
 * taxonomie Lexicon, avec légumineuse et repère de PMG.
 */
export async function seedSpecies(db: Database, farmId: string): Promise<SeedSpeciesOption[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ species: string; label: string; legume: boolean }>(
      tx,
      sql`WITH s AS (
            SELECT DISTINCT ON (species) species, initcap(lower(species_label)) AS catalog_label FROM lexicon_seed_varieties ORDER BY species
          ), all_species AS (
            SELECT coalesce(s.species, t.reference_name) AS species, coalesce(t.label, s.catalog_label, coalesce(s.species, t.reference_name)) AS label
            FROM s FULL JOIN (SELECT reference_name, label FROM taxonomy WHERE rank = 'specie') t ON t.reference_name = s.species
          )
          SELECT species, label, ${legumeOf(sql`species`)} AS legume FROM all_species ORDER BY label`,
    );
    return list.map((s) => ({ ...s, hasReference: tgwReference(s.species) !== null }));
  });
}
