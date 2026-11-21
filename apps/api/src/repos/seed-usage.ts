import { sql } from "drizzle-orm";
import { tgwReference } from "@fourmy/certification-refs";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { LotSeed, SeedConversion, SeedUsage, SeedUsageBy, SeedUsageGroup, TgwOrigin } from "@fourmy/contracts";
import { convertSeedQuantity, parseSeedUnit, resolveTgw, seedEquivalents, seedRate, summarizeSeedUsage, type SeedUsageLine } from "@fourmy/domain";
import { csv } from "./certification-exports.js";
import { CAMPAIGN_OF } from "./seeds.js";

/**
 * Utilisation des semences par campagne (lot SE7, FR-SE-24 à 27) : pour
 * chaque intrant semence, quantité dans l'unité du stock (mouvement de stock,
 * sinon conversion), kg et grains, surface, densités. Réalisé et prévu
 * distingués ; regroupement par semence ou par espèce.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

type Row = {
  article_id: string;
  name: string;
  article_unit: string;
  species: string | null;
  species_label: string | null;
  is_mixture: boolean | null;
  grains_per_dose: number | null;
  tgw_g: number | null;
  tgw_origin: TgwOrigin | null;
  status: "done" | "planned";
  quantity: string | null;
  unit: string | null;
  conversion: SeedConversion | null;
  lot_seed: LotSeed | null;
  worked_m2: number | null;
  activity: string | null;
  moved: number | null;
};

/** Un intrant : quantité de stock, kg, grains et densités, « estimé » si un PMG repère a servi. */
export function usageLine(r: Row): SeedUsageLine {
  const areaHa = r.worked_m2 ? r.worked_m2 / 10_000 : null;
  const quantity = r.quantity === null ? null : Number(r.quantity);
  const grainsPerDose = r.conversion?.grainsPerDose ?? r.grains_per_dose;
  const tgw = r.is_mixture
    ? null
    : r.conversion?.tgwG
      ? { tgwG: r.conversion.tgwG, estimated: r.conversion.estimated }
      : resolveTgw({
          lot: r.lot_seed ? { tgwG: r.lot_seed.tgwG, origin: r.lot_seed.origin } : null,
          article: r.tgw_g ? { tgwG: r.tgw_g, origin: r.tgw_origin! } : null,
          reference: tgwReference(r.species),
        });
  const ctx = { tgwG: tgw?.tgwG ?? null, grainsPerDose };
  const empty: SeedUsageLine = { areaHa, stock: null, kg: null, grains: null, kgPerHa: null, grainsPerM2: null, estimated: false };
  if (quantity === null || !r.unit) return { ...empty, stock: r.moved };
  const { unit: base, perM2 } = seedRate(r.unit);
  // Quantité totale dans l'unité saisie.
  const total = perM2 !== null ? (areaHa ? quantity * areaHa * 10_000 * perM2 : null) : quantity;
  const stock =
    r.moved ?? (total === null ? null : base === r.article_unit ? total : convertSeedQuantity(total, base, r.article_unit, ctx));
  const eq = seedEquivalents(quantity, r.unit, ctx, areaHa);
  const kgPerHa = eq?.kgPerHa ?? null;
  const grainsPerM2 = eq?.grainsPerM2 ?? null;
  // Estimé : une valeur obtenue en passant d'une dimension à l'autre avec un PMG repère.
  const dim = parseSeedUnit(base, grainsPerDose)?.dim;
  const crossed = (dim === "mass" && grainsPerM2 !== null) || ((dim === "grain" || dim === "dose") && kgPerHa !== null);
  return {
    areaHa,
    stock,
    kg: kgPerHa !== null && areaHa ? kgPerHa * areaHa : null,
    grains: grainsPerM2 !== null && areaHa ? grainsPerM2 * areaHa * 10_000 : null,
    kgPerHa,
    grainsPerM2,
    estimated: crossed && (tgw?.estimated ?? false),
  };
}

const NO_SPECIES = "sans-espece";

