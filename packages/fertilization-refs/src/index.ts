/**
 * @fourmy/fertilization-refs — référentiels de la fertilisation azotée
 * (docs/fertilisation-design.md §5) : référentiel régional Nouvelle-Aquitaine
 * du 29/07/2025, calendrier d'épandage du PAN 7, zonage Adour-Garonne du
 * 24/08/2026, besoins des variétés de blé. Données recopiées des textes et
 * sourcées table par table ; aucune n'est modifiée par le code.
 */
import { adourGaronneVulnerableZones2026 } from "./zoning/adour-garonne-2026.js";
import { communeZones } from "./calendar/pan7.js";

export * from "./types.js";
export * from "./na-2025/bilan-cau.js";
export * from "./na-2025/methods.js";
export * from "./na-2025/soils.js";
export * from "./na-2025/pro.js";
export * from "./na-2025/rapeseed.js";
export * from "./na-2025/sunflower-pivot.js";
export * from "./na-2025/splitting.js";
export * from "./na-2025/ceilings.js";
export * from "./na-2025/yields.js";
export * from "./na-2025/rsh.js";
export * from "./calendar/pan7.js";
export * from "./zoning/adour-garonne-2026.js";
export * from "./varieties/wheat-2026.js";
export * from "./aplsh/comifer-2024.js";

export const ZONING_REFERENTIAL = "Zones vulnérables Adour-Garonne, arrêté du 24/08/2026";

/** Départements entièrement dans le bassin Adour-Garonne : une commune absente de l'annexe y est hors zone vulnérable. */
const FULLY_IN_BASIN = new Set(["24", "31", "32", "33", "40", "47", "64", "65", "82"]);

// Index construits au premier appel : un module qui n'importe que des libellés n'embarque pas les tables.
let indexes: { byInsee: Map<string, (typeof adourGaronneVulnerableZones2026.rows)[number]>; zones: Map<string, (typeof communeZones.rows)[number]> } | null = null;
const index = () =>
  (indexes ??= {
    byInsee: new Map(adourGaronneVulnerableZones2026.rows.map((c) => [c.insee, c])),
    zones: new Map(communeZones.rows.map((c) => [c.insee, c])),
  });

/**
 * Zonage nitrates d'une commune : classée en totalité, en partie (à confirmer
 * parcelle par parcelle), hors zone (département entièrement dans le bassin
 * Adour-Garonne et commune absente de l'annexe) ou inconnu (autre bassin).
 * Zones du calendrier (ouest, sud, montagne, ZAR) d'après le jeu de données
 * du PAN 7, pour la Nouvelle-Aquitaine.
 */
export function nitrateZoneOfCommune(insee: string): { status: "in" | "partial" | "out" | "unknown"; zones: string[]; note: string | null } {
  const c = index().byInsee.get(insee);
  const z = index().zones.get(insee);
  const zones = z ? (["ouest", "est", "sud", "montagne", "zar"] as const).filter((k) => z[k]) : [];
  if (c?.status === "total") return { status: "in", zones, note: null };
  if (c?.status === "partial") return { status: "partial", zones, note: c.detail ? `Parties classées : ${c.detail}` : null };
  if (FULLY_IN_BASIN.has(insee.slice(0, 2))) return { status: "out", zones, note: null };
  return { status: "unknown", zones, note: "Commune absente de l'annexe Adour-Garonne : elle peut relever d'un autre bassin, zonage à confirmer." };
}
