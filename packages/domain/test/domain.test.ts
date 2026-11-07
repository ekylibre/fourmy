import { describe, it, expect } from "vitest";
import type { StockMovement, LotLineage } from "@fourmy/contracts";
import {
  planVersionChange,
  validAt,
  DomainError,
  signedQuantity,
  planInterventionCompletion,
  planCorrection,
  computeStock,
  computeContainerContents,
  resolveComposition,
  type DomainCtx,
} from "../src/index.js";

let seq = 0;
const ctx: DomainCtx = {
  now: "2026-06-15T10:00:00.000Z",
  newId: () => `id-${++seq}`,
  actor: "u1",
  origin: "web",
};

const mv = (p: Partial<StockMovement>): StockMovement => ({
  id: "m",
  farmId: "f",
  lotId: "lot",
  placeId: null,
  containerId: null,
  quantity: 0,
  unit: "L",
  occurredAt: "2026-01-01T00:00:00.000Z",
  cause: "intervention",
  interventionId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...p,
});

describe("temps", () => {
  it("clôt la version courante et en ouvre une nouvelle", () => {
    const change = planVersionChange(
      { valid: { lower: "2024-01-01T00:00:00.000Z", upper: null } },
      "2026-06-15T10:00:00.000Z",
    );
    expect(change.close?.upper).toBe("2026-06-15T10:00:00.000Z");
    expect(change.openFrom).toBe("2026-06-15T10:00:00.000Z");
  });

  it("refuse de versionner avant le début de la version courante", () => {
    expect(() =>
      planVersionChange(
        { valid: { lower: "2024-01-01T00:00:00.000Z", upper: null } },
        "2023-01-01T00:00:00.000Z",
      ),
    ).toThrow(DomainError);
  });

  it("ouvre une première version sans clôture", () => {
    expect(planVersionChange(null, ctx.now).close).toBeNull();
  });

  it("validAt borne inférieure incluse, supérieure exclue", () => {
    const v = { valid: { lower: "2024-01-01T00:00:00.000Z", upper: "2025-01-01T00:00:00.000Z" } };
    expect(validAt(v, "2024-06-01T00:00:00.000Z")).toBe(true);
    expect(validAt(v, "2025-01-01T00:00:00.000Z")).toBe(false);
  });
});

describe("interventions", () => {
  it("un intrant sort du stock, une sortie entre", () => {
    expect(signedQuantity("input", 5)).toBe(-5);
    expect(signedQuantity("output", 5)).toBe(5);
    expect(() => signedQuantity("tool", 1)).toThrow(DomainError);
  });

  it("réalise une intervention : mouvements signés + audit + événement", () => {
    const plan = planInterventionCompletion(ctx, {
      farmId: "f",
      interventionId: "i1",
      startedAt: "2026-06-15T08:00:00.000Z",
      stoppedAt: "2026-06-15T09:00:00.000Z",
      lines: [
        { role: "input", lotId: "phyto", placeId: "hangar", containerId: null, quantity: 3, unit: "L" },
        { role: "output", lotId: "moût", placeId: null, containerId: "cuve1", quantity: 100, unit: "L" },
      ],
    });
    expect(plan.movements.map((m) => m.quantity)).toEqual([-3, 100]);
    expect(plan.event.type).toBe("intervention.completed");
    expect(plan.audit.action).toBe("completed");
  });

  it("refuse une fin antérieure au début", () => {
    expect(() =>
      planInterventionCompletion(ctx, {
        farmId: "f",
        interventionId: "i1",
        startedAt: "2026-06-15T09:00:00.000Z",
        stoppedAt: "2026-06-15T08:00:00.000Z",
        lines: [],
      }),
    ).toThrow(DomainError);
  });

  it("corrige par contre-passation (quantités opposées, cause adjustment)", () => {
    const original = [mv({ quantity: -3, lotId: "phyto" }), mv({ quantity: 100, lotId: "moût" })];
    const plan = planCorrection(ctx, "f", "i1", original);
    expect(plan.movements.map((m) => m.quantity)).toEqual([3, -100]);
    expect(plan.movements.every((m) => m.cause === "adjustment")).toBe(true);
    expect(plan.event.type).toBe("intervention.corrected");
  });
});

