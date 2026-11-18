import { describe, expect, it } from "vitest";
import { DEFAULT_SPRAYING_THRESHOLDS, iftLight, sprayingHour, sprayingPeriod } from "../src/index.js";

const hour = (v: Partial<Parameters<typeof sprayingHour>[0]>) => ({ windKmh: null, humidityPct: null, temperatureC: null, precipitationMm: null, stepHours: 1, ...v });

describe("conditions de pulvérisation (seuils par défaut : Ekylibre)", () => {
  it("favorable : vent faible, air humide, doux, sec", () => {
    expect(sprayingHour(hour({ windKmh: 6, humidityPct: 85, temperatureC: 15, precipitationMm: 0 }))).toEqual({ level: "ok", reasons: [] });
  });
  it("à surveiller : vent entre 2 et 5 m/s, hygrométrie 60 %", () => {
    expect(sprayingHour(hour({ windKmh: 12, humidityPct: 60 }))).toEqual({ level: "warning", reasons: ["vent 12 km/h", "hygrométrie 60 %"] });
  });
  it("défavorable : vent ≥ 5 m/s (18 km/h), pluie, chaleur, gel", () => {
    expect(sprayingHour(hour({ windKmh: 19 })).level).toBe("danger");
    expect(sprayingHour(hour({ precipitationMm: 1.2 })).reasons).toEqual(["pluie 1,2 mm"]);
    expect(sprayingHour(hour({ temperatureC: 31 })).level).toBe("danger");
    expect(sprayingHour(hour({ temperatureC: -1 })).level).toBe("danger");
  });
  it("pluie ramenée à l'heure sur un pas de 3 h", () => {
    expect(sprayingHour(hour({ precipitationMm: 0.6, stepHours: 3 })).level).toBe("warning");
  });
});

describe("seuils de la ferme", () => {
  it("s'appliquent, sans jamais relâcher le seuil réglementaire du vent", () => {
    const farm = { ...DEFAULT_SPRAYING_THRESHOLDS, windKmh: { green: 15, red: 30 }, humidityPct: { greenMin: 60, greenMax: 95, redMin: 40, redMax: 99 } };
    expect(sprayingHour(hour({ windKmh: 12, humidityPct: 60 }), farm).level).toBe("ok");
    expect(sprayingHour(hour({ windKmh: 20 }), farm).level).toBe("danger"); // 30 ramené à 19
  });
});

describe("bilan d'une intervention", () => {
  const slot = (at: string, level: "ok" | "warning" | "danger", reasons: string[] = []) => ({ at, stepHours: 1, level, reasons });
  const day = [
    slot("2026-10-05T13:00:00Z", "danger", ["vent 20 km/h"]),
    slot("2026-10-05T14:00:00Z", "warning", ["hygrométrie 57 %"]),
    slot("2026-10-05T15:00:00Z", "warning", ["hygrométrie 58 %"]),
    slot("2026-10-05T16:00:00Z", "ok"),
  ];
  it("le pire feu des heures recouvertes, raisons sans doublon", () => {
    // 16:24–17:46 heure de Paris = 14:24–15:46 UTC.
    expect(sprayingPeriod(day, "2026-10-05T14:24:00Z", "2026-10-05T15:46:00Z")).toMatchObject({ level: "warning", reasons: ["hygrométrie 58 %"] });
    expect(sprayingPeriod(day, "2026-10-05T13:30:00Z", "2026-10-05T14:10:00Z").level).toBe("danger");
    expect(sprayingPeriod(day, "2026-10-06T00:00:00Z", "2026-10-06T01:00:00Z").level).toBe("unknown");
  });
});

describe("IFT", () => {
  it("feu par ligne", () => {
    expect([iftLight(0.19), iftLight(1), iftLight(1.1), iftLight(1.5), iftLight(null)]).toEqual(["ok", "ok", "warning", "danger", "unknown"]);
  });
});
