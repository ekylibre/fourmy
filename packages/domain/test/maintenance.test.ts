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

import { estimateGap, operatingHoursByDay, usageAt as usageAtL } from "../src/meter.js";
import { partsForecast } from "../src/maintenance.js";

describe("heures estimées (Traccar, lot L)", () => {
  it("durée de fonctionnement par jour : en mouvement ou au travail, écarts plafonnés", () => {
    const p = (t: string, speedKmh: number, working: boolean | null = null) => ({ time: `2026-11-03T${t}:00.000Z`, speedKmh, working });
    const days = operatingHoursByDay([p("08:00", 0), p("08:01", 8), p("08:31", 9), p("09:31", 7), p("12:00", 0), p("12:30", 0)]);
    // 08:00→08:01 (1 min) + 08:01→08:31 (30 min, plafonné à 5) + 08:31→09:31 (plafonné à 5) + 09:31→12:00 (plafonné à 5)
    expect(days).toEqual([{ day: "2026-11-03", hours: 0.27 }]);
  });

  it("le dernier relevé réel + les heures estimées depuis ; un écart est signalé", () => {
    const s = usageSeries([{ id: "r1", readAt: "2026-11-01T18:00:00.000Z", value: 4300 }]);
    const days = [
      { day: "2026-11-01", hours: 5 }, // jour du relevé : déjà compté dans le relevé
      { day: "2026-11-02", hours: 6 },
      { day: "2026-11-03", hours: 4 },
    ];
    expect(usageAtL(s, "2026-11-03T20:00:00.000Z", days)).toMatchObject({ usage: 4310, kind: "estimated", estimatedHours: 10 });
    const withManual = usageSeries([{ id: "r1", readAt: "2026-11-01T18:00:00.000Z", value: 4300 }, { id: "r2", readAt: "2026-11-04T08:00:00.000Z", value: 4340 }]);
    expect(estimateGap(withManual, days, { id: "r2", readAt: "2026-11-04T08:00:00.000Z", usage: 4340 })).toMatchObject({ estimated: 4310, gap: 30, flagged: true });
    expect(estimateGap(withManual, days, { id: "r2", readAt: "2026-11-04T08:00:00.000Z", usage: 4312 })).toMatchObject({ flagged: false });
    // Recalage : après le relevé manuel, seules les heures des jours suivants s'ajoutent.
    expect(usageAtL(withManual, "2026-11-05T20:00:00.000Z", [...days, { day: "2026-11-05", hours: 3 }])).toMatchObject({ usage: 4343 });
  });
});

describe("pièces à commander", () => {
  it("compte les opérations qui tombent dans l'horizon, autant de fois qu'elles reviennent", () => {
    const due = (remainingHours: number, status = "ok") => ({ ...computeDue({ id: "x" }, ctx()), status, remainingHours, remainingDays: null }) as never;
    const lines = partsForecast(
      [
        { op: { id: "a", label: "Filtre gasoil", everyHours: 100 }, due: due(30), parts: [{ articleId: "f", quantity: 1 }] },
        { op: { id: "b", label: "Vidange", everyHours: 500 }, due: due(250), parts: [{ articleId: "f", quantity: 2 }, { articleId: "j", quantity: 1 }] },
        { op: { id: "c", label: "Courroie", everyHours: 2000 }, due: due(900), parts: [{ articleId: "c", quantity: 1 }] },
        { op: { id: "d", label: "Freins", everyHours: 1000 }, due: due(-5, "overdue"), parts: [{ articleId: "p", quantity: 4 }] },
      ],
      { hours: 200 },
      4,
    );
    expect(lines).toEqual([
      { articleId: "f", needed: 2, operations: ["Filtre gasoil"] }, // à 30 h puis 130 h
      { articleId: "p", needed: 4, operations: ["Freins"] },
    ]);
  });
});
