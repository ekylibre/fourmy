import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { migrate } from "../src/index.js";

/**
 * Migration réelle d'une base source restaurée (scripts/restore-source.sh).
 * Ne s'exécute que si MIGRATOR_SOURCE_URL et DATABASE_URL sont fournis :
 * les exports Ekylibre ne sont pas dans le dépôt, donc ignoré en CI.
 */
const sourceUrl = process.env.MIGRATOR_SOURCE_URL;
const targetUrl = process.env.DATABASE_URL;

async function rowCounts(farmId: string) {
  const sql = postgres(targetUrl!, { max: 1 });
  try {
    const [r] = await sql`
      SELECT
        (SELECT count(*) FROM land_parcels WHERE farm_id = ${farmId})::int AS parcels,
        (SELECT count(*) FROM productions WHERE farm_id = ${farmId})::int AS productions,
        (SELECT count(*) FROM interventions WHERE farm_id = ${farmId})::int AS interventions,
        (SELECT count(*) FROM intervention_parameters ip JOIN interventions i ON i.id = ip.intervention_id
          WHERE i.farm_id = ${farmId})::int AS parameters,
        (SELECT count(*) FROM stock_movements WHERE farm_id = ${farmId})::int AS movements,
        (SELECT count(*) FROM intervention_crews c JOIN interventions i ON i.id = c.intervention_id
          WHERE i.farm_id = ${farmId})::int AS crews,
        (SELECT count(*) FROM interventions WHERE farm_id = ${farmId} AND staffing = 'crews')::int AS in_crews,
        (SELECT count(*) FROM intervention_periods w JOIN interventions i ON i.id = w.intervention_id
          WHERE i.farm_id = ${farmId} AND w.crew_id IS NOT NULL)::int AS crew_periods`;
    return r;
  } finally {
    await sql.end();
  }
}

describe.skipIf(!sourceUrl || !targetUrl)("migration Ekylibre (intégration)", () => {
  it("migre, reproduit le registre phyto et reste idempotente", async () => {
    const first = await migrate({ sourceUrl: sourceUrl!, targetUrl: targetUrl! });
    expect(first.counts.land_parcels).toBeGreaterThan(0);
    expect(first.counts.interventions).toBeGreaterThan(0);
    // Critère de US-5 : même nombre de lignes de registre phyto, année par année.
    for (const year of first.phyto) expect(year.fourmy).toBe(year.ekylibre);

    const before = await rowCounts(first.farmId);
    const second = await migrate({ sourceUrl: sourceUrl!, targetUrl: targetUrl! });
    expect(second.farmId).toBe(first.farmId);
    expect(await rowCounts(first.farmId)).toEqual(before);
    // Attelages (FR-ATT-10) : mêmes décisions, aucun doublon, registre inchangé.
    expect(before!.crews).toBe(first.counts.crews ?? 0);
    expect(before!.in_crews).toBe((first.counts.crews_rule_1 ?? 0) + (first.counts.crews_rule_2 ?? 0));
    for (const k of ["crews", "crews_rule_1", "crews_rule_2", "crews_ambiguous"]) expect(second.counts[k]).toBe(first.counts[k]);
    for (const year of second.phyto) expect(year.fourmy).toBe(year.ekylibre);

    // Une intervention corrigée dans Fourmy n'est pas réécrite (ni ses attelages).
    const sql = postgres(targetUrl!, { max: 1, onnotice: () => {} });
    const auditId = crypto.randomUUID();
    try {
      const [target] = await sql<{ id: string; procedure: string }[]>`
        SELECT id, procedure FROM interventions WHERE farm_id = ${first.farmId} AND staffing = 'crews' ORDER BY id LIMIT 1`;
      if (!target) return;
      await sql`UPDATE interventions SET procedure = 'corrigee_test' WHERE id = ${target.id}`;
      await sql`INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
                VALUES (${auditId}, ${first.farmId}, 'test', 'web', 'intervention', ${target.id}, 'corrected', '{}')`;
      try {
        const third = await migrate({ sourceUrl: sourceUrl!, targetUrl: targetUrl! });
        expect(third.counts.interventions_preserved).toBe(1);
        const [after] = await sql<{ procedure: string; crews: number }[]>`
          SELECT procedure, (SELECT count(*)::int FROM intervention_crews WHERE intervention_id = i.id) AS crews
          FROM interventions i WHERE id = ${target.id}`;
        expect(after).toMatchObject({ procedure: "corrigee_test" });
        expect(after!.crews).toBeGreaterThan(0);
      } finally {
        await sql`DELETE FROM audit_log WHERE id = ${auditId}`;
        await sql`UPDATE interventions SET procedure = ${target.procedure} WHERE id = ${target.id}`;
      }
    } finally {
      await sql.end();
    }
  }, 240_000);
});
