import type { RefSource } from "../source.js";

/**
 * Barèmes de la grille d'audit HVE niveau 3 V4 (grille v1.15, plan de
 * contrôle V4.4 de 2024), recopiés à la lettre (D6). Chaque fonction rend les
 * points d'un item ; les constats citent la cellule de la grille.
 */
export const HVE_GRID_SOURCE: RefSource = { text: "Grille d'audit HVE niveau 3 V4 et plan de contrôle V4.4 (2024)", version: "grille v1.15", at: "onglets Phyto, Fertilisation, Irrigation" };

/** Seuil de validation de chaque indicateur (≥ 10 points). */
export const HVE_INDICATOR_MIN = 10;

export type HveFamily = "field_crops" | "vine" | "orchard" | "vegetables" | "horticulture";
export const HVE_FAMILY_LABELS: Record<HveFamily, string> = {
  field_crops: "Grandes cultures et prairies temporaires",
  vine: "Vigne",
  orchard: "Arboriculture",
  vegetables: "Légumes, fruits hors arboriculture, PPAM",
  horticulture: "Horticulture et pépinière",
};

/**
 * 5.2 et 6.5 : part de la SAU (en %) → points. S ≤ 5 % : 0 ; puis 1 point par
 * tranche de 10 points (]5,15] = 1 … ]95,100] = 10). Grille!P55 :
 * min(roundup(max(S−5 %,0)/10 %),10).
 */
export function pointsBySlices(sharePercent: number): number {
  const s = Math.round(sharePercent * 1e6) / 1e6;
  return Math.min(Math.ceil(Math.max(s - 5, 0) / 10), 10);
}

/**
 * 5.3 : IFT d'un type (herbicides ou hors herbicides) → points selon le
 * plancher Pc et le plafond Pf, x = (Pf − Pc)/4. IFT > Pf : 0 ;
 * ]Pc+3x, Pf] : 1 ; ]Pc+2x, Pc+3x] : 2 ; ]Pc+x, Pc+2x] : 3 ; ]Pc, Pc+x] : 4 ;
 * ≤ Pc : 5. Arboriculture : mêmes classes, 0 / 0,6 / 1,2 / 1,8 / 2,4 / 3.
 * (PdC4 §5.3 p. 42-47 ; Grille!H109:R112.)
 */
export function iftPoints(ift: number, floor: number, ceiling: number, scale: "standard" | "orchard" = "standard"): number {
  const x = (ceiling - floor) / 4;
  const v = Math.round(ift * 1e6) / 1e6;
  const cls = v > ceiling ? 0 : v > floor + 3 * x ? 1 : v > floor + 2 * x ? 2 : v > floor + x ? 3 : v > floor ? 4 : 5;
  return scale === "orchard" ? Math.round(cls * 0.6 * 10) / 10 : cls;
}

/** 5.3 : maximum par famille (herbicides + hors herbicides). */
export const IFT_MAX: Partial<Record<HveFamily, number>> = { field_crops: 10, vine: 10, orchard: 6 };

/** 5.1 : 1 point sans herbicide CMR2, 1 point sans autre produit CMR2 ; CMR1 invalide l'indicateur. */
export const CMR_MAX = 2;

/**
 * 5.8 : diversité variétale. Vigne : clones 1 : 0, 2 : 1, ≥ 3 : 2 (≥ 3 cépages
 * valent 2). Autres : par espèce, 2 variétés = 1, ≥ 3 = 2, plafond 6 ;
 * × part de SAU de la famille. (PdC4 §5.8 ; Grille!L275:L299.)
 */
export function vineDiversityPoints(clonesOrVarieties: number): number {
  return clonesOrVarieties >= 3 ? 2 : clonesOrVarieties === 2 ? 1 : 0;
}
export function speciesDiversityPoints(varietiesBySpecies: number[]): number {
  const n2 = varietiesBySpecies.filter((n) => n === 2).length;
  const n3 = varietiesBySpecies.filter((n) => n >= 3).length;
  return Math.min(n2 + 2 * n3, 6);
}

/**
 * 6.1 : bilan azoté B (kg N/ha de SAU) → points. Bilan apparent d'une OTEX
 * herbivore : B > 90 : 0 ; ]70,90] : 2 ; ]50,70] : 4 ; ]30,50] : 6 ; ≤ 30 : 8.
 * Tous les autres cas (dont la BGA) : B > 50 : 0 ; ]40,50] : 2 ; ]30,40] : 5 ;
 * ]20,30] : 7 ; ≤ 20 : 8. (PdC4 §6.1 ; Grille!AD55, AF55.)
 */
export function nitrogenBalancePoints(b: number, apparentHerbivore = false): number {
  const v = Math.round(b * 1e6) / 1e6;
  if (apparentHerbivore) return v > 90 ? 0 : v > 70 ? 2 : v > 50 ? 4 : v > 30 ? 6 : 8;
  return v > 50 ? 0 : v > 40 ? 2 : v > 30 ? 5 : v > 20 ? 7 : 8;
}

/** 6.3 : part de l'azote organique (%) : < 25 : 0 ; [25,35[ : 1 ; [35,45[ : 2 ; [45,55[ : 3 ; ≥ 55 : 4. */
export function organicNitrogenPoints(sharePercent: number): number {
  const s = Math.round(sharePercent * 1e6) / 1e6;
  return s < 25 ? 0 : s < 35 ? 1 : s < 45 ? 2 : s < 55 ? 3 : 4;
}

/** 6.6 : part de légumineuses (%) : < 5 : 0 ; [5,10[ : 2 ; [10,15[ : 3 ; ≥ 15 : 4. */
export function legumePoints(sharePercent: number): number {
  const s = Math.round(sharePercent * 1e6) / 1e6;
  return s < 5 ? 0 : s < 10 ? 2 : s < 15 ? 3 : 4;
}

/** 6.1 et 6.4 : correction des cultures mineures à partir de 5 % de la SAU. */
export const MINOR_CROPS_THRESHOLD = 5;

/** 7.1 : part des données d'irrigation manquantes R (%) : < 10 : 6 ; [10,20[ : 4 ; [20,30[ : 2 ; ≥ 30 : 0. (Grille!M51.) */
export function irrigationRecordPoints(missingPercent: number): number {
  const r = Math.round(missingPercent * 1e6) / 1e6;
  return r < 10 ? 6 : r < 20 ? 4 : r < 30 ? 2 : 0;
}

/**
 * 7.6 : part des prélèvements faits en étiage (juin, juillet, août) dans le
 * milieu (%) : ≥ 90 : 0 ; [80,90[ : 1 ; [60,80[ : 2 ; [40,60[ : 3 ; [20,40[ : 4 ;
 * < 20 : 5. (PdC4 §7.6 ; Grille!AC190.)
 */
export function lowWaterPoints(sharePercent: number): number {
  const s = Math.round(sharePercent * 1e6) / 1e6;
  return s >= 90 ? 0 : s >= 80 ? 1 : s >= 60 ? 2 : s >= 40 ? 3 : s >= 20 ? 4 : 5;
}
