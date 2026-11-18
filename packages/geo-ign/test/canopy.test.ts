import { describe, expect, it } from "vitest";
import { canopyAt, canopyPeaks, canopyUrl, decodeCanopy, type CanopyGrid } from "../src/index.js";

const grid = (size: number, at: (i: number, j: number) => number): CanopyGrid => {
  const data = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) data[j * size + i] = at(i, j);
  return { bounds: { west: 0, east: size / 1000, south: 45, north: 45 + size / 1000 }, size, data };
};

describe("hauteur de la végétation (MNH du LiDAR HD)", () => {
  it("requête BIL de la couche MNH ; « pas de donnée » → NaN", () => {
    const url = new URL(canopyUrl({ west: -0.205, south: 43.385, east: -0.202, north: 43.387 }, 64));
    expect(url.searchParams.get("LAYERS")).toBe("IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G");
    expect(url.searchParams.get("BBOX")).toBe("43.385,-0.205,43.387,-0.202");
    const buf = new ArrayBuffer(4 * 4);
    new DataView(buf).setFloat32(0, -99999, true);
    new DataView(buf).setFloat32(4, 12.5, true);
    const g = decodeCanopy(buf, 2);
    expect(Number.isNaN(g[0]!)).toBe(true);
    expect(g[1]).toBe(12.5);
  });

  it("hauteur au pied d'un arbre : le maximum du voisinage ; null sans donnée", () => {
    const g = grid(10, (i, j) => (i === 5 && j === 5 ? 14 : 1));
    // Centre du pixel (4, 4) : voisin de la cime.
    expect(canopyAt([g], 0.0045, 45 + 0.0055, 1)).toBe(14);
    expect(canopyAt([g], 0.0005, 45 + 0.0095, 1)).toBe(1);
    expect(canopyAt([g], 5, 5)).toBeNull();
    expect(canopyAt([grid(10, () => NaN)], 0.005, 45.005)).toBeNull();
  });

  it("cimes : maxima locaux au-dessus du seuil, seuil relevé par endroit", () => {
    const g = grid(20, (i, j) => (i === 5 && j === 5 ? 10 : i === 14 && j === 14 ? 3.5 : i === 15 && j === 5 ? 2 : 0.5));
    const peaks = canopyPeaks(g, { minHeightM: 3 });
    expect(peaks.map((p) => p.heightM)).toEqual([10, 3.5]);
    // Seuil de 4 m dans la moitié est (une parcelle de maïs, par exemple).
    expect(canopyPeaks(g, { minHeightM: 3, minHeightAt: (lon) => (lon > 0.01 ? 4 : 3) }).map((p) => p.heightM)).toEqual([10]);
    // Plateau : une seule cime.
    expect(canopyPeaks(grid(10, (i, j) => (i >= 4 && i <= 5 && j === 4 ? 8 : 0)), { minHeightM: 3 })).toHaveLength(1);
  });
});
