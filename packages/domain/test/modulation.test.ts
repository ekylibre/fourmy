import { describe, expect, it } from "vitest";
import { classifyZones, modulationRates, prescriptionTotal, quantileBreaks } from "../src/index.js";

describe("zonage intra-parcellaire (lot AD)", () => {
  it("bornes par quantiles : classes de même effectif", () => {
    expect(quantileBreaks([1, 2, 3, 4, 5, 6], 3)).toEqual([2 + 2 / 3, 4 + 1 / 3]);
  });

  it("classe un gradient en bandes, lisse un pixel isolé et comble les nuages", () => {
    const width = 9;
    const height = 6;
    const values: (number | null)[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values.push(0.2 + x * 0.07);
    values[2 * width + 1] = 0.9; // pixel aberrant dans la zone faible
    values[4 * width + 7] = null; // nuage dans la zone forte
    const g = classifyZones(values, width, height, 3);
    const row = (y: number) => [...g.zones.subarray(y * width, (y + 1) * width)];
    // Bandes ouest-est (les bornes tombent entre deux colonnes à un pixel près).
    expect(row(0)[0]).toBe(1);
    expect(row(0)[4]).toBe(2);
    expect(row(0)[8]).toBe(3);
    expect(row(0)).toEqual([...row(0)].sort());
    expect(row(2)[1]).toBe(1);
    expect(row(4)[7]).toBe(3);
    expect(g.validPixels).toBe(width * height - 1);
    expect(g.stats.map((s) => s.code)).toEqual([1, 2, 3]);
    expect(g.stats[0]!.mean).toBeLessThan(g.stats[1]!.mean);
    // Le pixel aberrant reste compté dans sa zone lissée (statistiques des mesures).
    expect(g.stats[0]!.max).toBeCloseTo(0.9, 5);
  });

  it("raster sans mesure : aucune zone", () => {
    const g = classifyZones([null, null, null, null], 2, 2, 3);
    expect(g.stats).toEqual([]);
    expect([...g.zones]).toEqual([0, 0, 0, 0]);
  });
});

describe("doses par zone", () => {
  const base = { zoneCount: 3, baseRate: 120, modulationPct: 25, minRate: 0, maxRate: 1000, unit: "kg_ha" as const };
  it("compenser, valoriser, uniforme", () => {
    expect(modulationRates({ ...base, strategy: "compensate" })).toEqual([150, 120, 90]);
    expect(modulationRates({ ...base, strategy: "boost" })).toEqual([90, 120, 150]);
    expect(modulationRates({ ...base, strategy: "uniform" })).toEqual([120, 120, 120]);
  });
  it("borne aux doses de la machine et arrondit au pas de l'unité", () => {
    expect(modulationRates({ ...base, strategy: "compensate", minRate: 100, maxRate: 140 })).toEqual([140, 120, 100]);
    expect(modulationRates({ ...base, zoneCount: 4, strategy: "boost", baseRate: 85_000, modulationPct: 10, maxRate: 200_000, unit: "seeds_ha" })).toEqual([77_000, 82_000, 88_000, 94_000]);
  });
  it("quantité totale", () => {
    expect(prescriptionTotal([{ rate: 100, areaM2: 20_000 }, { rate: 50, areaM2: 10_000 }])).toBe(250);
  });
});
