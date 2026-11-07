import type { Sql } from "postgres";

/** Format des fixtures produites par @fourmy/migrator-ekylibre (exportFixture). */
export interface FixtureFile {
  meta: {
    label: string;
    description: string;
    exportedAt: string;
    expected: { counts: Record<string, number>; phytoRowsByYear: Record<string, number> };
  };
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Charge une fixture dans la base, table par table dans l'ordre du fichier
 * (dépendances d'abord). `json_populate_recordset` relit les géométries en
 * EWKT et les intervalles `tstzrange` en texte. Idempotent (ON CONFLICT DO
 * NOTHING). À exécuter avec un rôle propriétaire (tests, seeds de dev).
 */
export async function loadFixture(sql: Sql, fixture: FixtureFile): Promise<void> {
  await sql.begin(async (tx) => {
    for (const [table, rows] of Object.entries(fixture.tables)) {
      if (!/^[a-z_]+$/.test(table)) throw new Error(`table invalide : ${table}`);
      if (rows.length === 0) continue;
      await tx.unsafe(
        `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::text::json)
         ON CONFLICT DO NOTHING`,
        [JSON.stringify(rows)],
      );
    }
  });
  // Statistiques à jour : sans elles, juste après un chargement massif, le
  // planificateur choisit des plans désastreux pour les vues sous RLS
  // (mesuré : > 5 s au lieu de quelques dizaines de ms).
  for (const table of Object.keys(fixture.tables)) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
}
