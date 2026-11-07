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
        (SELECT count(*) FROM stock_movements WHERE farm_id = ${farmId})::int AS movements`;
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
  }, 120_000);
});
