import { describe, it, expect } from "vitest";
import { toStockQuantity, pickLot, DomainError } from "../src/index.js";

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

describe("choix du lot consommé", () => {
  it("prend le lot le mieux pourvu, ignore les lots vides", () => {
    expect(pickLot([{ lotId: "a", available: 3 }, { lotId: "b", available: 10 }, { lotId: "c", available: -2 }])).toBe("b");
    expect(pickLot([{ lotId: "a", available: 0 }])).toBeNull();
  });
});
