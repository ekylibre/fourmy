import { describe, it, expect } from "vitest";
import {
  convertSeedQuantity,
  DomainError,
  looksLikeMixture,
  parseSeedUnit,
  resolveTgw,
  seedConversionGap,
  seedEquivalents,
  seedFlags,
  seedUnitChoices,
  splitUnit,
  storedUnit,
  tgwWarning,
  toStockQuantity,
} from "../src/index.js";

/** Semences, lot SE1 (claudedocs/conception_semences.md §3). */
describe("unités de semence", () => {
  it("reconnaît les 10 libellés des articles existants", () => {
    expect(parseSeedUnit("kilogram")).toEqual({ dim: "mass", kg: 1 });
    expect(parseSeedUnit("Kg")).toEqual({ dim: "mass", kg: 1 });
    expect(parseSeedUnit("Kilogramme")).toEqual({ dim: "mass", kg: 1 });
    expect(parseSeedUnit("Sac de 50 000 grains")).toEqual({ dim: "dose", grains: 50_000 });
    expect(parseSeedUnit("sac de 50 000 grains")).toEqual({ dim: "dose", grains: 50_000 });
    expect(parseSeedUnit("Sac  de 50 000 grains")).toEqual({ dim: "dose", grains: 50_000 });
    expect(parseSeedUnit("Mille grains")).toEqual({ dim: "grain", grains: 1_000 });
    expect(parseSeedUnit("Mille graines")).toEqual({ dim: "grain", grains: 1_000 });
    expect(parseSeedUnit("graines")).toEqual({ dim: "grain", grains: 1 });
    expect(parseSeedUnit("unity")).toEqual({ dim: "grain", grains: 1 });
  });

  it("codes canoniques, doses et inconnues", () => {
    expect(parseSeedUnit("thousand")).toEqual({ dim: "grain", grains: 1_000 });
    expect(parseSeedUnit("million")).toEqual({ dim: "grain", grains: 1_000_000 });
    expect(parseSeedUnit("dose")).toEqual({ dim: "dose", grains: null });
    expect(parseSeedUnit("dose", 150_000)).toEqual({ dim: "dose", grains: 150_000 });
    expect(parseSeedUnit("Dose de 150.000 graines")).toEqual({ dim: "dose", grains: 150_000 });
    expect(parseSeedUnit("1000 grains")).toEqual({ dim: "grain", grains: 1_000 });
    expect(parseSeedUnit("liter")).toBeNull();
    expect(parseSeedUnit("palette")).toBeNull();
    expect(parseSeedUnit("")).toBeNull();
  });

  it("maïs : 90 000 grains/ha = 1,8 dose de 50 000 = 27 kg à 300 g de PMG", () => {
    const ctx = { tgwG: 300, grainsPerDose: 50_000 };
    expect(convertSeedQuantity(90_000, "grain", "Sac de 50 000 grains", ctx)).toBeCloseTo(1.8);
    expect(convertSeedQuantity(90, "thousand", "kilogram", ctx)).toBeCloseTo(27);
    expect(convertSeedQuantity(27, "kilogram", "dose", ctx)).toBeCloseTo(1.8);
    expect(convertSeedQuantity(3, "Sac de 50 000 grains", "Mille grains")).toBe(150);
  });

  it("sans PMG ni grains par dose : refus, avec le motif", () => {
    expect(convertSeedQuantity(90, "thousand", "kilogram")).toBeNull();
    expect(seedConversionGap("thousand", "kilogram")).toBe("tgw_missing");
    expect(seedConversionGap("dose", "thousand")).toBe("grains_per_dose_missing");
    expect(seedConversionGap("liter", "kilogram")).toBe("unit_unknown");
    expect(seedConversionGap("Kg", "kilogram")).toBeNull();
  });

  it("unités proposées à la saisie : la sienne d'abord, puis ce qui s'y convertit", () => {
    expect(seedUnitChoices("Sac de 50 000 grains", { tgwG: 300 })).toEqual(["Sac de 50 000 grains", "kilogram", "thousand", "grain"]);
    expect(seedUnitChoices("Sac de 50 000 grains")).toEqual(["Sac de 50 000 grains", "thousand", "grain"]);
    expect(seedUnitChoices("Kilogramme")).toEqual(["Kilogramme"]);
    expect(seedUnitChoices("kilogram", { tgwG: 42 })).toEqual(["kilogram", "thousand", "grain"]);
    expect(seedUnitChoices("palette")).toEqual(["palette"]);
  });

  it("équivalents d'une dose de semis", () => {
    const ctx = { tgwG: 300, grainsPerDose: 50_000 };
    const e = seedEquivalents(9, "grain_per_square_meter", ctx, 10)!;
    expect(e.grainsPerHa).toBeCloseTo(90_000);
    expect(e.dosesPerHa).toBeCloseTo(1.8);
    expect(e.kgPerHa).toBeCloseTo(27);
    expect(e.grainsPerM2).toBeCloseTo(9);
    // Quantité totale ramenée à l'hectare par la surface.
    expect(seedEquivalents(18, "dose", ctx, 10)!.grainsPerM2).toBeCloseTo(9);
    // Sans PMG : les grains, pas la masse.
    expect(seedEquivalents(180, "kilogram_per_hectare", { grainsPerDose: null }, 5)).toEqual({ grainsPerM2: null, grainsPerHa: null, dosesPerHa: null, kgPerHa: 180 });
    expect(seedEquivalents(18, "dose", ctx, null)).toBeNull();
  });
});

