import { describe, it, expect } from "vitest";
import { landParcelWrite, stockMovement, cloudEvent, snapshot } from "../src/index.js";

describe("contracts", () => {
  it("valide une écriture de parcelle minimale", () => {
    const r = landParcelWrite.safeParse({
      name: "Les Rouffiats",
      shape: { type: "MultiPolygon", coordinates: [] },
    });
    expect(r.success).toBe(true);
  });

  it("refuse un mouvement de stock sans unité", () => {
    const r = stockMovement.safeParse({
      id: crypto.randomUUID(),
      farmId: crypto.randomUUID(),
      lotId: crypto.randomUUID(),
      placeId: null,
      containerId: null,
      quantity: -5,
      occurredAt: new Date().toISOString(),
      cause: "intervention",
      interventionId: null,
      createdAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("applique les valeurs par défaut CloudEvents", () => {
    const r = cloudEvent.parse({
      id: crypto.randomUUID(),
      type: "stock.moved",
      source: "fourmy/api",
      time: new Date().toISOString(),
      farmid: crypto.randomUUID(),
      data: {},
    });
    expect(r.specversion).toBe("1.0");
  });

  it("type un snapshot vide", () => {
    const r = snapshot.safeParse({
      at: new Date().toISOString(),
      landParcels: [],
      productions: [],
      places: [],
      containers: [],
      equipments: [],
    });
    expect(r.success).toBe(true);
  });
});

describe("reliquat d'azote (lot AF)", () => {
  it("nitrates sur toute la profondeur, ammonium sur 0-40 cm", async () => {
    const { rshTotal } = await import("../src/index.js");
    // 20 + 15 + 10 de nitrates ; ammonium : 9 (0-30) + 6 × 1/3 (30-40) ; rien sous 40 cm.
    expect(rshTotal([{ fromCm: 0, toCm: 30, no3KgHa: 20, nh4KgHa: 9 }, { fromCm: 30, toCm: 60, no3KgHa: 15, nh4KgHa: 6 }, { fromCm: 60, toCm: 90, no3KgHa: 10, nh4KgHa: 3 }])).toBe(56);
  });
});
