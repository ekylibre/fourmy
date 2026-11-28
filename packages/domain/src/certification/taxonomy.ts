/**
 * Espèces comparées pour la mixité AB (R7, issue #166,
 * claudedocs/conception_ab_mixite.md §1). Une culture porte sa lignée : son
 * taxon puis ses parents jusqu'au genre (rangs fins seulement), calculée par
 * la requête qui lit les productions. `null` : culture générique (« plant »,
 * une famille, une valeur hors taxonomie, aucune), qui ne se compare à rien.
 */

/** Lignée retenue : celle calculée, sinon l'espèce seule (supposée précise), sinon aucune. */
export function mixityLineage(species: string | null | undefined, lineage: string[] | null | undefined): string[] | null {
  if (lineage !== undefined) return lineage && lineage.length ? lineage : null;
  return species ? [species] : null;
}

/**
 * Même espèce pour la mixité (décision M2) : l'une des cultures est l'autre ou
 * l'un de ses ancêtres, jusqu'au genre. `avena` et `avena_sativa` : oui ;
 * `avena_sativa` et `avena_strigosa` : non (seul le genre est commun).
 */
export function sameSpeciesForMixity(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (!a?.length || !b?.length) return false;
  return a.includes(b[0]!) || b.includes(a[0]!);
}
