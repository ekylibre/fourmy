import type { RefSource } from "../source.js";
import { COPPER_EPHY } from "./copper-ephy.js";

/**
 * Cuivre (règle R21) : au plus 28 kg de cuivre métal par hectare sur 7 ans
 * (règlement 2021/1165 annexe I, composés de cuivre, renvoi au 540/2011).
 * Le texte ne fixe ni plafond annuel ni lissage (les 4 kg/an éventuels
 * viennent de l'AMM du produit).
 */
export const COPPER = {
  maxKgPerHa: 28,
  years: 7,
  /** Alerte « proche du plafond ». */
  warnShare: 0.8,
} as const;

export const COPPER_SOURCE: RefSource = {
  text: "Règlement d'exécution (UE) 2021/1165",
  version: "15/07/2021 (version d'origine, modifications ultérieures non lues)",
  at: "annexe I, sous-catégorie 4, composés de cuivre, p. 12",
};

/** Masse molaire du cuivre et des composés exprimés en composé dans E-Phy. */
const CU = 63.546;
/**
 * Composé → part de cuivre métal. Seuls les composés de formule unique sont
 * convertis ; la conversion est vérifiée sur les produits dont le nom donne
 * la teneur en cuivre (test). Sulfate de cuivre et sulfate tribasique (formes
 * hydratées variables) : non convertis, teneur à saisir.
 */
export const COPPER_COMPOUND_SHARE: Record<string, number> = {
  /** Cu(OH)₂, 97,561 g/mol. */
  "hydroxyde de cuivre": CU / 97.561,
  /** Cu₂Cl(OH)₃, 213,566 g/mol. */
  "oxychlorure de cuivre": (2 * CU) / 213.566,
};

/** Bouillie bordelaise exprimée en composé : la seule teneur publiée (733,4 g/kg) est celle des bouillies à 20 % de cuivre. */
const BORDEAUX_733 = { compound: 733.4, copper: 200 };

export interface CopperContent {
  /** Grammes de cuivre métal par kg de produit, ou par litre. */
  g: number;
  per: "kg" | "L";
}

/**
 * Teneur d'une substance E-Phy (« cuivre de l'hydroxyde de cuivre (Copper
 * compounds) 400.0 g/kg ») en cuivre métal ; `null` si elle n'est pas sûre.
 * « x % » est compris en masse (g/kg).
 */
export function copperOfSubstance(s: string): CopperContent | null {
  const m = /^(.*?)\s*\(Copper compounds\)\s*([\d.]+)\s*(g\/kg|g\/L|%)\s*$/i.exec(s.trim());
  if (!m) return null;
  const name = m[1]!.trim().toLowerCase();
  const value = Number(m[2]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const per: CopperContent["per"] = m[3]!.toLowerCase() === "g/l" ? "L" : "kg";
  const g = m[3] === "%" ? value * 10 : value;
  const round = (v: number) => Math.round(v * 10) / 10;
  if (name === "cuivre" || name.startsWith("cuivre de") || name.startsWith("cuivre du")) return { g: round(g), per };
  const share = COPPER_COMPOUND_SHARE[name];
  if (share) return { g: round(g * share), per };
  if (name === "bouillie bordelaise" && per === "kg" && g === BORDEAUX_733.compound) return { g: BORDEAUX_733.copper, per };
  return null;
}

/**
 * Cuivre métal d'un produit par n° d'AMM : `undefined` s'il n'est pas
 * cuprique, `null` si sa teneur n'est pas sûre (à saisir sur l'article).
 * Plusieurs composés : somme, dans la même unité.
 */
export function copperOfAmm(amm: string | null | undefined): CopperContent | null | undefined {
  if (!amm) return undefined;
  const subs = COPPER_EPHY[amm];
  if (!subs) return undefined;
  const parts = subs.map(copperOfSubstance);
  if (parts.some((p) => p === null)) return null;
  const per = parts[0]!.per;
  if (parts.some((p) => p!.per !== per)) return null;
  return { g: Math.round(parts.reduce((sum, p) => sum + p!.g, 0) * 10) / 10, per };
}
