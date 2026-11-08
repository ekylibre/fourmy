import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadFixture, type FixtureFile } from "../src/index.js";

/**
 * Fixtures anonymisées des fermes pilotes (issues des vrais exports Ekylibre) :
 * on les charge, puis on vérifie volumes et registre phyto **via la RLS**
 * (rôle fourmy_app + contexte de ferme). Exécuté en CI (service Postgres).
 */
const url = process.env.DATABASE_URL;
const FILES = ["pilote-grandes-cultures.json", "pilote-viticulture.json"];

describe.skipIf(!url)("fixtures pilotes", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const fixtures: FixtureFile[] = [];

  beforeAll(async () => {
    for (const f of FILES) {
      const path = fileURLToPath(new URL(`../../../fixtures/${f}`, import.meta.url));
      const fixture = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
      await loadFixture(sql, fixture);
      fixtures.push(fixture);
    }
  }, 60_000);
  afterAll(() => sql.end());

  it("recharger une fixture retire les périodes et paramètres qui n'y sont plus", async () => {
    const fixture = fixtures[1]!;
    const interventionId = fixture.tables.interventions![0]!.id as string;
    const stale = crypto.randomUUID();
    await sql`INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at)
              VALUES (${stale}, ${interventionId}, '2020-01-01T08:00:00Z', '2020-01-01T09:00:00Z')`;
    await loadFixture(sql, fixture);
    expect(await sql`SELECT 1 FROM intervention_periods WHERE id = ${stale}`).toHaveLength(0);
  }, 60_000);

  for (const [i, f] of FILES.entries()) {
    it(`${f} : volumes et registre phyto conformes, sous RLS`, async () => {
      const fixture = fixtures[i]!;
      const farmId = fixture.tables.farms![0]!.id as string;

      const result = await sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE fourmy_app`;
        await tx`SELECT set_config('fourmy.farm_id', ${farmId}, true)`;
        const [counts] = await tx`
          SELECT (SELECT count(*) FROM land_parcels)::int AS land_parcels,
                 (SELECT count(*) FROM interventions)::int AS interventions,
                 (SELECT count(*) FROM stock_movements)::int AS stock_movements,
                 (SELECT count(*) FROM containers)::int AS containers,
                 (SELECT count(*) FROM intervention_periods)::int AS intervention_periods,
                 (SELECT count(*) FROM intervention_parameters)::int AS intervention_parameters`;
        const phyto = await tx<{ year: number; rows: number }[]>`
          SELECT extract(year FROM done_at)::int AS year, count(*)::int AS rows
          FROM phyto_register GROUP BY 1 ORDER BY 1`;
        return { counts, phyto };
      });

      const exp = fixture.meta.expected.counts;
      expect(result.counts).toEqual({
        land_parcels: exp.land_parcels,
        interventions: exp.interventions,
        stock_movements: exp.stock_movements,
        containers: exp.containers,
        intervention_periods: exp.intervention_periods,
        intervention_parameters: exp.intervention_parameters,
      });
      expect(Object.fromEntries(result.phyto.map((p) => [String(p.year), p.rows]))).toEqual(
        fixture.meta.expected.phytoRowsByYear,
      );
    });
  }
});
