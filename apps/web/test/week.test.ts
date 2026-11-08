import type { Intervention } from "@fourmy/contracts";
import { demoInterventions } from "@fourmy/mocks";
import { addDays, inWeek, slots, weekLabel, weekOf } from "../src/features/interventions/week";

const base = demoInterventions[0]! as Intervention;

describe("semaine de la frise", () => {
  it("va du lundi au dimanche, le dimanche compris", () => {
    expect(weekOf("2025-09-24")).toMatchObject({ start: "2025-09-22", end: "2025-09-28" });
    expect(weekOf("2025-09-28").start).toBe("2025-09-22"); // dimanche
    expect(weekOf("2025-09-22").start).toBe("2025-09-22"); // lundi
    expect(weekOf("2025-09-24").days).toHaveLength(7);
  });

  it("enjambe un changement d'heure et une fin d'année", () => {
    expect(weekOf("2025-10-26")).toMatchObject({ start: "2025-10-20", end: "2025-10-26" }); // passage à l'heure d'hiver
    expect(weekOf("2026-01-01")).toMatchObject({ start: "2025-12-29", end: "2026-01-04" });
    expect(addDays("2025-03-30", 1)).toBe("2025-03-31");
  });

  it("libellé lisible", () => {
    expect(weekLabel(weekOf("2025-09-24"))).toBe("du 22 au 28 sept. 2025");
    expect(weekLabel(weekOf("2025-10-01"))).toBe("du 29 sept. au 5 oct. 2025");
    expect(weekLabel(weekOf("2026-01-01"))).toBe("du 29 déc. 2025 au 4 janv. 2026");
  });

  it("une intervention sur plusieurs périodes a un créneau par jour travaillé", () => {
    const vine = {
      ...base,
      periods: [
        { startedAt: "2025-09-26T06:00:00.000Z", stoppedAt: "2025-09-26T10:00:00.000Z" },
        { startedAt: "2025-09-29T06:00:00.000Z", stoppedAt: "2025-09-29T10:00:00.000Z" },
      ],
    };
    expect(slots(vine).map((s) => s.day)).toEqual(["2025-09-26", "2025-09-29"]);
    expect(inWeek(vine, weekOf("2025-09-24"))).toBe(true);
    expect(inWeek(vine, weekOf("2025-10-01"))).toBe(true);
    expect(inWeek(vine, weekOf("2025-10-08"))).toBe(false);
  });

  it("une intervention planifiée sans période apparaît à sa date prévue", () => {
    const planned = { ...base, status: "planned" as const, periods: [], startedAt: "2025-09-30T08:00:00.000Z", stoppedAt: null };
    expect(slots(planned)).toEqual([{ day: "2025-09-30", startedAt: "2025-09-30T08:00:00.000Z", stoppedAt: null }]);
  });
});
