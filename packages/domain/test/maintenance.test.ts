import { describe, it, expect } from "vitest";
import { addMonths, compareDues, computeDue, dueLabel, type DueContext, type PlanOperationLike } from "../src/maintenance.js";
import { usageSeries } from "../src/meter.js";

const series = usageSeries([
  { id: "r1", readAt: "2026-03-01T00:00:00.000Z", value: 4000 },
  { id: "r2", readAt: "2026-09-01T00:00:00.000Z", value: 4300 },
  { id: "r3", readAt: "2026-11-01T00:00:00.000Z", value: 4480 },
]);
const ctx = (over: Partial<DueContext> = {}): DueContext => ({
  completions: [],
  series,
  options: [],
  commissionedAt: null,
  at: "2026-11-08T00:00:00.000Z",
  soonHours: 50,
  soonMonths: 1,
  ...over,
});
const oil: PlanOperationLike = { id: "oil", everyHours: 500, everyMonths: 12 };

describe("échéances", () => {
  it("sans réalisation ni mise en service : à renseigner", () => {
    expect(computeDue(oil, ctx())).toMatchObject({ status: "unknown", reason: "Dernière réalisation à renseigner." });
  });

  it("heures ou mois, au premier terme atteint", () => {
    // Vidange à 4 000 h le 01/03 : prochaine à 4 500 h ou le 01/03/2027 ; 4 480 h aujourd'hui → bientôt (20 h).
    const d = computeDue(oil, ctx({ completions: [{ operationId: "oil", at: "2026-03-01T00:00:00.000Z", usage: 4000 }] }));
    expect(d).toMatchObject({ status: "soon", nextUsage: 4500, remainingHours: 20, nextDate: "2027-03-01T00:00:00.000Z" });
    expect(dueLabel(d)).toBe("dans 20 h ou le 01/03/2027");
    // Faite à 4 300 h le 01/09/2025 : la date passe avant les heures.
    const late = computeDue(oil, ctx({ completions: [{ operationId: "oil", at: "2025-09-01T00:00:00.000Z", usage: 3700 }] }));
    expect(late.status).toBe("overdue");
  });

  it("réalisation sans relevé : heures interpolées entre deux relevés", () => {
    const d = computeDue({ id: "oil", everyHours: 500 }, ctx({ completions: [{ operationId: "oil", at: "2026-06-01T00:00:00.000Z", usage: null }] }));
    expect(d.last?.usage).toBe(4150); // 01/06 : mi-chemin entre 4 000 h (01/03) et 4 300 h (01/09)
    expect(d.status).toBe("ok");
  });

  it("dernière fois connue (baseline) et mise en service", () => {
    expect(computeDue({ ...oil, baselineAt: "2026-07-01T00:00:00.000Z", baselineHours: 4100 }, ctx())).toMatchObject({ status: "ok", nextUsage: 4600, last: { source: "baseline" } });
    expect(computeDue({ id: "x", everyHours: 4000 }, ctx({ commissionedAt: "2015-01-01T00:00:00.000Z" }))).toMatchObject({ status: "overdue", last: { source: "commissioning", usage: 0 } });
  });

  it("rejouée à une date passée : les réalisations futures sont ignorées", () => {
    const c = ctx({ at: "2026-09-02T00:00:00.000Z", completions: [{ operationId: "oil", at: "2026-10-01T00:00:00.000Z", usage: 4400 }] });
    expect(computeDue(oil, c).status).toBe("unknown");
  });

  it("option non montée, visite initiale passée, selon besoin", () => {
    expect(computeDue({ id: "pdf", everyHours: 500, requiresOption: "front_pto" }, ctx()).status).toBe("not_applicable");
    expect(computeDue({ id: "pdf", everyHours: 500, requiresOption: "front_pto", baselineAt: "2026-07-01T00:00:00.000Z", baselineHours: 4200 }, ctx({ options: [{ code: "front_pto", from: "2020-01-01T00:00:00.000Z", to: null }] })).status).toBe("ok");
    expect(computeDue({ id: "v100", firstHours: 100 }, ctx())).toMatchObject({ status: "not_applicable", reason: "Visite antérieure au premier relevé connu." });
    expect(computeDue({ id: "clim" }, ctx()).status).toBe("on_demand");
  });

  it("trie par urgence", () => {
    const ops = [
      { op: { id: "a", everyHours: 100 }, due: computeDue({ id: "a", everyHours: 100, baselineAt: "2026-10-01T00:00:00.000Z", baselineHours: 4450 }, ctx()) },
      { op: oil, due: computeDue(oil, ctx()) },
      { op: { id: "b", everyHours: 10 }, due: computeDue({ id: "b", everyHours: 10, baselineAt: "2026-10-01T00:00:00.000Z", baselineHours: 4300 }, ctx()) },
    ];
    // En retard, puis à renseigner, puis à jour.
    expect(ops.sort(compareDues).map((o) => o.op.id)).toEqual(["b", "oil", "a"]);
  });

  it("ajoute des mois sans déborder", () => {
    expect(addMonths("2026-01-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z");
  });
});
