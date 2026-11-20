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
  NITROGEN_EXPORTS,
  NITROGEN_EXPORTS_ROWS,
  nitrogenExportsOf,
  nitrogenBalancePoints,
  organicNitrogenPoints,
  legumePoints,
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

describe("table des exportations d'azote (23/06/2026)", () => {
  it("nombre de lignes par partie conforme au PDF", () => {
    for (const part of [1, 2, 3, 4, 5, 6] as const) {
      expect(NITROGEN_EXPORTS.filter((e) => e.part === part).length, `partie ${part}`).toBe(NITROGEN_EXPORTS_ROWS[part]);
    }
    expect(NITROGEN_EXPORTS).toHaveLength(196);
  });

  it("valeurs lues dans la table (exemples du rapport)", () => {
    const row = (crop: string, organ: string | null, harvest?: string) => NITROGEN_EXPORTS.find((e) => e.crop === crop && e.organ === organ && (harvest === undefined || e.harvest === harvest));
    expect(row("Blé tendre", "grain")).toMatchObject({ dm: 85, n: 18, unit: "kg/t" });
    expect(row("Blé tendre", "paille")).toMatchObject({ dm: 85, n: 4, exported: { dm: 88, n: 5.7 } });
    expect(row("Colza", "grain")).toMatchObject({ dm: 91, n: 29 });
    expect(row("Maïs", "épi entier")).toMatchObject({ dm: 81, n: 11 });
    expect(row("Betterave sucrière", "racine")).toMatchObject({ n: 1.1 });
    expect(row("Pomme de terre conso.", "tubercule")).toMatchObject({ dm: 22, n: 3.4 });
    expect(row("Luzerne", null, "foin")).toMatchObject({ n: 28, unit: "kg/t MS" });
    expect(row("Carotte grosse « Flakkee »", "racine")).toMatchObject({ dm: 12, n: 1.7, harvest: "I" });
    expect(row("Pommier", "fruits")).toMatchObject({ n: 0.6, perennial: 80 });
    expect(row("Raisin", "fruits")).toMatchObject({ n: 2, perennial: 20 });
    expect(NITROGEN_EXPORTS.find((e) => e.crop === "Jeune verger")).toMatchObject({ n: 20, unit: "kg N/ha" });
  });

  it("correspondance : production de référence, puis espèce et ancêtres ; sinon culture mineure", () => {
    expect(nitrogenExportsOf("triticum_aestivum").map((e) => e.organ)).toEqual(["grain", "paille"]);
    expect(nitrogenExportsOf("zea_mays").every((e) => e.part === 1)).toBe(true);
    expect(nitrogenExportsOf("zea_mays", [], "silage_corn").every((e) => e.part === 2)).toBe(true);
    expect(nitrogenExportsOf("plant", [], "meadow")[0]!.crop).toMatch(/^Prairie/);
    expect(nitrogenExportsOf("beta_vulgaris_vulgaris", [], "fodder_beetroot")[0]!.crop).toBe("Betterave fourragère");
    expect(nitrogenExportsOf("solanum_tuberosum", [], "potato_starch")[0]!.crop).toBe("Pomme de terre fécule");
    expect(nitrogenExportsOf("vitis_vinifera_malbec", ["vitis_vinifera", "vitis"])[0]!.crop).toBe("Raisin");
    expect(nitrogenExportsOf("lavandula_angustifolia", ["lavandula"])).toEqual([]);
  });
});

describe("grille HVE : fertilisation, barèmes aux bornes", () => {
  it("6.1 bilan azoté : BGA et bilan apparent d'une OTEX herbivore", () => {
    expect([20, 20.01, 30, 30.01, 40, 40.01, 50, 50.01].map((b) => nitrogenBalancePoints(b))).toEqual([8, 7, 7, 5, 5, 2, 2, 0]);
    expect([30, 30.01, 50, 50.01, 70, 70.01, 90, 90.01].map((b) => nitrogenBalancePoints(b, true))).toEqual([8, 6, 6, 4, 4, 2, 2, 0]);
  });
  it("6.3 azote organique et 6.6 légumineuses", () => {
    expect([24.99, 25, 35, 45, 55].map(organicNitrogenPoints)).toEqual([0, 1, 2, 3, 4]);
    expect([4.99, 5, 10, 15].map(legumePoints)).toEqual([0, 2, 3, 4]);
  });
});
