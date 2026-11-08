import { describe, it, expect } from "vitest";
import { checkReading, readingCheckMessage, usageAt, usageSeries, type MeterReadingLike } from "../src/meter.js";

const r = (id: string, day: string, value: number, extra: Partial<MeterReadingLike> = {}): MeterReadingLike => ({
  id,
  readAt: `2026-${day}T12:00:00.000Z`,
  value,
  ...extra,
});

describe("échelle d'usage", () => {
  it("cumule les heures d'un compteur", () => {
    const s = usageSeries([r("b", "03-01", 4300), r("a", "01-01", 4200)]);
    expect(s.map((p) => [p.reading.id, p.usage])).toEqual([["a", 4200], ["b", 4300]]);
  });

  it("un compteur remplacé continue l'échelle", () => {
    const s = usageSeries([r("a", "01-01", 4200), r("b", "02-01", 4250), r("c", "02-02", 0, { correction: "replacement", correctionReason: "compteur HS" }), r("d", "03-01", 40)]);
    expect(s.map((p) => p.usage)).toEqual([4200, 4250, 4250, 4290]);
  });

  it("une correction écarte la saisie fausse qui la précède", () => {
    const s = usageSeries([r("a", "01-01", 4200), r("typo", "02-01", 42500), r("fix", "02-02", 4260, { correction: "fix", correctionReason: "faute de frappe" }), r("d", "03-01", 4300)]);
    expect(s.find((p) => p.reading.id === "typo")!.status).toBe("superseded");
    expect(s.filter((p) => p.status === "valid").map((p) => p.usage)).toEqual([4200, 4260, 4300]);
  });
});

describe("contrôle d'un relevé", () => {
  const existing = [r("a", "01-01", 4200), r("b", "03-01", 4300)];

  it("refuse une valeur inférieure au précédent, même saisie après coup", () => {
    const c = checkReading(existing, r("n", "04-01", 4290));
    expect(c).toMatchObject({ ok: false, code: "below_previous", neighbour: { id: "b" } });
    expect(readingCheckMessage(c)).toContain("4300 h");
    expect(checkReading(existing, r("n", "02-01", 4310))).toMatchObject({ ok: false, code: "above_next", neighbour: { id: "b" } });
    expect(checkReading(existing, r("n", "02-01", 4250))).toEqual({ ok: true });
  });

  it("une correction passe si elle est motivée", () => {
    expect(checkReading(existing, r("n", "04-01", 10, { correction: "replacement" }))).toMatchObject({ ok: false, code: "reason_required" });
    expect(checkReading(existing, r("n", "04-01", 10, { correction: "replacement", correctionReason: "compteur neuf" }))).toEqual({ ok: true });
  });

  it("signale un compteur qui avance plus vite que l'horloge", () => {
    expect(checkReading(existing, r("n", "03-02", 4400))).toMatchObject({ ok: true, warning: { code: "too_fast", hours: 100 } });
  });

  it("modifier un relevé ne le compare pas à lui-même", () => {
    expect(checkReading(existing, r("b", "03-01", 4290))).toEqual({ ok: true });
  });
});

describe("heures d'usage à une date", () => {
  const s = usageSeries([r("a", "01-01", 4200), r("b", "01-11", 4300)]);
  it("interpole entre deux relevés, garde le dernier ensuite", () => {
    expect(usageAt(s, "2026-01-06T12:00:00.000Z")).toMatchObject({ usage: 4250, kind: "interpolated" });
    expect(usageAt(s, "2026-01-11T12:00:00.000Z")).toMatchObject({ usage: 4300, kind: "read" });
    expect(usageAt(s, "2026-05-01T00:00:00.000Z")).toMatchObject({ usage: 4300, kind: "after", since: { id: "b" } });
    expect(usageAt(s, "2025-05-01T00:00:00.000Z")).toEqual({ usage: null, kind: "unknown" });
  });
});