export async function seedUsageIn(tx: Tx, campaign: number, by: SeedUsageBy): Promise<SeedUsage> {
  const list = await rows<Row>(
    tx,
    sql`SELECT a.id AS article_id, a.name, a.unit AS article_unit, s.species,
               coalesce((SELECT t.label FROM taxonomy t WHERE t.reference_name = s.species),
                        (SELECT initcap(lower(v.species_label)) FROM lexicon_seed_varieties v WHERE v.species = s.species LIMIT 1)) AS species_label,
               s.is_mixture, s.grains_per_dose, s.tgw_g::float8 AS tgw_g, s.tgw_origin,
               i.status, ip.quantity, ip.unit, ip.attrs->'seedConversion' AS conversion,
               (SELECT l.attrs->'seed' FROM lots l WHERE l.id::text = ip.attrs->>'lotId') AS lot_seed,
               (SELECT sum(coalesce((t.attrs->>'workedAreaM2')::float8, (SELECT v.area_m2::float8 FROM land_parcel_versions v
                                                                          WHERE v.land_parcel_id = t.ref_id ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1)))
                FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') AS worked_m2,
               (SELECT coalesce(ac.name, p.nature) FROM intervention_parameters t
                JOIN productions p ON p.id = fourmy_production_at(t.ref_id, i.started_at::date)
                LEFT JOIN activities ac ON ac.id = p.activity_id
                WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel' LIMIT 1) AS activity,
               (SELECT nullif(-sum(m.quantity), 0)::float8 FROM stock_movements m JOIN lots l ON l.id = m.lot_id
                WHERE m.intervention_id = i.id AND l.article_id = a.id) AS moved
        FROM intervention_parameters ip
        JOIN interventions i ON i.id = ip.intervention_id AND i.status IN ('done', 'planned')
        JOIN articles a ON a.id = ip.ref_id AND a.kind = 'seed'
        LEFT JOIN article_seeds s ON s.article_id = a.id
        WHERE ip.role = 'input' AND ip.ref_type = 'article' AND ${CAMPAIGN_OF} = ${campaign}
        ORDER BY a.name, i.started_at`,
  );
  const groups = new Map<string, { group: Omit<SeedUsageGroup, "done" | "planned">; done: SeedUsageLine[]; planned: SeedUsageLine[] }>();
  for (const r of list) {
    const key = by === "article" ? r.article_id : (r.species ?? NO_SPECIES);
    const g =
      groups.get(key) ??
      groups
        .set(key, {
          group: {
            key,
            label: by === "article" ? r.name : (r.species_label ?? (r.is_mixture ? "Mélanges" : "Espèce non renseignée")),
            species: r.species,
            speciesLabel: r.species_label,
            unit: by === "article" ? r.article_unit : null,
            articles: [],
            activities: [],
          },
          done: [],
          planned: [],
        })
        .get(key)!;
    if (!g.group.articles.some((a) => a.articleId === r.article_id)) g.group.articles.push({ articleId: r.article_id, name: r.name });
    if (r.activity && !g.group.activities.includes(r.activity)) g.group.activities.push(r.activity);
    g[r.status].push(usageLine(r));
  }
  return {
    campaign,
    by,
    groups: [...groups.values()]
      .map((g) => ({
        ...g.group,
        activities: g.group.activities.sort((a, b) => a.localeCompare(b, "fr")),
        done: summarizeSeedUsage(g.done, by === "article"),
        planned: summarizeSeedUsage(g.planned, by === "article"),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr")),
  };
}

export async function seedUsage(db: Database, farmId: string, campaign: number, by: SeedUsageBy): Promise<SeedUsage> {
  return withFarm(db, farmId, (tx) => seedUsageIn(tx, campaign, by));
}

/** Export CSV (FR-SE-26) : une ligne par semence (ou espèce) et par statut, réalisé puis prévu. */
export function seedUsageCsv(u: SeedUsage): string {
  const header = [
    "Campagne",
    u.by === "article" ? "Semence" : "Espèce",
    u.by === "article" ? "Espèce" : "Semences",
    "Statut",
    "Interventions",
    "Surface (ha)",
    "Quantité (unité du stock)",
    "Unité du stock",
    "Masse (kg)",
    "Grains",
    "Dose moyenne (kg/ha)",
    "Dose minimum (kg/ha)",
    "Dose maximum (kg/ha)",
    "Densité moyenne (grains/m²)",
    "Densité minimum (grains/m²)",
    "Densité maximum (grains/m²)",
    "Estimé (PMG repère)",
    "Doses non convertibles",
    "Activités",
  ];
  const lines: unknown[][] = [];
  for (const g of u.groups) {
    for (const [status, f] of [
      ["Réalisé", g.done],
      ["Prévu", g.planned],
    ] as const) {
      if (!f.interventions) continue;
      lines.push([
        u.campaign,
        g.label,
        u.by === "article" ? (g.speciesLabel ?? "") : g.articles.map((a) => a.name).join(", "),
        status,
        f.interventions,
        f.areaHa,
        f.stockQuantity ?? "",
        g.unit ?? "",
        f.kg ?? "",
        f.grains ?? "",
        f.kgPerHa?.mean ?? "",
        f.kgPerHa?.min ?? "",
        f.kgPerHa?.max ?? "",
        f.grainsPerM2?.mean ?? "",
        f.grainsPerM2?.min ?? "",
        f.grainsPerM2?.max ?? "",
        f.estimated ? "oui" : "non",
        f.unconvertible,
        g.activities.join(", "),
      ]);
    }
  }
  return csv(header, lines);
}
