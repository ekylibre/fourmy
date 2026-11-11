import { describe, it, expect } from "vitest";
import type { StockMovement } from "@fourmy/contracts";
import { assertEditable, diffIntervention, displayStatus, effectiveMovements, type EditableIntervention } from "../src/index.js";

const PHYTO = "00000000-0000-7000-8000-000000000001";
const PARCEL = "00000000-0000-7000-8000-0000000000a1";
const LOT = "00000000-0000-7000-8000-0000000000c1";
const PLACE = "00000000-0000-7000-8000-0000000000d1";

const base: EditableIntervention = {
  procedure: "spraying",
  periods: [{ startedAt: "2026-06-10T08:00:00.000Z", stoppedAt: "2026-06-10T09:00:00.000Z" }],
  targets: [{ kind: "land_parcel", id: PARCEL }],
  inputs: [{ articleId: PHYTO, quantity: 2, per: "hectare", unit: "liter" } as { articleId: string; quantity: number; per: "hectare" }],
  outputs: [],
  tools: [],
  doers: [],
  purposes: ["fungicide"],
  notes: null,
};

describe("diffIntervention", () => {
  it("irrigation : la dose se compare, absente égale à null", () => {
    const w = { ...base, procedure: "watering", inputs: [], purposes: [], irrigation: { depthMm: 30, method: "reel" } };
    expect(diffIntervention(w, { ...w, irrigation: { depthMm: 25, method: "reel" } }).irrigation).toEqual({
      before: { depthMm: 30, method: "reel" },
      after: { depthMm: 25, method: "reel" },
    });
    expect(() => diffIntervention({ ...w, irrigation: null }, { ...w, irrigation: undefined })).toThrow(/ne change rien/);
  });

  it("ne retient que les champs modifiés, avec l'avant et l'après", () => {
    const changes = diffIntervention(base, { ...base, inputs: [{ articleId: PHYTO, quantity: 1.5, per: "hectare" }] });
    expect(Object.keys(changes)).toEqual(["inputs"]);
    expect(changes.inputs).toEqual({
      before: [{ articleId: PHYTO, per: "hectare", quantity: 2 }],
      after: [{ articleId: PHYTO, per: "hectare", quantity: 1.5 }],
    });
  });

  it("ignore l'unité d'affichage, le format des dates et les notes vides", () => {
    const same = {
      ...base,
      periods: [{ startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T09:00:00Z" }],
      inputs: [{ per: "hectare" as const, quantity: 2, articleId: PHYTO }],
      notes: "  ",
    };
    expect(() => diffIntervention(base, same)).toThrow(/ne change rien/);
  });

  it("détecte un changement de procédure et de notes", () => {
    const changes = diffIntervention(base, { ...base, procedure: "generic_spraying", notes: "vent faible" });
    expect(changes.procedure).toEqual({ before: "spraying", after: "generic_spraying" });
    expect(changes.notes).toEqual({ before: null, after: "vent faible" });
  });
});

describe("effectiveMovements", () => {
  const m = (quantity: number, cause: StockMovement["cause"], occurredAt = "2026-06-10T09:00:00.000Z"): StockMovement => ({
    id: crypto.randomUUID(),
    farmId: "00000000-0000-7000-8000-0000000000f1",
    lotId: LOT,
    placeId: PLACE,
    containerId: null,
    quantity,
    unit: "liter",
    occurredAt,
    cause,
    interventionId: "00000000-0000-7000-8000-0000000000e1",
    createdAt: "2026-06-10T10:00:00.000Z",
  });

  it("une intervention jamais corrigée : ses mouvements tels quels", () => {
    expect(effectiveMovements([m(-2, "intervention")])).toEqual([expect.objectContaining({ quantity: -2 })]);
  });

  it("après une correction : seul le solde reste à contre-passer (pas de double correction)", () => {
    // 2 L sortis, contre-passés, puis 1,5 L sortis (première correction).
    const history = [m(-2, "intervention"), m(2, "adjustment"), m(-1.5, "intervention")];
    expect(effectiveMovements(history)).toEqual([expect.objectContaining({ quantity: -1.5, cause: "intervention" })]);
  });

  it("dates différentes (correction des périodes) : soldes séparés ; solde nul retiré", () => {
    const history = [m(-2, "intervention"), m(2, "adjustment"), m(-2, "intervention", "2026-06-12T09:00:00.000Z")];
    const left = effectiveMovements(history);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ quantity: -2, occurredAt: "2026-06-12T09:00:00.000Z" });
  });

  it("arrondit les résidus de calcul flottant", () => {
    expect(effectiveMovements([m(-0.1, "intervention"), m(-0.2, "intervention"), m(0.3, "adjustment")])).toEqual([]);
  });
});

describe("statut", () => {
  const now = "2026-06-10T08:30:00.000Z";
  it("en cours : planifiée dont la période a commencé", () => {
    expect(displayStatus({ status: "planned", startedAt: "2026-06-10T08:00:00.000Z" }, now)).toBe("in_progress");
    expect(displayStatus({ status: "planned", startedAt: "2026-06-11T08:00:00.000Z" }, now)).toBe("planned");
    expect(displayStatus({ status: "planned", startedAt: null }, now)).toBe("planned");
    expect(displayStatus({ status: "done", startedAt: "2026-06-01T08:00:00.000Z" }, now)).toBe("done");
  });
  it("une intervention annulée ne se modifie pas", () => {
    expect(() => assertEditable("cancelled")).toThrow(/annulée/);
    expect(() => assertEditable("done")).not.toThrow();
  });
});
