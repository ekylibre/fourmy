import type { CoverFamilyKey } from "@fourmy/contracts";

/**
 * Mélanges de semences (lot SE6, FR-SE-13 à 16, S7) : la dose de chaque
 * espèce se saisit en kg/ha au semis ; la dose du mélange en est la somme.
 * Aucune proportion n'est figée sur l'article.
 */

/** Écart toléré entre la quantité saisie et la somme des doses (kg/ha). */
export const MIXTURE_TOLERANCE_KG = 0.01;

/** Somme des doses d'un mélange, arrondie au centième (8 + 4 + 2 + 1 = 15 kg/ha). */
export function mixtureTotal(doses: readonly { kgHa: number }[]): number {
  return Math.round(doses.reduce((s, d) => s + d.kgHa, 0) * 100) / 100;
}

/** La quantité saisie (kg/ha) est-elle la somme des doses, à 0,01 près ? */
export function mixtureMatches(quantityKgHa: number, doses: readonly { kgHa: number }[]): boolean {
  return Math.abs(quantityKgHa - mixtureTotal(doses)) <= MIXTURE_TOLERANCE_KG + 1e-9;
}

/** Densité d'une espèce en grains/m² d'après sa dose (kg/ha) et son PMG (g) : kg/ha × 100 / PMG. */
export function grainsPerM2(kgHa: number, tgwG: number | null | undefined): number | null {
  return tgwG && tgwG > 0 ? (kgHa * 100) / tgwG : null;
}

/** Groupe botanique d'une espèce semée en couvert, d'après la taxonomie. */
export type CoverGroup = "legume" | "crucifer" | "grass_oat_rye" | "grass_ryegrass" | "grass_other" | "phacelia" | "other";

/**
 * Famille du couvert (cahier de fertilisation, MrCi) déduite des groupes de
 * ses espèces. Rien n'est deviné quand le mélange ne rentre dans aucune
 * famille du référentiel (crucifères et graminées sans légumineuse…) : null,
 * le responsable choisit.
 */
export function coverFamilyOf(groups: readonly CoverGroup[]): CoverFamilyKey | null {
  const set = new Set(groups);
  if (!set.size || set.has("other")) return null;
  const legume = set.has("legume");
  set.delete("legume");
  const grass = [...set].filter((g) => g.startsWith("grass_"));
  if (!set.size) return legume ? "legumineuses" : null;
  if (legume) {
    if (set.size === 1 && set.has("crucifer")) return "melange_cruciferes_legumineuses";
    if (grass.length === set.size) return "melange_graminees_legumineuses";
    return null;
  }
  if (set.size > 1) return null;
  const only = [...set][0]!;
  if (only === "crucifer") return "cruciferes";
  if (only === "phacelia") return "hydrophyllacees";
  if (only === "grass_oat_rye") return "graminees_seigle_avoine";
  if (only === "grass_ryegrass") return "graminees_ray_grass";
  return null;
}
