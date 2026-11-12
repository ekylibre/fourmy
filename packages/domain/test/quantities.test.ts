import { describe, it, expect } from "vitest";
import { toStockQuantity, pickLot, DomainError, convertQuantity, inputUnitChoices } from "../src/index.js";

describe("quantité de stock d'un paramètre", () => {
  it("dose par hectare × surface traitée", () => {
    expect(toStockQuantity({ quantity: 2, unit: "liter_per_hectare", articleUnit: "liter", areaHa: 3.5 })).toBe(7);
  });
  it("quantité absolue fournie prioritaire", () => {
    expect(
      toStockQuantity({ quantity: 2, unit: "liter_per_hectare", articleUnit: "liter", areaHa: null, absolute: 5 }),
    ).toBe(5);
  });
  it("quantité directe dans l'unité de l'article", () => {
    expect(toStockQuantity({ quantity: 40, unit: "kilogram", articleUnit: "kilogram", areaHa: null })).toBe(40);
  });
  it("refuse les incohérences au lieu de deviner", () => {
    expect(() => toStockQuantity({ quantity: 2, unit: "kilogram_per_hectare", articleUnit: "liter", areaHa: 1 })).toThrow(DomainError);
    expect(() => toStockQuantity({ quantity: 2, unit: "liter_per_hectare", articleUnit: "liter", areaHa: null })).toThrow(DomainError);
    expect(() => toStockQuantity({ quantity: 2, unit: "kilogram", articleUnit: "liter", areaHa: null })).toThrow(DomainError);
    expect(() => toStockQuantity({ quantity: null, unit: null, articleUnit: "liter", areaHa: 1 })).toThrow(DomainError);
  });
});

describe("unité de saisie d'un intrant (engrais stocké en tonnes)", () => {
  it("120 kg/ha d'un engrais stocké en tonnes sur 2 ha : 0,24 t sortent du stock", () => {
    expect(toStockQuantity({ quantity: 120, unit: "Kilogramme_per_hectare", articleUnit: "Tonne", areaHa: 2 })).toBeCloseTo(0.24);
  });
  it("120 L/ha d'un engrais liquide stocké en tonnes, densité 1,4 : 0,168 t/ha", () => {
    expect(toStockQuantity({ quantity: 120, unit: "Litre_per_hectare", articleUnit: "Tonne", areaHa: 1, density: 1.4 })).toBeCloseTo(0.168);
  });
  it("litres sans densité connue pour un article en tonnes : refusé", () => {
    expect(() => toStockQuantity({ quantity: 120, unit: "Litre_per_hectare", articleUnit: "Tonne", areaHa: 1 })).toThrow(DomainError);
  });
  it("conversions : masse, volume, densité ; unités inconnues", () => {
    expect(convertQuantity(500, "Kilogramme", "Tonne")).toBeCloseTo(0.5);
    expect(convertQuantity(2, "m³", "Litre")).toBe(2000);
    expect(convertQuantity(100, "Litre", "Kilogramme", 1.3)).toBeCloseTo(130);
    expect(convertQuantity(130, "Kilogramme", "Litre", 1.3)).toBeCloseTo(100);
    expect(convertQuantity(3, "Sac de 50 000 grains", "Mille grains")).toBeNull();
    expect(convertQuantity(3, "Sac de 50 000 grains", "Sac de 50 000 grains")).toBe(3);
  });
  it("unités proposées : la sienne d'abord, le volume seulement avec une densité", () => {
    expect(inputUnitChoices("Tonne")).toEqual(["Tonne", "Kilogramme"]);
    expect(inputUnitChoices("Tonne", 1.4)).toEqual(["Tonne", "Kilogramme", "Litre", "m³"]);
    expect(inputUnitChoices("Litre")).toEqual(["Litre", "m³"]);
    expect(inputUnitChoices("Mille grains")).toEqual(["Mille grains"]);
  });
});

describe("choix du lot consommé", () => {
  it("prend le lot le mieux pourvu, ignore les lots vides", () => {
    expect(pickLot([{ lotId: "a", available: 3 }, { lotId: "b", available: 10 }, { lotId: "c", available: -2 }])).toBe("b");
    expect(pickLot([{ lotId: "a", available: 0 }])).toBeNull();
  });
});
