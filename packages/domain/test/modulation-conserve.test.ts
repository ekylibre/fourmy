import { describe, expect, it } from "vitest";
import { conserveMean, modulationRates } from "../src/index.js";

describe("carte de modulation à moyenne conservée (FR-FERT-18)", () => {
  const p = { zoneCount: 3, strategy: "compensate" as const, baseRate: 150, modulationPct: 20, minRate: 50, maxRate: 300, unit: "kg_ha" as const };
  it("zones inégales : la moyenne pondérée revient à la dose de l'apport", () => {
    const raw = modulationRates(p); // 180, 150, 120
    expect(raw).toEqual([180, 150, 120]);
    const areas = [10_000, 10_000, 40_000]; // moyenne brute : (180 + 150 + 480) / 6 = 135
    const r = conserveMean(raw, areas, 150, p);
    expect(r.mean).toBe(150);
    expect(r.rates[0]! - r.rates[2]!).toBe(60); // l'écart entre zones est gardé
  });
  it("bornes : la dose ne sort pas des limites ; la moyenne s'en approche au mieux", () => {
    const r = conserveMean([180, 150, 120], [10_000, 10_000, 40_000], 280, { ...p, maxRate: 290 });
    expect(Math.max(...r.rates)).toBeLessThanOrEqual(290);
    expect(r.mean).toBeGreaterThan(270);
  });
});
