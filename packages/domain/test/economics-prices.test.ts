import { describe, it, expect } from "vitest";
import { priceKey, type Price } from "@fourmy/contracts";
import { convertPrice, currentPrices, priceAt } from "../src/index.js";

/** Prix datés (temps 3, lot E1). */
const p = (over: Partial<Price>): Price => ({
  id: crypto.randomUUID(),
  kind: "article",
  articleId: "a",
  equipmentId: null,
  activityId: null,
  product: null,
  procedure: null,
  unit: "ton",
  amount: 500,
  validFrom: "2026-01-01",
  source: "farm",
  sourceRef: null,
  sourceDate: null,
  note: null,
  createdAt: "2026-01-01T10:00:00Z",
  ...over,
});

describe("prix datés", () => {
  const list = [p({ amount: 500 }), p({ amount: 580, validFrom: "2026-11-01" }), p({ amount: 590, validFrom: "2026-11-01", createdAt: "2026-11-02T08:00:00Z" }), p({ articleId: "b", amount: 12, unit: "liter" })];
  const key = priceKey(list[0]!);

  it("en vigueur à une date : dernière date d'effet, puis dernière saisie", () => {
    expect(priceAt(list, key, "2026-06-30")!.amount).toBe(500);
    expect(priceAt(list, key, "2026-11-15")!.amount).toBe(590);
    expect(priceAt(list, key, "2025-12-31")).toBeNull();
    expect(currentPrices(list, "2026-12-01").size).toBe(2);
  });

  it("conversions : €/t → €/q, €/kg → €/t, €/L ↔ €/kg par la densité, semences par le PMG", () => {
    expect(convertPrice(580, "ton", "quintal")).toBeCloseTo(58, 9);
    expect(convertPrice(0.6, "kilogram", "ton")).toBeCloseTo(600, 9);
    expect(convertPrice(1.2, "liter", "kilogram", { density: 1.2 })).toBeCloseTo(1, 9);
    expect(convertPrice(1.2, "liter", "kilogram")).toBeNull();
    expect(convertPrice(200, "Tonne", "Kilogramme")).toBeCloseTo(0.2, 9);
    // Dose de 50 000 grains à 100 € ; PMG 300 g : 1 kg = 3 333 grains = 0,0667 dose = 6,67 €.
    expect(convertPrice(100, "dose", "kilogram", { seed: { tgwG: 300, grainsPerDose: 50_000 } })).toBeCloseTo(6.667, 2);
    expect(convertPrice(10, "hour", "hectare")).toBeNull();
  });
});
