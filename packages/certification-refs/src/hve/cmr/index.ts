import type { RefSource } from "../../source.js";
import { CMR_2024_10_29, CMR_2024_10_29_SOURCE } from "./2024-10-29.js";
import { CMR_2025_10_21, CMR_2025_10_21_SOURCE } from "./2025-10-21.js";
import { CMR_2026_09_04, CMR_2026_09_04_SOURCE } from "./2026-09-04.js";

/** Versions de la liste CMR, de la plus ancienne à la plus récente. */
const VERSIONS: { date: string; table: Record<string, string>; source: RefSource }[] = [
  { date: "2024-10-29", table: CMR_2024_10_29, source: CMR_2024_10_29_SOURCE },
  { date: "2025-10-21", table: CMR_2025_10_21, source: CMR_2025_10_21_SOURCE },
  { date: "2026-09-04", table: CMR_2026_09_04, source: CMR_2026_09_04_SOURCE },
];

/**
 * Version de la liste en vigueur à une date : la plus récente publiée à cette
 * date ; avant la première, la première (aucune liste antérieure n'est
 * disponible).
 */
export function cmrListAt(day: string) {
  return [...VERSIONS].reverse().find((v) => v.date <= day) ?? VERSIONS[0]!;
}

export interface CmrClass {
  cmr: 1 | 2;
  herbicide: boolean;
  /** Version de la liste appliquée. */
  list: string;
  source: RefSource;
}

/** Classement CMR d'un produit (n° d'autorisation, PCP compris) à la date du traitement ; null : non classé. */
export function cmrClassOf(authorization: string | null | undefined, day: string): CmrClass | null {
  if (!authorization) return null;
  const v = cmrListAt(day);
  const c = v.table[authorization.trim()];
  if (!c) return null;
  return { cmr: c.startsWith("1") ? 1 : 2, herbicide: c.endsWith("h"), list: v.date, source: v.source };
}

export const CMR_VERSIONS = VERSIONS.map((v) => v.date);
