import { describe, expect, it } from "vitest";
import { landscapeTrees, pylonHeightM, vegetationRule, type LandscapeInput } from "../src/index.js";

// Repère : 1 m ≈ 1/111 320 ° en latitude ; en longitude à 43,39° de latitude.
const LAT0 = 43.39;
const LON0 = -0.2;
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const at = (x: number, y: number): [number, number] => [LON0 + x * M_LON, LAT0 + y * M_LAT];
const square = (x0: number, y0: number, side: number) => [[at(x0, y0), at(x0 + side, y0), at(x0 + side, y0 + side), at(x0, y0 + side), at(x0, y0)]];

const hedge: LandscapeInput = { id: "HAIE1", kind: "hedge", geometry: { type: "LineString", coordinates: [at(0, 0), at(100, 0)] } };
const wood: LandscapeInput = { id: "BOIS1", kind: "vegetation", nature: "Bois", geometry: { type: "Polygon", coordinates: square(0, 50, 200) } };

describe("arbres du paysage (BD TOPO)", () => {
  it("haie : un arbre tous les 4 m, hauteur autour de 6 m", () => {
    const { trees } = landscapeTrees([hedge]);
    expect(trees.length).toBe(25);
    expect(trees.every((t) => t.kind === "hedge" && t.heightM > 4 && t.heightM < 8)).toBe(true);
  });

  it("reproductible, et indépendant de l'emprise demandée", () => {
    const all = landscapeTrees([hedge, wood]).trees;
    expect(landscapeTrees([hedge, wood]).trees).toEqual(all);
    const [west, south] = at(100, -10);
    const [east, north] = at(300, 300);
    const half = landscapeTrees([wood], { bbox: [west, south, east, north] }).trees;
    // Chaque arbre de la moitié est retrouvé dans le tout à moins de 5 cm.
    const near = (t: { lon: number; lat: number }) => all.some((u) => Math.hypot((u.lon - t.lon) / M_LON, (u.lat - t.lat) / M_LAT) < 0.05);
    expect(half.length).toBeGreaterThan(50);
    expect(half.every(near)).toBe(true);
  });

  it("bois : bordure dense, centre éclairci ; rien dans une parcelle exclue", () => {
    const { trees } = landscapeTrees([wood]);
    // 200 m de côté, grille de 7 m : 28 × 28 cellules dont la bordure de 30 m complète, le centre au quart.
    expect(trees.length).toBeGreaterThan(400);
    expect(trees.length).toBeLessThan(28 * 28);
    const parcel = square(50, 100, 100);
    const kept = landscapeTrees([wood], { exclude: [parcel] }).trees;
    const inside = kept.filter((t) => t.lon > at(50, 0)[0] && t.lon < at(150, 0)[0] && t.lat > at(0, 100)[1] && t.lat < at(0, 200)[1]);
    expect(inside).toHaveLength(0);
  });

  it("règles par nature, plafond par distance au centre", () => {
    expect(vegetationRule("Vigne")).toBeNull();
    expect(vegetationRule("Forêt fermée de conifères")?.kind).toBe("conifer");
    expect(vegetationRule("Verger")?.aligned).toBe(true);
    const capped = landscapeTrees([hedge, wood], { limit: 10, center: at(0, 0) });
    expect(capped.truncated).toBe(true);
    expect(capped.trees).toHaveLength(10);
    expect(capped.trees.every((t) => t.kind === "hedge")).toBe(true); // la haie est au centre
  });

  it("hauteur d'un pylône par tension", () => {
    expect(pylonHeightM(400)).toBe(55);
    expect(pylonHeightM(225)).toBe(45);
    expect(pylonHeightM(null)).toBe(25);
  });
});

describe("hauteurs du LiDAR HD", () => {
  it("hauteur réelle, arbre absent retiré, sans donnée inchangé ; cimes isolées ajoutées loin des arbres", async () => {
    const { refineWithCanopy } = await import("../src/index.js");
    const trees = [
      { lon: LON0, lat: LAT0, heightM: 6, crownM: 3.6, kind: "hedge" as const },
      { lon: LON0 + 10 * M_LON, lat: LAT0, heightM: 6, crownM: 3.6, kind: "hedge" as const },
      { lon: LON0 + 20 * M_LON, lat: LAT0, heightM: 6, crownM: 3.6, kind: "hedge" as const },
    ];
    const heights = [12, 0.4, null];
    const r = refineWithCanopy(trees, (lon) => heights[Math.round((lon - LON0) / M_LON / 10)] ?? null, [
      { lon: LON0 + 1 * M_LON, lat: LAT0, heightM: 11 }, // déjà représentée par le premier arbre
      { lon: LON0, lat: LAT0 + 50 * M_LAT, heightM: 18 }, // arbre isolé
    ]);
    expect(r.removed).toBe(1);
    expect(r.added).toBe(1);
    expect(r.trees.map((t) => [t.heightM, t.crownM, t.kind])).toEqual([
      [12, 7.2, "hedge"],
      [6, 3.6, "hedge"],
      [18, 10.8, "deciduous"],
    ]);
  });
});
