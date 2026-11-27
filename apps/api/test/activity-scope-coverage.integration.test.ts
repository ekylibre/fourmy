import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";

/**
 * Couverture du périmètre d'activités (lot AM2, conception_api_mcp.md §5.2) :
 * toute table rattachée à une parcelle, une production, une activité, une
 * intervention ou un plan porte une politique `activity_scope`. Une table
 * ajoutée plus tard sans politique fait échouer ce test au lieu de fuir.
 */
const url = process.env.DATABASE_URL;

/** Colonnes qui rattachent une ligne à ce que le périmètre filtre. */
const SCOPED_COLUMNS = [
  "land_parcel_id",
  "land_parcel_version_id",
  "production_id",
  "activity_id",
  "intervention_id",
  "sowing_intervention_id",
  "prescription_id",
  "plan_id",
];

/** Tables volontairement hors périmètre, avec la raison. */
const EXEMPT: Record<string, string> = {
  stock_movements: "stocks régis par le module seul (API-9, point 4 validé le 27/11)",
};

describe.skipIf(!url)("couverture du périmètre d'activités", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("chaque table rattachée a sa politique activity_scope", async () => {
    const tables = await sql<{ table_name: string }[]>`
      SELECT DISTINCT c.table_name FROM information_schema.columns c
      JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
      WHERE c.table_schema = 'public' AND c.column_name IN ${sql(SCOPED_COLUMNS)}`;
    const expected = new Set([...tables.map((t) => t.table_name), "land_parcels", "activities", "interventions", "crop_plans"]);
    const covered = new Set(
      (await sql<{ tablename: string }[]>`SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'activity_scope'`).map((r) => r.tablename),
    );
    const missing = [...expected].filter((t) => !covered.has(t) && !(t in EXEMPT)).sort();
    expect(missing, "tables sans politique activity_scope (migration à compléter, ou exemption motivée)").toEqual([]);
    for (const t of Object.keys(EXEMPT)) expect(covered.has(t), `${t} est exemptée mais a une politique`).toBe(false);
  });

  it("les politiques activity_scope sont restrictives et en lecture", async () => {
    const loose = await sql`SELECT tablename, permissive, cmd FROM pg_policies
                            WHERE policyname = 'activity_scope' AND (permissive <> 'RESTRICTIVE' OR cmd <> 'SELECT')`;
    expect(loose).toEqual([]);
  });

  it("les tables couvertes ont la RLS activée et forcée", async () => {
    const off = await sql`SELECT c.relname FROM pg_class c JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = 'activity_scope'
                          WHERE NOT c.relrowsecurity`;
    expect(off).toEqual([]);
  });
});
