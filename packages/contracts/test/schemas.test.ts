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
