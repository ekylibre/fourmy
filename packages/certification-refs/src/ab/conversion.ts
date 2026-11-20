import type { RefSource } from "../source.js";

/**
 * Durées de conversion à l'Agriculture biologique, par parcelle
 * (claudedocs/conception_controle_hve_ab.md §5.2, décision D8 : le statut est
 * déduit, jamais saisi).
 *
 * - C1 : végétaux récoltés dans les 12 premiers mois après le début de la
 *   conversion (vendus en conventionnel) ;
 * - C2 : récoltés à partir du 13e mois (vendables « en conversion vers l'AB ») ;
 * - AB : cultures annuelles et semi-pérennes semées ou repiquées au plus tôt
 *   24 mois après le début ; cultures pérennes récoltées au moins 36 mois
 *   après le début.
 */
export const CONVERSION = {
  /** Mois avant lesquels une récolte reste C1. */
  c1Months: 12,
  /** Annuelles et semi-pérennes (fraise, artichaut, asperge, herbe, safran) : semis au moins 24 mois après le début. */
  annualSowingMonths: 24,
  /** Pérennes (verger, vigne, houblon, lavande) : récolte au moins 36 mois après le début. */
  perennialHarvestMonths: 36,
} as const;

export const CONVERSION_SOURCES: RefSource[] = [
  { text: "Règlement (UE) 2018/848", version: "30/05/2018", at: "annexe II partie I point 1.7.1, p. 57" },
  { text: "Guide de lecture INAO", version: "26/03/2026", at: "lignes 96 à 99 et 125" },
];

/** Cycle d'une production (colonne productions.cycle, ou déduit de Lexicon). */
export type CropCycle = "annual" | "semi_perennial" | "perennial";

/**
 * Cycle déduit de Lexicon (`lexicon_productions.life_years` et `usage`) :
 * - au plus 1 an → annuelle ;
 * - prairies, pâturages et fourrages pérennes (usage `meadow` ou `fodder`) →
 *   semi-pérenne : 2 ans de conversion (annexe II partie I 1.7.1 : « deux ans
 *   avant leur utilisation comme aliment »), même si Lexicon leur donne 5 à
 *   10 ans de vie (prairie, luzerne, trèfle) ;
 * - moins de 5 ans → semi-pérenne (fraise, artichaut, asperge) ;
 * - sinon pérenne (vigne, verger, houblon) : 3 ans.
 * Les seuils de durée sont un choix de Fourmy (le texte nomme des exemples) :
 * la colonne `productions.cycle` corrige au besoin.
 */
export function cycleFromLexicon(lifeYears: number | null | undefined, usage?: string | null): CropCycle {
  if (lifeYears === null || lifeYears === undefined || lifeYears <= 1) return "annual";
  if (usage === "meadow" || usage === "fodder") return "semi_perennial";
  return lifeYears < 5 ? "semi_perennial" : "perennial";
}
