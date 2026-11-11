import { PRESCRIPTION_UNIT_STEP, type ModulationStrategy, type PrescriptionUnit } from "@fourmy/contracts";

/**
 * Cartes de modulation (lot AD, docs/modulation.md) : classes d'indice par
 * quantiles (zones de même surface), lissage par filtre majoritaire, pixels
 * nuageux rattachés à la zone voisine la plus proche, doses par zone.
 */

/** Seuils de classes par quantiles : n − 1 bornes croissantes. */
export function quantileBreaks(values: number[], n: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let k = 1; k < n; k++) {
    const pos = (sorted.length - 1) * (k / n);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    breaks.push(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
  }
  return breaks;
}

const classOf = (v: number, breaks: number[]) => {
  let k = 0;
  while (k < breaks.length && v > breaks[k]!) k++;
  return k + 1;
};

export interface ZoneGrid {
  width: number;
  height: number;
  /** Zone de chaque pixel (1..n), ligne par ligne depuis le nord-ouest ; 0 si aucune valeur dans tout le raster. */
  zones: Uint8Array;
  /** Statistiques des pixels mesurés (non nuageux) de chaque zone, de la zone 1 à n. */
  stats: { code: number; pixels: number; mean: number; min: number; max: number }[];
  validPixels: number;
}

/**
 * Zone de chaque pixel d'un raster d'indice (null : hors parcelle ou nuage).
 * 1. Classes par quantiles des pixels mesurés. 2. `smoothPasses` passes de
 * filtre majoritaire 3 × 3 sur les pixels mesurés (un pixel isolé rejoint la
 * zone qui l'entoure). 3. Pixels sans mesure : zone du pixel mesuré le plus
 * proche (parcours en largeur), pour couvrir tout le rectangle ; la découpe
 * par le contour de la parcelle se fait ensuite.
 */
export function classifyZones(values: (number | null)[], width: number, height: number, n: number, smoothPasses = 2): ZoneGrid {
  if (values.length !== width * height) throw new Error("Raster de taille incohérente.");
  const measured = values.filter((v): v is number => v !== null);
  const zones = new Uint8Array(width * height);
  if (measured.length === 0) return { width, height, zones, stats: [], validPixels: 0 };
  const breaks = quantileBreaks(measured, n);
  values.forEach((v, i) => {
    if (v !== null) zones[i] = classOf(v, breaks);
  });

  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = zones.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!zones[i]) continue;
        const counts = new Array<number>(n + 1).fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const z = zones[yy * width + xx]!;
            if (z) counts[z]!++;
          }
        }
        let best = zones[i]!;
        for (let z = 1; z <= n; z++) if (counts[z]! > counts[best]!) best = z;
        next[i] = best;
      }
    }
    zones.set(next);
  }

  const stats = Array.from({ length: n }, (_, k) => ({ code: k + 1, pixels: 0, sum: 0, min: Infinity, max: -Infinity }));
  values.forEach((v, i) => {
    if (v === null) return;
    const s = stats[zones[i]! - 1]!;
    s.pixels++;
    s.sum += v;
    s.min = Math.min(s.min, v);
    s.max = Math.max(s.max, v);
  });

  // Pixels sans mesure : zone mesurée la plus proche.
  const queue: number[] = [];
  zones.forEach((z, i) => z && queue.push(i));
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const j = yy * width + xx;
      if (zones[j]) continue;
      zones[j] = zones[i]!;
      queue.push(j);
    }
  }

  return {
    width,
    height,
    zones,
    validPixels: measured.length,
    stats: stats
      .filter((s) => s.pixels > 0)
      .map((s) => ({ code: s.code, pixels: s.pixels, mean: s.sum / s.pixels, min: s.min, max: s.max })),
  };
}

/**
 * Dose de chaque zone (de la zone 1, la plus faible, à la zone n) : la dose
 * de base au milieu, ± `modulationPct` aux extrémités, linéaire entre les
 * deux ; bornée par les doses minimale et maximale de la machine, arrondie au
 * pas de l'unité. Zones de même surface : la dose moyenne reste la dose de base
 * (hors bornes et arrondis).
 */
export function modulationRates(p: {
  zoneCount: number;
  strategy: ModulationStrategy;
  baseRate: number;
  modulationPct: number;
  minRate: number;
  maxRate: number;
  unit: PrescriptionUnit;
}): number[] {
  const step = PRESCRIPTION_UNIT_STEP[p.unit];
  const sign = p.strategy === "compensate" ? -1 : p.strategy === "boost" ? 1 : 0;
  return Array.from({ length: p.zoneCount }, (_, k) => {
    const pos = p.zoneCount > 1 ? (2 * k) / (p.zoneCount - 1) - 1 : 0; // −1 (zone 1) … +1 (zone n)
    const raw = p.baseRate * (1 + (sign * pos * p.modulationPct) / 100);
    const bounded = Math.min(p.maxRate, Math.max(p.minRate, raw));
    return Math.round(bounded / step) * step;
  });
}

/** Quantité totale (kg, L ou grains) : dose × surface. */
export const prescriptionTotal = (zones: { rate: number; areaM2: number }[]) => zones.reduce((s, z) => s + (z.rate * z.areaM2) / 10_000, 0);
