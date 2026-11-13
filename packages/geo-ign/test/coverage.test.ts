import { describe, it, expect } from "vitest";
import { coveragePlan, estimateBytes, lonLatToTile, mercatorTileBounds, planTileCount, tilesInCircle, tilesNearPolygons, validTile } from "../src/index.js";

const farm = { lon: -0.0728, lat: 44.626 };
const square = (lon: number, lat: number, d: number) => [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]];

describe("tuiles Web Mercator (grille PM de l'IGN)", () => {
  it("retrouve la tuile d'un point et son emprise", () => {
    const { x, y } = lonLatToTile(farm.lon, farm.lat, 16);
    const b = mercatorTileBounds(16, x, y);
    expect(b.west).toBeLessThanOrEqual(farm.lon);
    expect(b.east).toBeGreaterThan(farm.lon);
    expect(b.north).toBeGreaterThanOrEqual(farm.lat);
    expect(b.south).toBeLessThan(farm.lat);
  });
  it("valide les coordonnées de tuile", () => {
    expect(validTile(0, 0, 0)).toBe(true);
    expect(validTile(2, 4, 0)).toBe(false);
    expect(validTile(20, 0, 0)).toBe(false);
    expect(validTile(1.5, 0, 0)).toBe(false);
  });
});

describe("plan de préchargement", () => {
  it("un cercle de 10 km : quelques centaines de tuiles au zoom 15, sans les coins", () => {
    const tiles = tilesInCircle(farm, 10_000, 15);
    // tuile ≈ 870 m à 44,6° : cercle de 314 km² ≈ 415 tuiles, plus le bord
    expect(tiles.length).toBeGreaterThan(400);
    expect(tiles.length).toBeLessThan(600);
    const box = tilesInCircle(farm, 10_000 * Math.SQRT2, 15).length;
    expect(tiles.length).toBeLessThan(box);
  });
  it("un rayon nul garde la tuile du centre", () => {
    const { x, y } = lonLatToTile(farm.lon, farm.lat, 12);
    expect(tilesInCircle(farm, 0, 12)).toEqual([{ z: 12, x, y }]);
  });
  it("autour des parcelles : la marge élargit, et deux parcelles voisines ne doublent rien", () => {
    const p = square(farm.lon, farm.lat, 0.003);
    const tight = tilesNearPolygons([p], 0, 18);
    const wide = tilesNearPolygons([p], 200, 18);
    expect(tight.length).toBeGreaterThan(0);
    expect(wide.length).toBeGreaterThan(tight.length);
    expect(tilesNearPolygons([p, p], 200, 18)).toHaveLength(wide.length);
  });
  it("une tuile loin de la parcelle (mais dans sa boîte élargie) n'est pas prise", () => {
    // Parcelle en L : la boîte couvre le coin vide, la marge nulle ne le prend pas.
    const l = [[[0, 0], [0.01, 0], [0.01, 0.001], [0.001, 0.001], [0.001, 0.01], [0, 0.01], [0, 0]].map(([a, b]) => [farm.lon + a!, farm.lat + b!])];
    const corner = lonLatToTile(farm.lon + 0.008, farm.lat + 0.008, 18);
    expect(tilesNearPolygons([l], 0, 18).some((t) => t.x === corner.x && t.y === corner.y)).toBe(false);
  });
  it("ordre de grandeur de la conception : 10 km et 40 ha, moins de 150 Mo", () => {
    const parcels = Array.from({ length: 10 }, (_, i) => square(farm.lon + i * 0.004, farm.lat, 0.0025)); // ≈ 10 × 4 ha
    const plan = coveragePlan({ sites: [{ location: farm, radiusM: 10_000 }], parcels, layers: ["ortho", "plan"], detailMarginM: 200 });
    const ortho = plan.get("ortho")!;
    expect(ortho.filter((t) => t.z <= 16).length).toBeGreaterThan(2000);
    expect(ortho.filter((t) => t.z <= 16).length).toBeLessThan(3000);
    expect(plan.get("plan")!.some((t) => t.z === 18)).toBe(false);
    expect(planTileCount(plan)).toBe(ortho.length + plan.get("plan")!.length);
    expect(estimateBytes(plan)).toBeLessThan(150e6);
  });
  it("deux sites qui se chevauchent : pas de doublon", () => {
    const one = coveragePlan({ sites: [{ location: farm, radiusM: 5000 }], parcels: [], layers: ["plan"], detailMarginM: 0 });
    const two = coveragePlan({ sites: [{ location: farm, radiusM: 5000 }, { location: farm, radiusM: 5000 }], parcels: [], layers: ["plan"], detailMarginM: 0 });
    expect(two.get("plan")).toHaveLength(one.get("plan")!.length);
  });
});
