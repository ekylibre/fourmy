import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { priceKey, type ArticleSuggestions, type EcoContext, type Price, type PriceKind, type PriceSuggestion, type ProductSuggestions, type priceWrite } from "@fourmy/contracts";
import type { z } from "zod";
import { marketCodesFor } from "@fourmy/certification-refs";
import { defaultPrice, defaultYield } from "@fourmy/domain";
import { harvestYields } from "./fertilization-plans.js";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Prix de la ferme, datés et sourcés (temps 3, lot E1,
 * claudedocs/conception_assolement_eco.md §2.1 et §4). Une modification
 * ajoute une ligne ; on ne réécrit jamais un prix.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

type Row = {
  id: string;
  kind: PriceKind;
  article_id: string | null;
  equipment_id: string | null;
  activity_id: string | null;
  product: string | null;
  procedure: string | null;
  unit: string;
  amount: string;
  valid_from: string;
  source: Price["source"];
  source_ref: string | null;
  source_date: string | null;
  note: string | null;
  created_at: string;
};

const read = (r: Row): Price => ({
  id: r.id,
  kind: r.kind,
  articleId: r.article_id,
  equipmentId: r.equipment_id,
  activityId: r.activity_id,
  product: r.product,
  procedure: r.procedure,
  unit: r.unit,
  amount: Number(r.amount),
  validFrom: r.valid_from,
  source: r.source,
  sourceRef: r.source_ref,
  sourceDate: r.source_date,
  note: r.note,
  createdAt: new Date(r.created_at).toISOString(),
});

const COLS = sql`id, kind, article_id, equipment_id, activity_id, product, procedure, unit, amount::text, valid_from::text, source, source_ref, source_date::text, note, created_at::text`;

/**
 * Prix de la ferme : en vigueur à `at` (une ligne par clé), ou tout
 * l'historique. Le calcul du prix en vigueur se fait aussi dans le domaine
 * (`priceAt`) ; ici, pour alléger la réponse.
 */
export async function listPrices(db: Database, farmId: string, q: { kind?: PriceKind; at: string; history: boolean }): Promise<Price[]> {
  return withFarm(db, farmId, async (tx) => {
    const kind = q.kind ? sql`AND kind = ${q.kind}` : sql``;
    if (q.history) return (await rows<Row>(tx, sql`SELECT ${COLS} FROM prices WHERE true ${kind} ORDER BY valid_from DESC, created_at DESC`)).map(read);
    return (
      await rows<Row>(
        tx,
        sql`SELECT DISTINCT ON (kind, article_id, equipment_id, activity_id, product, procedure) ${COLS}
            FROM prices WHERE valid_from <= ${q.at}::date ${kind}
            ORDER BY kind, article_id, equipment_id, activity_id, product, procedure, valid_from DESC, created_at DESC`,
      )
    ).map(read);
  });
}

