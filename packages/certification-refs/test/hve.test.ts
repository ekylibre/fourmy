import { describe, it, expect } from "vitest";
import {
  cmrClassOf,
  departmentOf,
  fieldCropsReference,
  iftPoints,
  oldRegionOf,
  orchardReference,
  pointsBySlices,
  speciesDiversityPoints,
  vineBasinOf,
  vineDiversityPoints,
  vineReference,
} from "../src/index.js";

describe("grille HVE v1.15 : barèmes aux bornes", () => {
  it("5.2 et 6.5 : tranches de 10 points au-delà de 5 %", () => {
    expect(pointsBySlices(5)).toBe(0);
    expect(pointsBySlices(5.01)).toBe(1);
    expect(pointsBySlices(15)).toBe(1);
    expect(pointsBySlices(15.01)).toBe(2);
    expect(pointsBySlices(95)).toBe(9);
    expect(pointsBySlices(95.01)).toBe(10);
    expect(pointsBySlices(100)).toBe(10);
  });

  it("5.3 : classes par quarts entre plancher et plafond (Alsace GC herbicides : 1 – 1,7)", () => {
    // x = 0,175 : Pc+x = 1,175 ; Pc+2x = 1,35 ; Pc+3x = 1,525.
    expect(iftPoints(1, 1, 1.7)).toBe(5);
    expect(iftPoints(1.001, 1, 1.7)).toBe(4);
    expect(iftPoints(1.175, 1, 1.7)).toBe(4);
    expect(iftPoints(1.35, 1, 1.7)).toBe(3);
    expect(iftPoints(1.525, 1, 1.7)).toBe(2);
    expect(iftPoints(1.7, 1, 1.7)).toBe(1);
    expect(iftPoints(1.71, 1, 1.7)).toBe(0);
    expect(iftPoints(1, 1, 1.7, "orchard")).toBe(3);
    expect(iftPoints(1.35, 1, 1.7, "orchard")).toBe(1.8);
  });

  it("5.8 : diversité variétale", () => {
    expect([1, 2, 3, 5].map(vineDiversityPoints)).toEqual([0, 1, 2, 2]);
    expect(speciesDiversityPoints([1, 2, 3])).toBe(3);
    expect(speciesDiversityPoints([3, 3, 3, 3])).toBe(6);
  });
});

describe("liste CMR à la date", () => {
  it("version applicable : la plus récente publiée à la date ; classe et herbicide", () => {
    expect(cmrClassOf("2000003", "2026-10-01")).toMatchObject({ cmr: 2, herbicide: true, list: "2026-09-04" });
    expect(cmrClassOf("2000003", "2025-01-15")).toMatchObject({ list: "2024-10-29" });
    expect(cmrClassOf("2000003", "2023-05-01")).toMatchObject({ list: "2024-10-29" });
    expect(cmrClassOf("0000000", "2026-10-01")).toBeNull();
    expect(cmrClassOf(null, "2026-10-01")).toBeNull();
  });
});

describe("références IFT", () => {
  it("anciennes régions, casse comprise ; pomme de terre recalée sur sa part", () => {
    expect(oldRegionOf("67")).toBe("Alsace");
    expect(departmentOf("97411")).toBe("974");
    expect(fieldCropsReference("Alsace", 0)).toEqual([1, 1.7, 0.26, 1.15]);
    expect(fieldCropsReference("Pays De La Loire", 0)).toEqual([0.93, 1.95, 0.55, 1.42]);
    // 20 % de pomme de terre : Pc = 0,8 × 1 + 0,2 × 1,66.
    expect(fieldCropsReference("Alsace", 0.2)![0]).toBe(1.132);
    expect(fieldCropsReference("Alsace", 0, "old")).toEqual([1, 1.67, 0.26, 1.28]);
  });

  it("bassins viticoles : département, Ardèche par commune, Beaujolais selon le réglage", () => {
    expect(vineBasinOf("33063")).toBe("Bordelais");
    expect(vineBasinOf("07001")).toBe("Côtes-du-Rhône-Nord (septentrional)");
    expect(vineBasinOf("69123")).toBeNull();
    expect(vineBasinOf("69123", true)).toBe("Beaujolais");
    expect(vineReference("Bordelais")).toEqual([0.01, 0.6, 10.45, 15.52]);
  });

  it("arboriculture : moyenne pondérée des vergers", () => {
    const r = orchardReference("Alsace", [{ orchard: "Abricotier", areaM2: 10_000 }, { orchard: "Cerisier", areaM2: 10_000 }]);
    expect(r).toEqual([0.005, 0.54, 4.485, 9.345]);
  });
});
