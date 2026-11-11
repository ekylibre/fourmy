import { describe, expect, it } from "vitest";
import { canopyAt, cropProfile, localFrame, rowPieces, smoothDaily, visualSpacing } from "../src/index.js";

const rect = (w: number, h: number): [number, number][] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
  [0, 0],
];

describe("végétation 3D : rangs", () => {
  it("rangs nord-sud dans un rectangle de 10 × 30 m, inter-rang 2 m, bouts raccourcis", () => {
    const pieces = rowPieces([rect(10, 30)], { bearingDeg: 0, spacingM: 2, insetM: 0.5, maxPieceM: 100 })!;
    expect(pieces).toHaveLength(5);
    expect(pieces.map((p) => Math.round(p.x * 10) / 10)).toEqual([1, 3, 5, 7, 9]);
    for (const p of pieces) {
      expect(p.length).toBeCloseTo(29, 6);
      expect(p.y).toBeCloseTo(15, 6);
    }
  });

  it("tronçonne pour suivre le relief et contourne un trou", () => {
    const hole: [number, number][] = [
      [4, 10],
      [6, 10],
      [6, 20],
      [4, 20],
      [4, 10],
    ];
    const pieces = rowPieces([rect(10, 30), hole], { bearingDeg: 0, spacingM: 2, insetM: 0, maxPieceM: 6 })!;
    const middle = pieces.filter((p) => Math.abs(p.x - 5) < 1e-6);
    // Rang du milieu : 0 → 10 et 20 → 30, chacun en 2 tronçons de 5 m.
    expect(middle.map((p) => [Math.round(p.y * 10) / 10, p.length])).toEqual([
      [2.5, 5],
      [7.5, 5],
      [22.5, 5],
      [27.5, 5],
    ]);
    expect(pieces.every((p) => p.length <= 6)).toBe(true);
  });

  it("orientation est-ouest (90°) et plafond d'instances", () => {
    const ew = rowPieces([rect(30, 10)], { bearingDeg: 90, spacingM: 2, insetM: 0, maxPieceM: 100 })!;
    expect(ew).toHaveLength(5);
    expect(ew.every((p) => Math.abs(p.x - 15) < 1e-6 && Math.abs(p.length - 30) < 1e-6)).toBe(true);
    expect(rowPieces([rect(1000, 1000)], { bearingDeg: 0, spacingM: 0.5, maxPieceM: 1, limit: 1000 })).toBeNull();
  });

  it("repère local : aller-retour en mètres", () => {
    const f = localFrame(-0.19, 43.38);
    const [x, y] = f.toLocal(-0.18, 43.39);
    expect(x).toBeGreaterThan(800);
    expect(y).toBeGreaterThan(1100);
    const [lon, lat] = f.toLonLat(x, y);
    expect(lon).toBeCloseTo(-0.18, 9);
    expect(lat).toBeCloseTo(43.39, 9);
  });

  it("profils : espèce, cépage, inter-rang dessiné", () => {
    expect(cropProfile("zea_mays", "field_crop").maxHeightM).toBe(2.5);
    expect(cropProfile("CABERNET-SAUVIGNON N", "vine").spacingM).toBe(2);
    expect(visualSpacing(cropProfile("x_triticosecale", "field_crop"), 0.15, "field_crop")).toBe(1);
    expect(visualSpacing(cropProfile(null, "vine"), 2.2, "vine")).toBe(2.2);
  });
});

describe("végétation 3D : état du couvert", () => {
  // Maïs de Pierre (Monassut, 2026), mesures exploitables arrondies.
  const maize = smoothDaily(
    [
      ["05-21", 0.21], ["06-03", 0.48], ["06-13", 0.74], ["06-26", 0.79], ["07-11", 0.77], ["07-23", 0.58],
      ["07-28", 0.56], ["08-07", 0.44], ["08-19", 0.27], ["08-29", 0.19], ["09-14", 0.19],
    ].map(([d, v]) => ({ date: `2026-${d}`, value: v as number })),
    { from: "2026-01-01", to: "2026-12-31" },
  );
  const base = { nature: "field_crop", species: "zea_mays", smoothed: maize, removals: [] as string[] };

  it("croissance : la hauteur suit le NDVI", () => {
    const june = canopyAt({ ...base, day: "2026-06-05" });
    const july = canopyAt({ ...base, day: "2026-06-28" });
    expect(june.phase).toBe("growing");
    expect(july.phase).toBe("growing");
    expect(june.heightM).toBeLessThan(july.heightM);
    expect(july.heightM).toBeGreaterThan(2);
    expect(july.observedOn).toBe("2026-06-28");
  });

  it("sénescence : le maïs qui sèche reste debout, feuillage clairsemé", () => {
    const aug = canopyAt({ ...base, day: "2026-08-10" });
    expect(aug.phase).toBe("senescent");
    expect(aug.heightM).toBeGreaterThan(2);
    expect(aug.density).toBeLessThan(0.7);
  });

  it("récolte saisie : chaumes, même avant le passage suivant du satellite", () => {
    expect(canopyAt({ ...base, day: "2026-08-15", removals: ["2026-08-14"] })).toMatchObject({ phase: "harvested", heightM: 0.12 });
    expect(canopyAt({ ...base, day: "2026-08-15", removals: ["2025-09-16"] }).phase).toBe("senescent");
  });

  it("NDVI retombé au sol nu après le pic : récolté, même sans récolte saisie", () => {
    expect(canopyAt({ ...base, day: "2026-09-01" })).toMatchObject({ phase: "harvested", heightM: 0.12 });
    // Maïs sec sur pied (NDVI ~0,27) : encore debout.
    expect(canopyAt({ ...base, day: "2026-08-19" }).phase).toBe("senescent");
  });

  it("début de croissance : la hauteur reste modeste quand le NDVI monte vite", () => {
    const early = canopyAt({ ...base, day: "2026-06-03" });
    expect(early.phase).toBe("growing");
    expect(early.heightM).toBeLessThan(1);
  });

  it("sol nu avant la levée, inconnu sans mesure récente", () => {
    expect(canopyAt({ ...base, day: "2026-05-22" }).phase).toBe("bare");
    expect(canopyAt({ ...base, day: "2026-11-30" })).toMatchObject({ phase: "unknown", ndvi: null });
    expect(canopyAt({ ...base, day: "2026-11-30", removals: ["2026-10-20"] }).phase).toBe("harvested");
  });

  it("vigne : structure toujours là, feuillage selon le NDVI, dormante l'hiver", () => {
    const vine = { nature: "vine", species: "Malbec", removals: [] as string[] };
    const summer = canopyAt({ ...vine, day: "2026-07-15", smoothed: [{ date: "2026-07-10", value: 0.62 }] });
    expect(summer.phase).toBe("growing");
    expect(summer.heightM).toBeGreaterThan(1.5);
    expect(canopyAt({ ...vine, day: "2026-01-15", smoothed: [] })).toMatchObject({ phase: "dormant", heightM: 0.9, density: 0 });
  });
});