/** Ajout en masse : une ligne datée par prix. Les objets cités doivent être de la ferme (RLS). */
export async function addPrices(db: Database, farmId: string, items: z.output<typeof priceWrite>[], userId: string, newId: () => string): Promise<Price[]> {
  return withFarm(db, farmId, async (tx) => {
    const check = async (table: "articles" | "equipments" | "activities", ids: (string | null)[], what: string) => {
      const wanted = [...new Set(ids.filter((x): x is string => !!x))];
      if (!wanted.length) return;
      const [n] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ANY(${`{${wanted.join(",")}}`}::uuid[])`);
      if (n!.n !== wanted.length) throw new BadRequest(`${what} inconnu dans cette ferme.`);
    };
    await check("articles", items.map((i) => i.articleId), "Article");
    await check("equipments", items.map((i) => i.equipmentId), "Matériel");
    await check("activities", items.map((i) => i.activityId), "Activité");
    const out: Price[] = [];
    for (const i of items) {
      const [r] = await rows<Row>(
        tx,
        sql`INSERT INTO prices (id, farm_id, kind, article_id, equipment_id, activity_id, product, procedure, unit, amount, valid_from, source, source_ref, source_date, note, created_by)
            VALUES (${i.id ?? newId()}, ${farmId}, ${i.kind}, ${i.articleId}, ${i.equipmentId}, ${i.activityId}, ${i.product}, ${i.procedure}, ${i.unit}, ${i.amount},
                    ${i.validFrom}::date, ${i.source}, ${i.sourceRef}, ${i.sourceDate}::date, ${i.note}, ${userId})
            ON CONFLICT (id) DO NOTHING RETURNING ${COLS}`,
      );
      if (r) out.push(read(r));
    }
    return out;
  });
}

export async function deletePrice(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(tx, sql`DELETE FROM prices WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Prix introuvable.");
  });
}



/** Département d'un code INSEE (« 64488 » → « 64 », « 97411 » → « 974 »). */
export const departmentOf = (insee: string | null | undefined): string | null => (insee ? (insee.startsWith("97") ? insee.slice(0, 3) : insee.slice(0, 2)) : null);

/**
 * Repères Lexicon des activités végétales de la ferme (lot E2) : prix de
 * vente proposés (prix producteur du département, de France, MATIF,
 * marchés européens) pour les productions à grain, et rendements Agreste du
 * département sur les dernières campagnes.
 */
export async function productSuggestions(db: Database, farmId: string, today: string = new Date().toISOString().slice(0, 10)): Promise<ProductSuggestions> {
  // Repères trop anciens écartés : plus de 3 ans ; une place de marché en retard de plus de 6 mois sur la plus récente.
  const oldest = `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`;
  return withFarm(db, farmId, async (tx) => {
    const [hq] = await rows<{ insee_code: string | null }>(tx, sql`SELECT insee_code FROM farm_sites WHERE is_headquarters LIMIT 1`);
    const department = departmentOf(hq?.insee_code);
    const acts = await rows<{ id: string; reference: string | null; specie: string | null; usage: string | null }>(
      tx,
      sql`SELECT a.id, a.reference, coalesce(lp.specie, a.cultivation) AS specie, lp.usage
          FROM activities a LEFT JOIN lexicon_productions lp ON lp.reference_name = a.reference
          WHERE a.family IN ('plant_farming', 'plant_nursery') AND NOT a.suspended`,
    );
    const species = [...new Set(acts.filter((a) => a.usage === "grain" && a.specie).map((a) => a.specie!))];
    const productions = [...new Set(acts.map((a) => a.reference).filter((x): x is string => !!x))];
    const arr = (xs: string[]) => `{${xs.join(",")}}`;
    // Dernier prix producteur (département, France) et dernier MATIF, par espèce.
    const prodPrices = species.length
      ? await rows<{ id: string; zone: string; nature: string | null; specie: string; price: string; unit: string; started_on: string; label: string | null }>(
          tx,
          sql`SELECT DISTINCT ON (specie, zone, nature) id::text, zone, nature, specie, price::text, unit, started_on::text, label
              FROM lexicon_production_prices
              WHERE specie = ANY(${arr(species)}::text[]) AND output = 'grain' AND organic IS NOT TRUE
                AND nature IN ('farmer_price', 'matif_price') AND (zone = '0' OR zone = ${department ?? "-"}) AND started_on >= ${oldest}::date
              ORDER BY specie, zone, nature, started_on DESC`,
        )
      : [];
    // Marchés européens (France), dernier prix par place : cache de l'API agrifood d'abord, copie Lexicon ensuite.
    type Market = { id: string; specie: string; code: string; label: string; price: string; unit: string; started_on: string; source: "agrifood" | "lexicon" };
    const market = species.length
      ? await rows<Market>(
          tx,
          sql`SELECT * FROM (
                SELECT DISTINCT ON (specie, product_label) id, specie, product_code AS code, product_label AS label, price::text, unit, started_on::text, 'agrifood' AS source
                FROM market_prices WHERE specie = ANY(${arr(species)}::text[]) AND started_on >= ${oldest}::date
                ORDER BY specie, product_label, started_on DESC) a
              UNION ALL
              SELECT * FROM (
                SELECT DISTINCT ON (specie, label) id, specie, product_code AS code, label, price::text, unit, started_on::text, 'lexicon' AS source
                FROM lexicon_market_prices WHERE specie = ANY(${arr(species)}::text[]) AND started_on >= ${oldest}::date
                ORDER BY specie, label, started_on DESC) l
              ORDER BY started_on DESC`,
        )
      : [];
    const yields =
      department && productions.length
        ? await rows<{ production: string; campaign: number; yield_value: string; yield_unit: string }>(
            tx,
            sql`SELECT production, campaign, yield_value::text, yield_unit FROM lexicon_production_yields
                WHERE department = ${department} AND production = ANY(${arr(productions)}::text[]) ORDER BY production, campaign DESC`,
          )
        : [];
    const items = acts.map((a) => {
      const suggestions: PriceSuggestion[] = [];
      if (a.usage === "grain" && a.specie) {
        const pp = prodPrices.filter((p) => p.specie === a.specie);
        const push = (p: (typeof pp)[number] | undefined, scope: PriceSuggestion["scope"]) =>
          p && suggestions.push({ source: "lexicon", scope, label: p.label ?? a.specie!, amount: Number(p.price), unit: p.unit, date: p.started_on, ref: `production_prices:${p.id}` });
        push(pp.find((p) => p.nature === "farmer_price" && p.zone === department), "department");
        push(pp.find((p) => p.nature === "farmer_price" && p.zone === "0"), "national");
        push(pp.find((p) => p.nature === "matif_price"), "matif");
        // Agrifood s'il a des prix pour l'espèce, sinon Lexicon ; débouché courant de la production s'il est coté.
        const ofSpecie = market.filter((x) => x.specie === a.specie);
        const fromSource = ofSpecie.some((x) => x.source === "agrifood") ? ofSpecie.filter((x) => x.source === "agrifood") : ofSpecie;
        const preferred = marketCodesFor(a.specie, a.reference)[0]?.code;
        const places = fromSource.some((x) => x.code === preferred) ? fromSource.filter((x) => x.code === preferred) : fromSource;
        const newest = places[0] ? Date.parse(places[0].started_on) : 0;
        for (const m of places.filter((x) => newest - Date.parse(x.started_on) <= 183 * 86_400_000).slice(0, 3)) {
          suggestions.push({
            source: m.source,
            scope: "market",
            label: m.label,
            amount: Number(m.price),
            unit: m.unit,
            date: m.started_on,
            ref: `${m.source === "agrifood" ? "agrifood" : "eu_market_prices"}:${m.id}`,
          });
        }
      }
      return {
        activityId: a.id,
        production: a.reference,
        specie: a.specie,
        suggestions,
        yields: yields.filter((y) => y.production === a.reference).slice(0, 5).map((y) => ({ campaign: y.campaign, value: Number(y.yield_value), unit: y.yield_unit })),
      };
    });
    return { department, items };
  });
}

/**
 * Contexte économique d'une campagne d'assolement (lot E3) : par activité
 * végétale, rendements réalisés de la ferme (q/ha, moyenne des parcelles par
 * campagne), rendements Agreste et repères de prix, prix de vente saisi, et
 * les défauts qui en découlent ; coût horaire de la main-d'œuvre.
 */
export async function ecoContext(db: Database, farmId: string, year: number, today: string = new Date().toISOString().slice(0, 10)): Promise<EcoContext> {
  const refs = await productSuggestions(db, farmId, today);
  return withFarm(db, farmId, async (tx) => {
    const parcels = await harvestYields(tx, farmId, year - 3, year - 1);
    const productions = await rows<{ parcel_id: string; year: number; activity_id: string }>(
      tx,
      sql`SELECT pr.land_parcel_id AS parcel_id, c.year, pr.activity_id FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id
          WHERE pr.activity_id IS NOT NULL AND c.year BETWEEN ${year - 3} AND ${year - 1}`,
    );
    const activityOf = new Map(productions.map((p) => [`${p.parcel_id}|${p.year}`, p.activity_id]));
    const byActivityYear = new Map<string, number[]>();
    for (const y of parcels) {
      const a = activityOf.get(`${y.parcelId}|${y.year}`);
      if (!a) continue;
      const k = `${a}|${y.year}`;
      byActivityYear.set(k, [...(byActivityYear.get(k) ?? []), y.yieldQHa]);
    }
    const current = await rows<Row>(
      tx,
      sql`SELECT DISTINCT ON (kind, article_id, equipment_id, activity_id, product, procedure) ${COLS}
          FROM prices WHERE kind IN ('product', 'labour') AND valid_from <= ${today}::date
          ORDER BY kind, article_id, equipment_id, activity_id, product, procedure, valid_from DESC, created_at DESC`,
    );
    const prices = current.map(read);
    const byKey = new Map(prices.map((p) => [priceKey(p), p]));
    const activities = refs.items.map((i) => {
      const farmYields = [...byActivityYear.entries()]
        .filter(([k]) => k.startsWith(`${i.activityId}|`))
        .map(([k, vs]) => ({ campaign: Number(k.split("|")[1]), value: Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10 }))
        .sort((a, b) => b.campaign - a.campaign);
      const farmPrice = byKey.get(priceKey({ kind: "product", articleId: null, equipmentId: null, activityId: i.activityId, product: "principal", procedure: null })) ?? null;
      return {
        ...i,
        agreste: i.yields,
        farmYields,
        farmPrice,
        yield: defaultYield(farmYields, i.yields, year, refs.department),
        price: defaultPrice(farmPrice, i.suggestions),
      };
    });
    const labour = prices.find((p) => p.kind === "labour") ?? null;
    return { year, department: refs.department, activities: activities.map(({ yields: _y, ...a }) => a), labour };
  });
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const PACKAGING_LABELS: Record<string, string> = { bulk: "vrac", big_bag_600: "big bag 600 kg", big_bag_500: "big bag 500 kg", bag: "sac" };
const MERCHANT_LABELS: Record<string, string> = { cereapro: "Cereapro", germineo: "Germineo" };
const merchantLabel = (m: string) => m.split(", ").map((x) => MERCHANT_LABELS[x] ?? x).join(", ");
const close = (a: number | null, b: number | null) => Math.abs((a ?? 0) - (b ?? 0)) < 0.5;

/**
 * Repères Lexicon des intrants de la ferme (point 142, jeux réservés aux
 * adhérents) : prix de référence mensuels Cereapro et Germineo, rattachés
 * à l'article par l'AMM (phyto), la variante Lexicon ou la composition N-P-K
 * (engrais minéral), l'espèce, la variété (catalogue SEMAE) ou le nom (semence).
 * Douze derniers mois ; dernier prix par conditionnement, marchand, bio.
 */
export async function articleSuggestions(db: Database, farmId: string, today: string = new Date().toISOString().slice(0, 10)): Promise<ArticleSuggestions> {
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`;
  return withFarm(db, farmId, async (tx) => {
    const articles = await rows<{
      id: string;
      name: string;
      kind: "fertilizer" | "phyto" | "seed";
      amm: string | null;
      lexicon_ref: string | null;
      organic: boolean;
      basis: string | null;
      n: string | null;
      p: string | null;
      k: string | null;
      species: string | null;
      variety: string | null;
      mixture: boolean;
    }>(
      tx,
      sql`SELECT a.id, a.name, a.kind, a.amm, a.lexicon_ref, coalesce(a.organic_status = 'organic', false) AS organic,
                 f.basis, f.n_total::text AS n, f.p2o5::text AS p, f.k2o::text AS k, s.species, s.variety_name AS variety,
                 coalesce(s.is_mixture, false) AS mixture
          FROM articles a LEFT JOIN article_fertilizers f ON f.article_id = a.id LEFT JOIN article_seeds s ON s.article_id = a.id
          WHERE a.kind IN ('fertilizer', 'phyto', 'seed')`,
    );
    if (!articles.length) return { items: [] };
    const fertilizers = await rows<{ id: string; name: string; kind: string; nitrogen: string | null; phosphorus: string | null; potassium: string | null; variant: string | null }>(
      tx,
      sql`SELECT id, name, kind, nitrogen::text, phosphorus::text, potassium::text, variant FROM lexicon_fertilizer_refs`,
    );
    const species = await rows<{ id: string; name: string; taxon: string | null }>(tx, sql`SELECT id, name, taxon FROM lexicon_seed_species`);
    const prices = await rows<{ id: string; kind: string; ref: string; packaging: string | null; organic: boolean | null; month: string; price: string; unit: string; merchant: string }>(
      tx,
      sql`SELECT DISTINCT ON (kind, ref, packaging, organic, merchant) id, kind, ref, packaging, organic, month::text, price::text, unit, merchant
          FROM lexicon_input_prices WHERE month >= ${since}::date
          ORDER BY kind, ref, packaging, organic, merchant, month DESC`,
    );
    if (!prices.length) return { items: [] };
    // Variétés des semences nommées par leur variété : espèce si elle est unique dans le catalogue.
    const names = [...new Set(articles.filter((a) => a.kind === "seed").flatMap((a) => [a.variety, a.name].filter((x): x is string => !!x).map((x) => x.trim().toUpperCase())))];
    const varieties = names.length
      ? await rows<{ name: string; species: string[] }>(
          tx,
          sql`SELECT upper(variety_name) AS name, array_agg(DISTINCT species) AS species FROM lexicon_seed_varieties
              WHERE upper(variety_name) = ANY(${`{${names.map((n) => `"${n.replace(/"/g, "")}"`).join(",")}}`}::text[]) GROUP BY 1`,
        )
      : [];
    const speciesOfVariety = new Map(varieties.filter((v) => v.species.length === 1).map((v) => [v.name, v.species[0]!]));
    const month = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", month: "short", year: "numeric" });

    const items: ArticleSuggestions["items"] = [];
    for (const a of articles) {
      let refs: { kind: string; ref: string; name: string; how: string }[] = [];
      if (a.kind === "phyto" && a.amm) refs = [{ kind: "phyto", ref: String(Number(a.amm)), name: a.name, how: `AMM ${a.amm}` }];
      else if (a.kind === "fertilizer") {
        const byVariant = a.lexicon_ref ? fertilizers.filter((f) => f.variant === a.lexicon_ref) : [];
        const byComposition =
          !byVariant.length && a.basis === "mass_percent" && a.n !== null
            ? fertilizers.filter(
                (f) =>
                  f.kind === "mineral" &&
                  // Composition connue des deux côtés : une référence sans teneur (ou un article presque vide) ne se rattache à rien.
                  Number(f.nitrogen ?? 0) + Number(f.phosphorus ?? 0) + Number(f.potassium ?? 0) >= 1 &&
                  Number(a.n ?? 0) + Number(a.p ?? 0) + Number(a.k ?? 0) >= 1 &&
                  close(Number(f.nitrogen ?? 0), Number(a.n)) &&
                  close(Number(f.phosphorus ?? 0), Number(a.p ?? 0)) &&
                  close(Number(f.potassium ?? 0), Number(a.k ?? 0)),
              )
            : [];
        refs = byVariant.length
          ? byVariant.map((f) => ({ kind: "fertilizer", ref: f.id, name: f.name, how: "variante Lexicon" }))
          : byComposition.slice(0, 2).map((f) => ({ kind: "fertilizer", ref: f.id, name: f.name, how: "même composition" }));
      } else if (a.kind === "seed") {
        const taxon = a.species ?? speciesOfVariety.get((a.variety ?? "").trim().toUpperCase()) ?? speciesOfVariety.get(a.name.trim().toUpperCase()) ?? null;
        const byTaxon = taxon ? species.filter((s) => s.taxon === taxon) : [];
        const n = norm(a.name);
        // Par le nom, jamais pour un mélange (« Avoine + radis + phacélie » n'a pas le prix de l'avoine).
        const mixture = a.mixture || /[+&]/.test(a.name);
        const byName = byTaxon.length || mixture ? [] : species.filter((s) => n === norm(s.name) || n.startsWith(`${norm(s.name)} `));
        refs = (byTaxon.length ? byTaxon : byName).slice(0, 1).map((s) => ({ kind: "seed", ref: s.id, name: s.name, how: byTaxon.length ? "espèce" : "nom" }));
      }
      const suggestions: PriceSuggestion[] = [];
      for (const r of refs) {
        const list = prices
          .filter((p) => p.kind === r.kind && p.ref === r.ref)
          // Semences : bio ou conventionnel selon l'article.
          .filter((p) => p.organic === null || p.organic === a.organic)
          .sort((x, y) => y.month.localeCompare(x.month) || Number(x.price) - Number(y.price));
        for (const p of list.slice(0, 3)) {
          const pack = p.packaging ? PACKAGING_LABELS[p.packaging] ?? p.packaging : null;
          suggestions.push({
            source: "lexicon",
            scope: "reference",
            label: [r.name, pack, p.organic ? "bio" : null, `${merchantLabel(p.merchant)}, ${month(p.month)}`].filter(Boolean).join(" · "),
            amount: Number(p.price),
            unit: p.unit,
            date: p.month,
            ref: `input_prices:${p.id}`,
          });
        }
      }
      if (suggestions.length) items.push({ articleId: a.id, match: `${refs.map((r) => r.name).join(", ")} (${refs[0]!.how})`, suggestions });
    }
    return { items };
  });
}
