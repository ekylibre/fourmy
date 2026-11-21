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

/** L'espèce (expression SQL), ou à défaut son genre, descend-elle du taxon ? */
const ofTaxon = (species: SQL, ancestor: string) =>
  sql`(${descendsFrom(species, ancestor)} OR ${descendsFrom(sql`split_part(${species}, '_', 1)`, ancestor)})`;

/** L'espèce (expression SQL) descend-elle des Fabacées ? */
export const legumeOf = (species: SQL) => ofTaxon(species, "fabaceae");

/**
 * Groupe d'une espèce de couvert (`CoverGroup` du domaine) : légumineuse,
 * crucifère, graminée (avoine et seigle, ray-grass, autre), phacélie.
 */
export const coverGroupOf = (species: SQL) => sql`CASE
  WHEN ${species} IS NULL THEN 'other'
  WHEN ${legumeOf(species)} THEN 'legume'
  WHEN ${ofTaxon(species, "brassicaceae")} THEN 'crucifer'
  WHEN split_part(${species}, '_', 1) IN ('avena', 'secale') THEN 'grass_oat_rye'
  WHEN split_part(${species}, '_', 1) = 'lolium' THEN 'grass_ryegrass'
  WHEN ${ofTaxon(species, "poaceae")} THEN 'grass_other'
  WHEN split_part(${species}, '_', 1) = 'phacelia' THEN 'phacelia'
  ELSE 'other' END`;

/**
 * Couvert à légumineuses (expression SQL sur un alias de `cover_crops`) : sa
 * famille, ou une légumineuse parmi les espèces semées (lot SE6, FR-SE-16).
 */
export const coverHasLegume = (cc: string) =>
  sql`(${sql.raw(cc)}.family LIKE '%legumineuses%' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(${sql.raw(cc)}.components, '[]'::jsonb)) x
    WHERE x->>'species' IS NOT NULL AND ${legumeOf(sql`(x->>'species')`)}))`;

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
