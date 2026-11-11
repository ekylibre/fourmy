import { describe, expect, it } from "vitest";
import type { FertilizerComposition } from "@fourmy/contracts";
import { nitrogenOfInput, proposeComposition, proposeFromLexicon, proposeFromName, unitScale } from "../src/index.js";

const comp = (c: Partial<FertilizerComposition>): FertilizerComposition => ({
  basis: "mass_percent", nTotal: 0, nMineralShare: 1, p2o5: null, k2o: null, so3: null, density: null, nitrateType: "III", foliar: false, ...c,
});

describe("unités des intrants", () => {
  it("reconnaît les codes Ekylibre et les unités saisies", () => {
    expect(unitScale("kilogram")).toEqual({ dim: "mass", factor: 1 });
    expect(unitScale("Tonne")).toEqual({ dim: "mass", factor: 1000 });
    expect(unitScale("T")).toEqual({ dim: "mass", factor: 1000 });
    expect(unitScale("Litre")).toEqual({ dim: "volume", factor: 1 });
    expect(unitScale("cubic_meter")).toEqual({ dim: "volume", factor: 1000 });
    expect(unitScale("unity")).toBeNull();
  });
});

describe("azote apporté (FR-FERT-20)", () => {
  it("engrais minéral en kg/ha : azote total = efficace", () => {
    const r = nitrogenOfInput({ quantity: 161, per: "hectare", unit: "kilogram", areaHa: null, composition: comp({ nTotal: 30, density: 1.3 }) });
    expect(r).toMatchObject({ totalKgHa: 48.3, mineralKgHa: 48.3, efficientKgHa: 48.3, productPerHa: { kg: 161, l: 123.8 } });
  });

  it("solution azotée 390 en litres au total : volume × kg N/m³", () => {
    const r = nitrogenOfInput({ quantity: 2000, per: "total", unit: "liter", areaHa: 10, composition: comp({ basis: "kg_per_m3", nTotal: 390, density: 1.3 }) });
    expect(r).toMatchObject({ totalKgHa: 78, productPerHa: { l: 200, kg: 260 } });
  });

  it("NPK : azote, phosphore et potasse", () => {
    const r = nitrogenOfInput({ quantity: 0.3, per: "hectare", unit: "Tonne", areaHa: null, composition: comp({ nTotal: 9.5, p2o5: 15, k2o: 30 }) });
    expect(r).toMatchObject({ totalKgHa: 28.5, p2o5KgHa: 45, k2oKgHa: 90 });
  });

  it("organique en t/ha : azote total et minéral, efficace inconnu sans Keq", () => {
    const r = nitrogenOfInput({ quantity: 30, per: "hectare", unit: "ton", areaHa: null, composition: comp({ basis: "kg_per_t", nTotal: 5.8, nMineralShare: 0.1, nitrateType: "Ib" }) });
    expect(r).toMatchObject({ totalKgHa: 174, mineralKgHa: 17.4, efficientKgHa: null });
  });

  it("ce qui manque est dit, jamais deviné", () => {
    expect(nitrogenOfInput({ quantity: 100, per: "hectare", unit: "kilogram", areaHa: null, composition: null })).toEqual({ missing: "composition" });
    expect(nitrogenOfInput({ quantity: 100, per: "hectare", unit: "unity", areaHa: null, composition: comp({ nTotal: 30 }) })).toEqual({ missing: "unit" });
    expect(nitrogenOfInput({ quantity: 100, per: "hectare", unit: "liter", areaHa: null, composition: comp({ nTotal: 30 }) })).toEqual({ missing: "density" });
    expect(nitrogenOfInput({ quantity: 100, per: "total", unit: "kilogram", areaHa: null, composition: comp({ nTotal: 30 }) })).toEqual({ missing: "area" });
  });
});

describe("composition proposée (FR-FERT-6)", () => {
  it("d'après le nom : N-P-K, urée, solution azotée, ammonitrate", () => {
    expect(proposeFromName("9,5-15-30 SO3")).toMatchObject({ nTotal: 9.5, p2o5: 15, k2o: 30, nitrateType: "III" });
    expect(proposeFromName("4-7-28")).toMatchObject({ nTotal: 4, p2o5: 7, k2o: 28 });
    expect(proposeFromName("Urée 46")).toMatchObject({ nTotal: 46, basis: "mass_percent" });
    expect(proposeFromName("Solution azotée 390")).toMatchObject({ basis: "kg_per_m3", nTotal: 390, density: 1.3 });
    expect(proposeFromName("Solution azotée 32")).toMatchObject({ basis: "mass_percent", nTotal: 32, density: 1.3 });
    expect(proposeFromName("Ammonitrate 27")).toMatchObject({ nTotal: 27 });
    expect(proposeFromName("Chlorure de potasse")).toMatchObject({ nTotal: 0, k2o: 60, nitrateType: null });
    expect(proposeFromName("Carbo 48 chaux")).toMatchObject({ nTotal: 0, nitrateType: null });
    expect(proposeFromName("Magnolac")).toBeNull();
    expect(proposeFromName("Zintrac 850")).toBeNull();
  });

  it("d'après le code Lexicon, quand le nom ne dit rien", () => {
    expect(proposeFromLexicon("liquid_nitrogen_30_d1.3")).toMatchObject({ nTotal: 30, density: 1.3 });
    expect(proposeFromLexicon("urea_46")).toMatchObject({ nTotal: 46 });
    expect(proposeFromLexicon("potassium_chloride")).toMatchObject({ k2o: 60, nTotal: 0 });
    expect(proposeFromLexicon("cattle_slurry")).toBeNull();
    // Le nom prime : « Solution azotée 32 » rattachée par erreur à ammonitrate_33 dans Ekylibre.
    expect(proposeComposition({ name: "Solution azotée 32", lexiconRef: "ammonitrate_33" })).toMatchObject({ nTotal: 32 });
    expect(proposeComposition({ name: "Engrais du coin", lexiconRef: "urea_46" })).toMatchObject({ nTotal: 46, source: "Lexicon urea_46" });
  });
});
