import type { TgwOrigin } from "@fourmy/contracts";

/**
 * PMG retenu pour un semis (S5, S6) : celui du lot, sinon celui de l'article,
 * sinon le repère de l'espèce, alors « estimé ». Jamais de valeur par défaut :
 * sans rien de tout cela, null.
 */
export interface TgwSource {
  tgwG: number | null;
  origin: TgwOrigin | null;
}

/** Repère de PMG d'une espèce (certification-refs/agronomy/thousand-grain-weight). */
export interface TgwReference {
  typicalG: number;
  minG?: number | null;
  maxG?: number | null;
}

export interface ResolvedTgw {
  tgwG: number;
  origin: TgwOrigin;
  from: "lot" | "article" | "reference";
  estimated: boolean;
}

export function resolveTgw(input: { lot?: TgwSource | null; article?: TgwSource | null; reference?: TgwReference | null }): ResolvedTgw | null {
  const { lot, article, reference } = input;
  if (lot?.tgwG && lot.tgwG > 0) {
    const origin = lot.origin ?? "label";
    return { tgwG: lot.tgwG, origin, from: "lot", estimated: origin === "reference" };
  }
  if (article?.tgwG && article.tgwG > 0) {
    const origin = article.origin ?? "label";
    return { tgwG: article.tgwG, origin, from: "article", estimated: origin === "reference" };
  }
  if (reference && reference.typicalG > 0) return { tgwG: reference.typicalG, origin: "reference", from: "reference", estimated: true };
  return null;
}

/** Écart au-delà duquel un PMG saisi est signalé (FR-SE-7) : 30 % du repère. */
export const TGW_WARNING_SHARE = 0.3;

/** Vrai si le PMG saisi s'écarte du repère de l'espèce de plus de 30 % : erreur de saisie probable. */
export function tgwWarning(tgwG: number | null | undefined, reference: TgwReference | null | undefined): boolean {
  if (!tgwG || !reference || reference.typicalG <= 0) return false;
  return Math.abs(tgwG - reference.typicalG) / reference.typicalG > TGW_WARNING_SHARE;
}
