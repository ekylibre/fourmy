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
 * EWKT et les intervalles `tstzrange` en texte.
 *
 * Upsert : une fixture régénérée **remplace** la précédente (toutes les
 * colonnes), sans suppression préalable — deux suites de tests peuvent donc
 * charger la même fixture en parallèle. À exécuter avec un rôle propriétaire.
 *
 * Les lignes filles des interventions de la fixture (périodes, paramètres)
 * qui n'y figurent plus sont supprimées : sans cela, une fixture régénérée
 * avec d'autres identifiants laissait les anciennes périodes à côté des
 * nouvelles (périodes en double, constaté le 2026-11-08). Les interventions
 * qui ne viennent pas de la fixture (saisies des tests) ne sont pas touchées.
 */
/** Tables filles réécrites avec leur intervention (identifiants propres à la fixture). */
const CHILDREN_OF_INTERVENTIONS = ["intervention_periods", "intervention_parameters"] as const;

export async function loadFixture(sql: Sql, fixture: FixtureFile): Promise<void> {
  await sql.begin(async (tx) => {
    for (const [table, rows] of Object.entries(fixture.tables)) {
      if (!/^[a-z_]+$/.test(table)) throw new Error(`table invalide : ${table}`);
      if (rows.length === 0) continue;
      const cols = await tx<{ c: string }[]>`
        SELECT column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name <> 'id'
        ORDER BY ordinal_position`;
      const set = cols.map(({ c }) => `"${c}" = EXCLUDED."${c}"`).join(", ");
      await tx.unsafe(
        `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::text::json)
         ON CONFLICT (id) DO UPDATE SET ${set}`,
        [JSON.stringify(rows)],
      );
    }
    const interventionIds = (fixture.tables.interventions ?? []).map((r) => r.id as string);
    if (interventionIds.length) {
      for (const child of CHILDREN_OF_INTERVENTIONS) {
        const keep = (fixture.tables[child] ?? []).map((r) => r.id as string);
        await tx.unsafe(
          `DELETE FROM ${child} WHERE intervention_id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))`,
          [interventionIds, keep] as never[],
        );
      }
    }
  });
  // Statistiques à jour : sans elles, juste après un chargement massif, le
  // planificateur choisit des plans désastreux pour les vues sous RLS
  // (mesuré : > 5 s au lieu de quelques dizaines de ms).
  for (const table of Object.keys(fixture.tables)) {
    await sql.unsafe(`ANALYZE ${table}`);
  }
}
