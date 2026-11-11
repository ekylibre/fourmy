import type { FertilizerComposition } from "@fourmy/contracts";
import { aplshPercent, type AplshZone } from "@fourmy/fertilization-refs";

/**
 * Azote potentiellement libéré jusqu'en sortie d'hiver (lot AK, FR-FERT-28) :
 * PAN 7, annexe I, I (tableau des périodes) ; référentiel régional NA,
 * article 13 ; références du COMIFER (2024). Plafond de 70 kg d'APLSH par
 * hectare sur un couvert d'interculture (apports depuis la récolte du
 * précédent) et sur une prairie de plus de 6 mois (apports depuis le 1er septembre).
 */

export const APLSH_CEILING = 70;

export type AplshOfApplication = { kgNHa: number; percent: number; source: string } | { missing: string };

/** APLSH d'un apport : tout l'azote d'un engrais minéral, la part du COMIFER pour un organique. */
export function aplshOfApplication(c: FertilizerComposition, date: string, nTotalKgHa: number, zone: AplshZone | null): AplshOfApplication {
  if (c.nitrateType === "III" || c.nMineralShare === 1) return { kgNHa: nTotalKgHa, percent: 100, source: "engrais minéral : tout l'azote" };
  if (!zone) return { missing: "zone climatique des références APLSH (paramètres de la ferme)" };
  const p = aplshPercent({ zone, date, productKey: c.aplshProduct ?? null, cN: c.cN ?? null, mineralPct: c.nMineralShare != null ? c.nMineralShare * 100 : null });
  if (!p) return { missing: "dénomination COMIFER ou C/N du produit (Stocks → Fertilisants)" };
  return { kgNHa: Math.round((nTotalKgHa * p.percent) / 10) / 10, percent: p.percent, source: p.source };
}

export interface AplshSituation {
  kind: "cover" | "grassland";
  /** Début du cumul : récolte du précédent (couvert) ou 1er septembre (prairie). */
  from: string;
  /** Les apports de type III comptent (couvert exporté, prairie). */
  countsMineral: boolean;
}

/**
 * Cumul de l'APLSH sur la période et comparaison au plafond. Un apport dont
 * l'APLSH est inconnue rend le cumul incomplet : il est nommé.
 */
export function aplshTotal(
  situation: AplshSituation,
  applications: { date: string; product: string; type: string | null; aplsh: AplshOfApplication }[],
): { kgNHa: number; ceiling: number; over: boolean; missing: string[]; counted: number } {
  let kg = 0;
  let counted = 0;
  const missing: string[] = [];
  for (const a of applications) {
    if (a.date < situation.from) continue;
    if (a.type === "III" && !situation.countsMineral) continue;
    if ("missing" in a.aplsh) missing.push(`${a.product} : ${a.aplsh.missing}`);
    else {
      kg += a.aplsh.kgNHa;
      counted++;
    }
  }
  const total = Math.round(kg * 10) / 10;
  return { kgNHa: total, ceiling: APLSH_CEILING, over: total > APLSH_CEILING, missing: [...new Set(missing)], counted };
}
