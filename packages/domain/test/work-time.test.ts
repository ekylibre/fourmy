import { describe, it, expect } from "vitest";
import { campaignWindow, lastMonths, monthOf, parisMidnight, weekOf, workTime, workTimeBuckets } from "../src/work-time.js";

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 5, 6); // 05/10/2026 08:00 à Paris

describe("temps de travaux", () => {
  it("plages disjointes : somme ; parts égales au total", () => {
    const r = workTime([
      { interventionId: "a", from: t0, to: t0 + 2 * H },
      { interventionId: "b", from: t0 + 3 * H, to: t0 + 4 * H },
    ]);
    expect(r.totalS).toBe(3 * 3600);
    expect(Object.fromEntries(r.byIntervention)).toEqual({ a: 7200, b: 3600 });
  });

  it("chevauchement : compté une fois, partagé entre les interventions", () => {
    const r = workTime([
      { interventionId: "a", from: t0, to: t0 + 2 * H },
      { interventionId: "b", from: t0 + 1 * H, to: t0 + 3 * H },
    ]);
    expect(r.totalS).toBe(3 * 3600);
    expect(Object.fromEntries(r.byIntervention)).toEqual({ a: 1.5 * 3600, b: 1.5 * 3600 });
    const sum = [...r.byIntervention.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBe(r.totalS);
  });

  it("plage incluse, plages identiques, deux plages d'une même intervention qui se chevauchent", () => {
    expect(workTime([{ interventionId: "a", from: t0, to: t0 + 4 * H }, { interventionId: "b", from: t0 + H, to: t0 + 2 * H }]).totalS).toBe(4 * 3600);
    const same = workTime([{ interventionId: "a", from: t0, to: t0 + H }, { interventionId: "b", from: t0, to: t0 + H }]);
    expect(Object.fromEntries(same.byIntervention)).toEqual({ a: 1800, b: 1800 });
    const self = workTime([{ interventionId: "a", from: t0, to: t0 + 2 * H }, { interventionId: "a", from: t0 + H, to: t0 + 3 * H }]);
    expect(self.totalS).toBe(3 * 3600);
    expect(self.byIntervention.get("a")).toBe(3 * 3600);
  });

  it("découpage par mois : une plage à cheval sur deux mois (heure de Paris)", () => {
    const night = parisMidnight("2026-11-01");
    const r = workTimeBuckets([{ interventionId: "a", from: night - 2 * H, to: night + 3 * H }], [
      { key: "10", ...monthOf("2026-10-15") },
      { key: "11", ...monthOf("2026-11-15") },
    ]);
    expect(r).toEqual({ "10": 2 * 3600, "11": 3 * 3600 });
  });

  it("fenêtres : minuit à Paris l'été et l'hiver, semaine du lundi, 12 mois, campagne", () => {
    expect(new Date(parisMidnight("2026-07-01")).toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(new Date(parisMidnight("2026-12-01")).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    // Changement d'heure (25/10/2026) : le mois d'octobre fait 31 jours et une heure.
    const oct = monthOf("2026-10-05");
    expect((oct.to - oct.from) / H).toBe(31 * 24 + 1);
    expect(weekOf("2026-10-08")).toMatchObject({ fromDay: "2026-10-05", toDay: "2026-10-12" });
    expect(weekOf("2026-10-11")).toMatchObject({ fromDay: "2026-10-05" });
    const months = lastMonths("2026-10-05", 12);
    expect(months.map((m) => m.month)).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(campaignWindow("2026-01-01", "2026-12-31")).toMatchObject({ fromDay: "2026-01-01", toDay: "2027-01-01" });
  });
});
