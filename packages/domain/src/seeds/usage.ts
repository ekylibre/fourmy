import type { SeedDensityRange, SeedUsageFigures } from "@fourmy/contracts";

/**
 * Utilisation des semences sur une campagne (lot SE7, FR-SE-24 à 27) : un
 * intrant semence d'une intervention, et son résumé. Les densités sont des
 * moyennes pondérées par la surface ; l'écart va de la plus faible à la plus
 * forte. Une dose non convertible est comptée, sans bloquer.
 */
export interface SeedUsageLine {
  areaHa: number | null;
  /** Quantité dans l'unité du stock (mouvement, sinon conversion) ; null si non convertible. */
  stock: number | null;
  kg: number | null;
  grains: number | null;
  kgPerHa: number | null;
  grainsPerM2: number | null;
  estimated: boolean;
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function range(lines: readonly SeedUsageLine[], of: (l: SeedUsageLine) => number | null, digits: number): SeedDensityRange | null {
  const ok = lines.filter((l) => of(l) !== null);
  if (!ok.length) return null;
  const values = ok.map((l) => of(l)!);
  const weights = ok.map((l) => l.areaHa ?? 0);
  const w = weights.reduce((s, x) => s + x, 0);
  const mean = w > 0 ? values.reduce((s, v, i) => s + v * weights[i]!, 0) / w : values.reduce((s, v) => s + v, 0) / values.length;
  return { mean: round(mean, digits), min: round(Math.min(...values), digits), max: round(Math.max(...values), digits) };
}

const sumOf = (lines: readonly SeedUsageLine[], of: (l: SeedUsageLine) => number | null, digits: number) => {
  const ok = lines.map(of).filter((v): v is number => v !== null);
  return ok.length ? round(ok.reduce((s, v) => s + v, 0), digits) : null;
};

export function summarizeSeedUsage(lines: readonly SeedUsageLine[], withStock = true): SeedUsageFigures {
  return {
    interventions: lines.length,
    areaHa: round(lines.reduce((s, l) => s + (l.areaHa ?? 0), 0), 2),
    stockQuantity: withStock ? sumOf(lines, (l) => l.stock, 3) : null,
    kg: sumOf(lines, (l) => l.kg, 1),
    grains: sumOf(lines, (l) => l.grains, 0),
    kgPerHa: range(lines, (l) => l.kgPerHa, 1),
    grainsPerM2: range(lines, (l) => l.grainsPerM2, 1),
    estimated: lines.some((l) => l.estimated),
    unconvertible: lines.filter((l) => l.stock === null && l.kg === null && l.grains === null).length,
  };
}
