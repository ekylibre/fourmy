import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { RealizedFacts } from "@fourmy/contracts";
import { harvestYields } from "./fertilization-plans.js";
import { articleInfos } from "./itk-inputs.js";

/**
 * Faits réalisés de la campagne `year` (lot E5, comparaison N-1,
 * claudedocs/conception_assolement_eco.md §3.5) : cultures et rendements
 * réalisés, interventions réalisées rattachées à la culture du jour
 * (`fourmy_production_at`), avec leur surface, leurs heures (périodes de plus
 * de 24 h écartées, règle de la recette du temps 2), matériels, personnes et
 * intrants. La valorisation se fait dans le domaine (`realizedMargins`).
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

export async function realizedFacts(db: Database, farmId: string, year: number): Promise<RealizedFacts> {
  return withFarm(db, farmId, async (tx) => {
    const prods = await rows<{ id: string; land_parcel_id: string; activity_id: string; area_m2: number | null }>(
      tx,
      sql`SELECT pr.id, pr.land_parcel_id, pr.activity_id,
                 (SELECT v.area_m2::float8 FROM land_parcel_versions v WHERE v.land_parcel_id = pr.land_parcel_id
                  ORDER BY (v.valid @> make_date(${year}, 6, 1)::timestamptz) DESC, upper(v.valid) DESC NULLS FIRST LIMIT 1) AS area_m2
          FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id AND c.year = ${year}
          WHERE pr.activity_id IS NOT NULL`,
    );
    const yields = new Map((await harvestYields(tx, farmId, year, year)).map((y) => [y.parcelId, y.yieldQHa]));

    // Une ligne par parcelle travaillée d'une intervention réalisée, rattachée à la culture du jour.
    const targets = await rows<{
      intervention_id: string;
      production_id: string;
      activity_id: string;
      procedure: string;
      day: string;
      area_m2: number | null;
      total_m2: number | null;
      hours: number | null;
    }>(
      tx,
      sql`WITH t AS (
            SELECT i.id AS intervention_id, i.procedure, i.started_at, i.period_precision, tp.ref_id AS parcel_id,
                   coalesce((tp.attrs->>'workedAreaM2')::float8,
                            (SELECT v.area_m2::float8 FROM land_parcel_versions v WHERE v.land_parcel_id = tp.ref_id AND v.valid @> i.started_at LIMIT 1)) AS area_m2
            FROM interventions i
            JOIN intervention_parameters tp ON tp.intervention_id = i.id AND tp.role = 'target' AND tp.ref_type = 'land_parcel'
            WHERE i.status = 'done' AND i.started_at >= make_date(${year - 1}, 8, 1) AND i.started_at < make_date(${year + 1}, 1, 1))
          SELECT t.intervention_id, pr.id AS production_id, pr.activity_id, t.procedure,
                 (t.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, t.area_m2,
                 sum(t.area_m2) OVER (PARTITION BY t.intervention_id) AS total_m2,
                 CASE WHEN t.period_precision = 'time' THEN
                   (SELECT nullif(coalesce(sum(extract(epoch FROM q.stopped_at - q.started_at)) FILTER (WHERE q.stopped_at - q.started_at <= interval '24 hours'), 0), 0)
                    FROM intervention_periods q WHERE q.intervention_id = t.intervention_id) / 3600.0
                 END AS hours
          FROM t
          JOIN productions pr ON pr.id = fourmy_production_at(t.parcel_id, (t.started_at AT TIME ZONE 'Europe/Paris')::date)
          JOIN campaigns c ON c.id = pr.campaign_id AND c.year = ${year}
          WHERE pr.activity_id IS NOT NULL`,
    );
    const ids = [...new Set(targets.map((t) => t.intervention_id))];
    const arr = `{${ids.join(",")}}`;
    const params = ids.length
      ? await rows<{ intervention_id: string; role: string; ref_id: string; quantity: number | null; unit: string | null }>(
          tx,
          sql`SELECT intervention_id, role, ref_id, quantity::float8 AS quantity, unit FROM intervention_parameters
              WHERE intervention_id = ANY(${arr}::uuid[]) AND ((role = 'tool' AND ref_type = 'equipment') OR (role = 'doer' AND ref_type = 'person')
                    OR (role = 'input' AND ref_type = 'article' AND quantity IS NOT NULL))`,
        )
      : [];
    const of = (id: string, role: string) => params.filter((p) => p.intervention_id === id && p.role === role);
    const works: RealizedFacts["works"] = targets.map((t) => {
      // Part de la parcelle dans l'intervention : heures et quantités totales au prorata ; doses à l'hectare sur sa surface.
      const share = t.total_m2 && t.area_m2 ? t.area_m2 / t.total_m2 : 1 / Math.max(1, targets.filter((x) => x.intervention_id === t.intervention_id).length);
      const areaHa = (t.area_m2 ?? 0) / 10_000;
      return {
        interventionId: t.intervention_id,
        productionId: t.production_id,
        activityId: t.activity_id,
        procedure: t.procedure,
        day: t.day,
        areaHa,
        hours: t.hours !== null ? t.hours * share : null,
        equipmentIds: of(t.intervention_id, "tool").map((p) => p.ref_id),
        people: of(t.intervention_id, "doer").length,
        inputs: of(t.intervention_id, "input")
          .filter((p) => p.unit)
          .map((p) => ({ articleId: p.ref_id, quantity: /_per_hectare$/.test(p.unit!) ? p.quantity! : p.quantity! * share, unit: p.unit! })),
      };
    });
    const articles = await articleInfos(tx, [...new Set(works.flatMap((w) => w.inputs.map((i) => i.articleId)))]);
    return {
      year,
      productions: prods.map((p) => ({ productionId: p.id, activityId: p.activity_id, areaHa: (p.area_m2 ?? 0) / 10_000, yieldQHa: yields.get(p.land_parcel_id) ?? null })),
      works,
      articles,
    };
  });
}
