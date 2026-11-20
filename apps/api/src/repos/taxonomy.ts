import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@fourmy/db";

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/**
 * Taxonomie Lexicon (table `taxonomy`, parenté des espèces) : légumineuses.
 * Une espèce absente de la taxonomie (16 espèces du catalogue des variétés)
 * est jugée par son genre (`vicia_xxx` → `vicia`).
 */
const descendsFrom = (taxon: SQL, ancestor: string) => sql`EXISTS (WITH RECURSIVE l AS (
  SELECT reference_name, parent, 0 AS depth FROM taxonomy WHERE reference_name = ${taxon}
  UNION ALL SELECT x.reference_name, x.parent, l.depth + 1 FROM taxonomy x JOIN l ON x.reference_name = l.parent WHERE l.depth < 30)
  SELECT 1 FROM l WHERE reference_name = ${ancestor})`;

/** L'espèce (expression SQL) descend-elle des Fabacées ? */
export const legumeOf = (species: SQL) =>
  sql`(${descendsFrom(species, "fabaceae")} OR ${descendsFrom(sql`split_part(${species}, '_', 1)`, "fabaceae")})`;

/** Légumineuses parmi des espèces (taxons Lexicon). */
export async function legumeSpecies(tx: Tx, species: string[]): Promise<Set<string>> {
  const list = [...new Set(species.filter(Boolean))];
  if (!list.length) return new Set();
  const found = await rows<{ species: string }>(
    tx,
    sql`SELECT s AS species FROM jsonb_array_elements_text(${JSON.stringify(list)}::jsonb) AS s WHERE ${legumeOf(sql`s`)}`,
  );
  return new Set(found.map((r) => r.species));
}