describe("stocks", () => {
  it("somme les mouvements jusqu'à la date, ignore le futur", () => {
    const movements = [
      mv({ lotId: "a", placeId: "p", quantity: 100, occurredAt: "2026-01-01T00:00:00.000Z" }),
      mv({ lotId: "a", placeId: "p", quantity: -30, occurredAt: "2026-03-01T00:00:00.000Z" }),
      mv({ lotId: "a", placeId: "p", quantity: -50, occurredAt: "2026-09-01T00:00:00.000Z" }),
    ];
    const atJune = computeStock(movements, "2026-06-15T00:00:00.000Z");
    expect(atJune).toHaveLength(1);
    expect(atJune[0]!.quantity).toBe(70);
  });

  it("cuve multi-lots : volume et parts", () => {
    const movements = [
      mv({ containerId: "c", lotId: "merlot", quantity: 300, occurredAt: "2025-10-01T00:00:00.000Z" }),
      mv({ containerId: "c", lotId: "cabernet", quantity: 100, occurredAt: "2025-10-02T00:00:00.000Z" }),
    ];
    const contents = computeContainerContents("c", movements, "2026-06-15T00:00:00.000Z");
    expect(contents.volumeL).toBe(400);
    const merlot = contents.composition.find((p) => p.lotId === "merlot");
    expect(merlot?.share).toBeCloseTo(0.75);
  });

  it("assemblage : remonte aux lots d'origine via la filiation", () => {
    const lineage: LotLineage[] = [
      { id: "l1", childLotId: "assemblage", parentLotId: "merlot", share: 0.6 },
      { id: "l2", childLotId: "assemblage", parentLotId: "cabernet", share: 0.4 },
    ];
    const comp = resolveComposition("assemblage", lineage);
    expect(comp.merlot).toBeCloseTo(0.6);
    expect(comp.cabernet).toBeCloseTo(0.4);
  });

  it("assemblage récursif d'assemblages", () => {
    const lineage: LotLineage[] = [
      { id: "l1", childLotId: "final", parentLotId: "a1", share: 0.5 },
      { id: "l2", childLotId: "final", parentLotId: "merlot", share: 0.5 },
      { id: "l3", childLotId: "a1", parentLotId: "merlot", share: 0.5 },
      { id: "l4", childLotId: "a1", parentLotId: "syrah", share: 0.5 },
    ];
    const comp = resolveComposition("final", lineage);
    // merlot = 0.5 (direct) + 0.5*0.5 (via a1) = 0.75 ; syrah = 0.25
    expect(comp.merlot).toBeCloseTo(0.75);
    expect(comp.syrah).toBeCloseTo(0.25);
  });
});

import { planStateCorrection } from "../src/index.js";

describe("corrections", () => {
  const base = { farmId: "f", entity: "container_versions", entityId: "v1" };
  it("trace l'avant, l'après et le motif", () => {
    const plan = planStateCorrection(ctx, {
      ...base,
      before: { capacityL: 100000, kind: "tank" },
      patch: { capacityL: 1000 },
      reason: "saisie en hl au lieu de L",
    });
    expect(plan.after).toEqual({ capacityL: 1000, kind: "tank" });
    expect(plan.audit.action).toBe("corrected");
    expect(plan.audit.diff).toEqual({
      reason: "saisie en hl au lieu de L",
      changes: { capacityL: { before: 100000, after: 1000 } },
    });
  });
  it("refuse une correction sans motif ou sans effet", () => {
    expect(() =>
      planStateCorrection(ctx, { ...base, before: { capacityL: 1 }, patch: { capacityL: 2 }, reason: " " }),
    ).toThrow(DomainError);
    expect(() =>
      planStateCorrection(ctx, { ...base, before: { capacityL: 1 }, patch: { capacityL: 1 }, reason: "rien" }),
    ).toThrow(DomainError);
  });
});
