/**
 * Unités des quantités d'intrants, telles qu'elles arrivent des interventions
 * (codes Ekylibre `kilogram`, `ton`, `liter`… ou unités d'articles saisies
 * « Tonne », « Kilogramme », « Litre »). Rien n'est deviné : une unité
 * inconnue rend null.
 */

export type Amount = { dim: "mass"; kg: number } | { dim: "volume"; l: number };

const MASS: Record<string, number> = {
  g: 0.001, gram: 0.001, gramme: 0.001,
  kg: 1, kilogram: 1, kilogramme: 1,
  q: 100, quintal: 100,
  t: 1000, ton: 1000, tonne: 1000,
};
const VOLUME: Record<string, number> = {
  l: 1, liter: 1, litre: 1,
  hl: 100, hectoliter: 100, hectolitre: 100,
  m3: 1000, "m³": 1000, cubic_meter: 1000, metre_cube: 1000,
};

/** Une unité de masse ou de volume en kg ou en L (null : unité inconnue ou sans dimension). */
export function unitScale(unit: string | null | undefined): { dim: "mass" | "volume"; factor: number } | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase().replace(/s$/, "");
  if (u in MASS) return { dim: "mass", factor: MASS[u]! };
  if (u in VOLUME) return { dim: "volume", factor: VOLUME[u]! };
  return null;
}

/** Sépare `kilogram_per_hectare` en unité et rapport à l'hectare. */
export function perHectare(unit: string): { unit: string; perHa: boolean } {
  const m = /^(.+)_per_hectare$/.exec(unit);
  return m ? { unit: m[1]!, perHa: true } : { unit, perHa: false };
}
