import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { ArticleKind, ItkArticleInfo, ItkContent, ItkInputsContext } from "@fourmy/contracts";
import { toStockQuantity } from "@fourmy/domain";

/**
 * Besoins en intrants de l'assolement (lot IT5, claudedocs/conception_assolement_itk.md
 * §9) : articles cités par les ITK et les plans de fumure, avec ce qui sert à
 * convertir les doses ; stock disponible ; quantités déjà réservées par les
 * interventions prévues saisies à la main ; apports des plans de fumure
 * établis. Le calcul se fait dans le navigateur (`inputNeeds`).
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const pgArray = (values: string[]) => `{${values.join(",")}}`;

export async function itkInputsContext(db: Database, farmId: string, year: number): Promise<ItkInputsContext> {
  return withFarm(db, farmId, async (tx) => {
    const at = new Date().toISOString();
    const itks = await rows<{ content: ItkContent }>(tx, sql`SELECT content FROM technical_itineraries`);

    // Plans de fumure établis (ou révisés) de la campagne : apports de la version en cours.
    const apps = await rows<{ plan_id: string; land_parcel_id: string; article_id: string | null; stage: string; n_total: number; planned_on: string | null }>(
      tx,
      sql`SELECT p.id AS plan_id, p.land_parcel_id, a.article_id, a.stage, a.n_total::float8 AS n_total, a.planned_on::text
          FROM fertilization_plans p JOIN fertilization_plan_applications a ON a.plan_id = p.id AND a.version = p.current_version
          WHERE p.campaign = ${year} AND p.kind = 'main' AND p.status IN ('established', 'revised')
          ORDER BY p.id, a.rank`,
    );
    const plans: ItkInputsContext["plans"] = {};
    for (const a of apps) {
      const plan = (plans[`p:${a.land_parcel_id}`] ??= { planId: a.plan_id, applications: [] });
      plan.applications.push({ articleId: a.article_id, stage: a.stage, nTotalKgHa: a.n_total, plannedOn: a.planned_on });
    }

    // Interventions prévues saisies à la main sur la campagne (les générées par un ITK sont déjà dans les besoins).
    const planned = await rows<{ article_id: string; quantity: number; unit: string; area_ha: number | null }>(
      tx,
      sql`SELECT p.ref_id AS article_id, p.quantity::float8 AS quantity, p.unit,
                 (SELECT sum(coalesce((t.attrs->>'workedAreaM2')::float8,
                                      (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = t.ref_id ORDER BY lower(v.valid) DESC LIMIT 1)))
                  FROM intervention_parameters t WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel') / 10000.0 AS area_ha
          FROM interventions i JOIN intervention_parameters p ON p.intervention_id = i.id AND p.role = 'input' AND p.ref_type = 'article'
          WHERE i.status = 'planned' AND i.itinerary_ref IS NULL AND p.quantity IS NOT NULL
            AND coalesce(i.started_at, i.created_at) >= make_date(${year - 1}, 8, 1) AND coalesce(i.started_at, i.created_at) < make_date(${year + 1}, 1, 1)`,
    );

    const ids = new Set<string>();
    for (const t of itks) for (const s of t.content.steps) for (const i of s.inputs) if (i.articleId) ids.add(i.articleId);
    for (const a of apps) if (a.article_id) ids.add(a.article_id);
    for (const p of planned) ids.add(p.article_id);
    const articles = await articleInfos(tx, [...ids]);

    const stock: Record<string, number> = {};
    if (ids.size) {
      for (const s of await rows<{ article_id: string; quantity: number }>(
        tx,
        sql`SELECT l.article_id, sum(m.quantity)::float8 AS quantity FROM stock_movements m JOIN lots l ON l.id = m.lot_id
            WHERE l.article_id = ANY(${pgArray([...ids])}::uuid[]) AND m.occurred_at <= ${at}::timestamptz GROUP BY l.article_id`,
      ))
        stock[s.article_id] = Math.round(s.quantity * 1000) / 1000;
    }
    const reserved: Record<string, number> = {};
    for (const p of planned) {
      const a = articles[p.article_id];
      if (!a) continue;
      try {
        const q = toStockQuantity({
          quantity: p.quantity,
          unit: p.unit,
          articleUnit: a.unit,
          areaHa: p.area_ha,
          density: a.density,
          ...(a.kind === "seed" ? { seed: { tgwG: a.tgwG, grainsPerDose: a.grainsPerDose } } : {}),
        });
        reserved[p.article_id] = Math.round(((reserved[p.article_id] ?? 0) + q) * 1000) / 1000;
      } catch {
        // Unité ou surface inconnue : non comptée (la saisie le signale déjà à la réalisation).
      }
    }
    return { year, at: at.slice(0, 10), articles, stock, reserved, plans };
  });
}

/** Fiches des articles (unité, densité, teneurs, PMG) qui servent à convertir les doses. */
export async function articleInfos(tx: Tx, idList: string[]): Promise<Record<string, ItkArticleInfo>> {
  const ids = new Set(idList);
  const list = ids.size
    ? await rows<{
        id: string;
        name: string;
        kind: ArticleKind;
        unit: string;
        density: number | null;
        basis: "mass_percent" | "kg_per_t" | "kg_per_m3" | null;
        n_total: number | null;
        tgw_g: number | null;
        grains_per_dose: number | null;
      }>(
        tx,
        sql`SELECT a.id, a.name, a.kind, a.unit, f.density::float8 AS density, f.basis, f.n_total::float8 AS n_total, s.tgw_g::float8 AS tgw_g, s.grains_per_dose
            FROM articles a LEFT JOIN article_fertilizers f ON f.article_id = a.id LEFT JOIN article_seeds s ON s.article_id = a.id
            WHERE a.id = ANY(${pgArray([...ids])}::uuid[])`,
      )
    : [];
  const articles: Record<string, ItkArticleInfo> = Object.fromEntries(
    list.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.name,
        kind: a.kind,
        unit: a.unit,
        density: a.density,
        tgwG: a.tgw_g,
        grainsPerDose: a.grains_per_dose,
        fertilizer: a.basis && a.n_total !== null ? { basis: a.basis, nTotal: a.n_total, density: a.density } : null,
      },
    ]),
  );
  return articles;
}
