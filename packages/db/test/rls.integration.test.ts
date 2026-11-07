import { describe, it, expect } from "vitest";
import postgres from "postgres";

/**
 * Isolation RLS de bout en bout — ne s'exécute que si DATABASE_URL pointe une
 * base migrée (dev : docker/compose.dev.yml + pnpm migrate). Ignoré en CI tant
 * qu'aucun service Postgres n'est fourni.
 */
const url = process.env.DATABASE_URL;
describe.skipIf(!url)("RLS", () => {
  it("une ferme ne voit que ses parcelles", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      const a = "11111111-1111-7111-8111-1111111111aa";
      const b = "22222222-2222-7222-8222-2222222222bb";
      await sql`INSERT INTO farms(id,name) VALUES (${a},'A'),(${b},'B')
                ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO land_parcels(id,farm_id,name) VALUES
        (${"aaaa1111-0000-7000-8000-000000000001"},${a},'PA'),
        (${"bbbb2222-0000-7000-8000-000000000002"},${b},'PB')
        ON CONFLICT DO NOTHING`;
      const rows = await sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE fourmy_app`;
        await tx`SELECT set_config('fourmy.farm_id', ${a}, true)`;
        return tx`SELECT name FROM land_parcels`;
      });
      expect(rows.map((r) => r.name)).toEqual(["PA"]);
    } finally {
      await sql.end();
    }
  });
});
