import { describe, it, expect } from "vitest";
import {
  canonicalSeedUnit,
  convertSeedQuantity,
  coverFamilyOf,
  grainsPerM2,
  mixtureMatches,
  mixtureTotal,
  summarizeSeedUsage,
  type SeedUsageLine,
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
    // `unity` est un comptage à l'unité, comme plant ou pied (issue #130, U3).
    expect(parseSeedUnit("unity")).toEqual({ dim: "plant" });
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


describe("mélanges et couverts (lot SE6)", () => {
  it("dose du mélange : somme des doses, à 0,01 près", () => {
    const doses = [{ kgHa: 8 }, { kgHa: 4 }, { kgHa: 2 }, { kgHa: 1 }];
    expect(mixtureTotal(doses)).toBe(15);
    expect(mixtureMatches(15, doses)).toBe(true);
    expect(mixtureMatches(15.01, doses)).toBe(true);
    expect(mixtureMatches(15.02, doses)).toBe(false);
    expect(mixtureTotal([{ kgHa: 0.1 }, { kgHa: 0.2 }])).toBe(0.3);
  });

  it("densité d'une espèce : kg/ha × 100 / PMG", () => {
    expect(grainsPerM2(8, 20)).toBe(40);
    expect(grainsPerM2(8, null)).toBeNull();
  });

  it("famille du couvert d'après les espèces, rien de deviné hors référentiel", () => {
    expect(coverFamilyOf(["legume", "legume"])).toBe("legumineuses");
    expect(coverFamilyOf(["crucifer"])).toBe("cruciferes");
    expect(coverFamilyOf(["phacelia"])).toBe("hydrophyllacees");
    expect(coverFamilyOf(["grass_oat_rye"])).toBe("graminees_seigle_avoine");
    expect(coverFamilyOf(["grass_ryegrass"])).toBe("graminees_ray_grass");
    expect(coverFamilyOf(["grass_oat_rye", "legume"])).toBe("melange_graminees_legumineuses");
    expect(coverFamilyOf(["grass_oat_rye", "grass_ryegrass", "legume"])).toBe("melange_graminees_legumineuses");
    expect(coverFamilyOf(["crucifer", "legume"])).toBe("melange_cruciferes_legumineuses");
    expect(coverFamilyOf(["grass_oat_rye", "legume", "phacelia", "crucifer"])).toBeNull();
    expect(coverFamilyOf(["crucifer", "phacelia"])).toBeNull();
    expect(coverFamilyOf(["legume", "other"])).toBeNull();
    expect(coverFamilyOf([])).toBeNull();
  });
});

describe("utilisation par campagne (lot SE7)", () => {
  const line = (areaHa: number | null, kgPerHa: number | null, extra: Partial<SeedUsageLine> = {}): SeedUsageLine => ({
    areaHa,
    stock: kgPerHa === null || areaHa === null ? null : kgPerHa * areaHa,
    kg: kgPerHa === null || areaHa === null ? null : kgPerHa * areaHa,
    grains: null,
    kgPerHa,
    grainsPerM2: null,
    estimated: false,
    ...extra,
  });

  it("moyenne pondérée par la surface, écart minimum-maximum", () => {
    const f = summarizeSeedUsage([line(10, 180), line(5, 150)]);
    expect(f).toMatchObject({ interventions: 2, areaHa: 15, stockQuantity: 2550, kg: 2550, unconvertible: 0, estimated: false, grainsPerM2: null });
    expect(f.kgPerHa).toEqual({ mean: 170, min: 150, max: 180 });
  });

  it("dose non convertible : comptée sans bloquer ; estimée si un repère a servi ; sans stock par espèce", () => {
    const f = summarizeSeedUsage([line(10, 180, { estimated: true }), line(5, null)], false);
    expect(f).toMatchObject({ interventions: 2, areaHa: 15, stockQuantity: null, kg: 1800, unconvertible: 1, estimated: true });
    expect(f.kgPerHa).toEqual({ mean: 180, min: 180, max: 180 });
    expect(summarizeSeedUsage([])).toMatchObject({ interventions: 0, areaHa: 0, stockQuantity: null, kgPerHa: null });
  });

  it("sans surface connue : moyenne simple", () => {
    expect(summarizeSeedUsage([line(null, 100, { stock: 1 }), line(null, 200, { stock: 1 })]).kgPerHa).toEqual({ mean: 150, min: 100, max: 200 });
  });
});

/** Plants et unités canoniques (issue #130, claudedocs/conception_semences_unites.md §4). */
describe("plants comptés à l'unité", () => {
  it("plant, pièce, pied, motte, unity et unité", () => {
    for (const u of ["plant", "Plants", "pièce", "Pièces", "pied", "pieds", "motte", "Mottes", "unity", "unité", "Unités"]) {
      expect(parseSeedUnit(u), u).toEqual({ dim: "plant" });
    }
    expect(parseSeedUnit("graines")).toEqual({ dim: "grain", grains: 1 });
  });

  it("se convertissent entre eux seulement", () => {
    expect(convertSeedQuantity(12, "pièce", "plant")).toBe(12);
    expect(convertSeedQuantity(12, "plant", "kilogram", { tgwG: 300 })).toBeNull();
    expect(convertSeedQuantity(12, "plant", "grain")).toBeNull();
    expect(convertSeedQuantity(12, "dose", "plant", { grainsPerDose: 50_000 })).toBeNull();
    expect(seedConversionGap("plant", "kilogram", { tgwG: 300 })).toBe("dimension");
    expect(seedConversionGap("grain", "unity")).toBe("dimension");
    expect(seedConversionGap("unity", "plant")).toBeNull();
    expect(seedUnitChoices("plant")).toEqual(["plant"]);
    expect(seedUnitChoices("unity")).toEqual(["unity"]);
  });

  it("plantation : 8 000 plants/ha sur 1,5 ha = 12 000 plants", () => {
    expect(toStockQuantity({ quantity: 8_000, unit: "plant_per_hectare", articleUnit: "plant", areaHa: 1.5, seed: {} })).toBe(12_000);
    expect(seedEquivalents(8_000, "plant_per_hectare", {}, 1.5)).toEqual({
      grainsPerM2: null,
      grainsPerHa: null,
      dosesPerHa: null,
      kgPerHa: null,
      plantsPerHa: 8_000,
      plantsPerM2: 0.8,
    });
    expect(() => toStockQuantity({ quantity: 10, unit: "kilogram_per_hectare", articleUnit: "plant", areaHa: 1, seed: { tgwG: 300 } })).toThrow(/se comptent à la pièce/);
  });
});

describe("unité canonique d'une unité reprise", () => {
  it("les unités de la base de développement : même grandeur, facteur 1", () => {
    const cases: [string, string, number | null][] = [
      ["Sac de 50 000 grains", "dose", 50_000],
      ["sac de 50 000 grains", "dose", 50_000],
      ["Sac  de 50 000 grains", "dose", 50_000],
      ["Mille grains", "thousand", null],
      ["Mille graines", "thousand", null],
      ["1000 grains", "thousand", null],
      ["Kg", "kilogram", null],
      ["Kilogramme", "kilogram", null],
      ["graines", "grain", null],
      ["unity", "plant", null],
      ["Unité", "plant", null],
      ["Pièce", "plant", null],
    ];
    for (const [from, code, grainsPerDose] of cases) {
      expect(canonicalSeedUnit(from), from).toEqual({ code, grainsPerDose });
      expect(convertSeedQuantity(7, from, code, { grainsPerDose }), from).toBe(7);
    }
  });

  it("déjà canonique, inconnue ou sans équivalent de facteur 1 : rien", () => {
    for (const u of ["kilogram", "dose", "thousand", "grain", "plant"]) expect(canonicalSeedUnit(u), u).toBeNull();
    expect(canonicalSeedUnit("palette")).toBeNull();
    expect(canonicalSeedUnit("50 000 grains")).toBeNull();
    expect(canonicalSeedUnit("Tonne")).toBeNull();
  });

  it("dose : nombre de grains de la fiche, ou conflit", () => {
    expect(canonicalSeedUnit("Sac de 50 000 grains", 50_000)).toEqual({ code: "dose", grainsPerDose: 50_000 });
    expect(canonicalSeedUnit("Sac de 50 000 grains", 80_000)).toEqual({ conflict: { unitGrains: 50_000, sheetGrains: 80_000 } });
    expect(canonicalSeedUnit("Sac", 80_000)).toEqual({ code: "dose", grainsPerDose: 80_000 });
    expect(canonicalSeedUnit("Sac")).toEqual({ code: "dose", grainsPerDose: null });
  });
});