describe("quantité de stock d'un semis", () => {
  it("maïs semé à 9 grains/m² sur 10 ha : 18 doses sortent du stock", () => {
    expect(toStockQuantity({ quantity: 9, unit: "grain_per_square_meter", articleUnit: "Sac de 50 000 grains", areaHa: 10, seed: { tgwG: null } })).toBeCloseTo(18);
  });

  it("kg/ha d'un blé stocké en milliers de grains, par le PMG", () => {
    // 180 kg/ha × 2 ha = 360 kg ; à 42 g : 360 × 1 000 000 / 42 / 1 000 ≈ 8 571 milliers.
    expect(toStockQuantity({ quantity: 180, unit: "kilogram_per_hectare", articleUnit: "Mille grains", areaHa: 2, seed: { tgwG: 42 } })).toBeCloseTo(8571.43, 1);
  });

  it("sans PMG : refus qui dit quoi compléter", () => {
    expect(() => toStockQuantity({ quantity: 180, unit: "kilogram_per_hectare", articleUnit: "Mille grains", areaHa: 2, seed: {} })).toThrow(/PMG inconnu/);
    expect(() => toStockQuantity({ quantity: 2, unit: "thousand", articleUnit: "dose", areaHa: 2, seed: {} })).toThrow(/grains par dose/);
    expect(() => toStockQuantity({ quantity: 2, unit: "grain_per_square_meter", articleUnit: "thousand", areaHa: null, seed: {} })).toThrow(DomainError);
  });

  it("sans `seed`, les autres intrants gardent la règle actuelle", () => {
    expect(() => toStockQuantity({ quantity: 3, unit: "Sac de 50 000 grains", articleUnit: "Mille grains", areaHa: 1 })).toThrow(DomainError);
    expect(toStockQuantity({ quantity: 3, unit: "Sac de 50 000 grains", articleUnit: "Mille grains", areaHa: 1, seed: {} })).toBe(150);
  });
});

describe("PMG retenu", () => {
  it("lot, puis article, puis repère de l'espèce (estimé)", () => {
    const reference = { typicalG: 45 };
    expect(resolveTgw({ lot: { tgwG: 48, origin: "label" }, article: { tgwG: 42, origin: "label" }, reference })).toEqual({ tgwG: 48, origin: "label", from: "lot", estimated: false });
    expect(resolveTgw({ lot: { tgwG: null, origin: null }, article: { tgwG: 42, origin: "measured" }, reference })).toEqual({ tgwG: 42, origin: "measured", from: "article", estimated: false });
    expect(resolveTgw({ article: null, reference })).toEqual({ tgwG: 45, origin: "reference", from: "reference", estimated: true });
    expect(resolveTgw({ article: { tgwG: 45, origin: "reference" } })!.estimated).toBe(true);
    expect(resolveTgw({})).toBeNull();
  });

  it("écart de plus de 30 % au repère signalé", () => {
    expect(tgwWarning(42, { typicalG: 45 })).toBe(false);
    expect(tgwWarning(420, { typicalG: 45 })).toBe(true);
    expect(tgwWarning(30, { typicalG: 45 })).toBe(true);
    expect(tgwWarning(42, null)).toBe(false);
  });
});

describe("repères d'une semence", () => {
  it("ce qui manque", () => {
    expect(seedFlags({ unit: "kilogram", seed: null })).toEqual(["species_unknown", "tgw_missing"]);
    expect(seedFlags({ unit: "palette", seed: { species: "zea_mays", isMixture: false, grainsPerDose: null, tgwG: 300 } })).toEqual(["unit_unknown"]);
    expect(seedFlags({ unit: "kilogram", seed: { species: "triticum_aestivum", isMixture: false, grainsPerDose: null, tgwG: 420 }, reference: { typicalG: 45 } })).toEqual(["tgw_far_from_reference"]);
    expect(seedFlags({ unit: "kilogram", seed: { species: null, isMixture: true, grainsPerDose: null, tgwG: null }, componentCount: 0 })).toEqual(["mixture_empty"]);
    expect(seedFlags({ unit: "kilogram", seed: { species: null, isMixture: true, grainsPerDose: null, tgwG: null }, componentCount: 4 })).toEqual([]);
  });

  it("mélanges proposés d'après le nom ou l'espèce importée", () => {
    expect(looksLikeMixture("Avoine + TI + Radis + Phacelie")).toBe(true);
    expect(looksLikeMixture("Couvertsol novation 2", "Mélange")).toBe(true);
    expect(looksLikeMixture("Mélange CIPAN")).toBe(true);
    expect(looksLikeMixture("Thermidor", "Blé tendre")).toBe(false);
  });
});

describe("unité enregistrée d'un semis (lot SE5)", () => {
  it("grains/m² : déjà par surface, sans suffixe « par hectare » ; relu tel quel", () => {
    expect(storedUnit("grain_per_square_meter", "hectare")).toBe("grain_per_square_meter");
    expect(storedUnit("grain_per_square_meter", "total")).toBe("grain_per_square_meter");
    expect(storedUnit("kilogram", "hectare")).toBe("kilogram_per_hectare");
    expect(splitUnit("grain_per_square_meter")).toEqual({ unit: "grain_per_square_meter", per: "total" });
  });
});

