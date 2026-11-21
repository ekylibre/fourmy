import { describe, it, expect } from "vitest";
import { itkContent, type ItkArticleInfo, type ItkInputsContext } from "@fourmy/contracts";
import { doseToStock, inputNeeds, nitrogenToStock } from "../src/index.js";

/** Besoins en intrants (lot IT5) : conversions, plan de fumure prioritaire, stock et réservé, génériques, inconvertibles. */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEED = ID(1);
const MAIZE = ID(2);
const AMMO = ID(3);
const HERBI = ID(4);
const SLURRY = ID(5);
const art = (id: string, a: Partial<ItkArticleInfo>): ItkArticleInfo => ({ id, name: id, kind: "other", unit: "kilogram", density: null, tgwG: null, grainsPerDose: null, fertilizer: null, ...a });
const articles: Record<string, ItkArticleInfo> = {
  [SEED]: art(SEED, { name: "Blé Chevignon", kind: "seed", unit: "kilogram", tgwG: 45 }),
  [MAIZE]: art(MAIZE, { name: "Maïs DKC", kind: "seed", unit: "dose", grainsPerDose: 50_000 }),
  [AMMO]: art(AMMO, { name: "Ammonitrate 33,5", kind: "fertilizer", unit: "ton", fertilizer: { basis: "mass_percent", nTotal: 33.5, density: null } }),
  [HERBI]: art(HERBI, { name: "Herbicide", kind: "phyto", unit: "liter" }),
  [SLURRY]: art(SLURRY, { name: "Lisier", kind: "fertilizer", unit: "cubic_meter", fertilizer: { basis: "kg_per_m3", nTotal: 4, density: 1 } }),
};

describe("conversions", () => {
  it("semences : grains/m² → kg par le PMG ; milliers/ha → doses", () => {
    // 250 grains/m² × 10 ha = 25 M grains × 45 g / 1 000 000 = 1 125 kg.
    expect(doseToStock(250, "grain_per_square_meter", 10, articles[SEED]!)).toBeCloseTo(1125, 6);
    // 90 milliers/ha × 10 ha = 900 000 grains = 18 doses de 50 000.
    expect(doseToStock(90, "thousand_per_hectare", 10, articles[MAIZE]!)).toBeCloseTo(18, 6);
    expect(doseToStock(250, "grain_per_square_meter", 10, { ...articles[SEED]!, tgwG: null })).toBeNull();
  });

  it("engrais et phyto : kg/ha → t, L/ha → L ; azote → produit d'après la teneur", () => {
    expect(doseToStock(150, "kilogram_per_hectare", 10, articles[AMMO]!)).toBeCloseTo(1.5, 6);
    expect(doseToStock(2, "liter_per_hectare", 10, articles[HERBI]!)).toBe(20);
    // 335 kg N d'ammonitrate 33,5 % = 1 000 kg = 1 t ; 40 kg N de lisier à 4 kg/m³ = 10 m³.
    expect(nitrogenToStock(335, articles[AMMO]!)).toBeCloseTo(1, 6);
    expect(nitrogenToStock(40, articles[SLURRY]!)).toBeCloseTo(10, 6);
    expect(nitrogenToStock(40, articles[HERBI]!)).toBeNull();
  });
});

describe("besoins de l'assolement", () => {
  const content = itkContent.parse({
    schema: 1,
    steps: [
      { id: ID(11), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, inputs: [{ articleId: SEED, kind: "seed", label: "Blé", dose: 250, unit: "grain_per_square_meter" }] },
      { id: ID(12), procedure: "mineral_fertilizing", anchor: { kind: "date", monthDay: "02-15", yearOffset: 0 }, repeat: { count: 2, everyDays: 30 }, inputs: [{ articleId: AMMO, kind: "fertilizer", label: "Ammo", dose: 150, unit: "kilogram_per_hectare" }] },
      { id: ID(13), procedure: "organic_fertilizing", anchor: { kind: "sowing", offsetDays: -20 }, inputs: [{ articleId: SLURRY, kind: "fertilizer", label: "Lisier", dose: 20, unit: "cubic_meter_per_hectare" }] },
      { id: ID(14), procedure: "spraying", anchor: { kind: "sowing", offsetDays: 25 }, share: 0.5, optional: true, inputs: [{ articleId: HERBI, kind: "phyto", label: "Herbi", dose: 2, unit: "liter_per_hectare" }] },
      { id: ID(15), procedure: "spraying", anchor: { kind: "sowing", offsetDays: 60 }, inputs: [{ kind: "phyto", label: "Fongicide à choisir", dose: 1, unit: "liter_per_hectare" }] },
    ],
  });
  const ctx: ItkInputsContext = {
    year: 2027,
    at: "2026-11-21",
    articles,
    stock: { [SEED]: 2000, [AMMO]: 2, [HERBI]: 0, [SLURRY]: 100 },
    reserved: { [AMMO]: 1.5 },
    plans: { "p:B": { planId: "plan", applications: [{ articleId: AMMO, stage: "tallage", nTotalKgHa: 67, plannedOn: null }, { articleId: null, stage: "montaison", nTotalKgHa: 50, plannedOn: null }] } },
  };
  const items = [
    { parcelKey: "p:A", areaM2: 100_000, itineraryId: "itk", sowingOn: "2026-10-15", harvestOn: null, year: 2027 },
    { parcelKey: "p:B", areaM2: 100_000, itineraryId: "itk", sowingOn: "2026-10-15", harvestOn: null, year: 2027 },
  ];
  const lines = inputNeeds(items, { itk: { content } }, ctx);
  const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));

  it("semences, phyto « si besoin » à part, génériques sans comparaison au stock", () => {
    expect(byLabel["Blé Chevignon"]).toMatchObject({ needed: 2250, stock: 2000, toBuy: 250, sources: ["itk"] });
    expect(byLabel["Herbicide"]).toMatchObject({ needed: 0, optional: 20, toBuy: 0 });
    expect(byLabel["Fongicide à choisir"]).toMatchObject({ articleId: null, needed: 20, unit: "L", stock: null, toBuy: null });
  });

  it("plan de fumure établi prioritaire sur la fertilisation minérale de l'ITK ; organique gardé ; réservé déduit du stock", () => {
    // A : 2 × 150 kg/ha × 10 ha = 3 t (ITK) ; B : plan, 67 kg N × 10 ha = 670 kg N = 2 t ; total 5 t ; disponible 2 − 1,5 = 0,5 t.
    expect(byLabel["Ammonitrate 33,5"]).toMatchObject({ needed: 5, stock: 2, reserved: 1.5, toBuy: 4.5, sources: ["itk", "plan"] });
    expect(byLabel["Azote du plan de fumure (engrais à choisir)"]).toMatchObject({ needed: 500, unit: "kg N" });
    expect(byLabel["Lisier"]).toMatchObject({ needed: 400, toBuy: 300 });
  });

  it("dose inconvertible : gardée dans l'unité de la dose, signalée", () => {
    const noTgw = inputNeeds(items.slice(0, 1), { itk: { content } }, { ...ctx, articles: { ...articles, [SEED]: { ...articles[SEED]!, tgwG: null } } });
    expect(noTgw.find((l) => l.articleId === SEED)).toMatchObject({ unconvertible: true, unit: "grains", needed: 25_000_000, toBuy: null });
  });
});
