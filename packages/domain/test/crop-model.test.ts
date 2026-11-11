import { describe, expect, it } from "vitest";
import { CROP_MODELS, addDays, cropModelFor, dailyGdd, dailyNormals, simulateSeason, stateAt, weatherSeries, type ModelWeatherDay } from "../src/index.js";

/** Été régulier : 12 / 26 °C (13 °Cj base 6 par jour), ET0 5 mm, une pluie de 20 mm tous les 10 jours. */
function summer(from: string, n: number, over: Partial<ModelWeatherDay> = {}): ModelWeatherDay[] {
  return Array.from({ length: n }, (_, i) => ({ day: addDays(from, i), tminC: 12, tmaxC: 26, rainMm: i % 10 === 9 ? 20 : 0, et0Mm: 5, basis: "observed" as const, ...over }));
}

describe("modèle de croissance : degrés-jours et stades", () => {
  it("degrés-jours plafonnés, jamais négatifs", () => {
    expect(dailyGdd(12, 26, 6, 30)).toBe(13);
    expect(dailyGdd(20, 40, 6, 30)).toBe(19); // 40 °C compte pour 30
    expect(dailyGdd(-5, 3, 6, 30)).toBe(0);
  });

  it("modèle par espèce : maïs, céréales, rien pour la vigne ou la prairie", () => {
    expect(cropModelFor("zea_mays")?.kind).toBe("maize");
    expect(cropModelFor("x_triticosecale")?.kind).toBe("winter_cereal");
    expect(cropModelFor("avena")?.kind).toBe("winter_cereal");
    expect(cropModelFor("vitis_vinifera")).toBeNull();
    expect(cropModelFor("lolium_perenne")).toBeNull();
    expect(cropModelFor(null)).toBeNull();
  });

  it("stades du maïs datés à 13 °Cj par jour ; la récolte saisie arrête la saison", () => {
    const sim = simulateSeason({ model: CROP_MODELS.maize, sownOn: "2026-04-10", weather: summer("2026-04-01", 200), tawMm: 100 });
    const on = Object.fromEntries(sim.stages.map((s) => [s.code, s.on]));
    expect(on.emergence).toBe(addDays("2026-04-10", 7)); // 8 jours × 13 = 104 °Cj
    expect(on.flowering).toBe(addDays("2026-04-10", 73)); // 74 × 13 = 962
    expect(on.harvestable).toBe(addDays("2026-04-10", 157)); // 158 × 13 = 2054
    expect(sim.days[0]!.date).toBe("2026-04-10");
    const cut = simulateSeason({ model: CROP_MODELS.maize, sownOn: "2026-04-10", weather: summer("2026-04-01", 200), tawMm: 100, endOn: "2026-07-01" });
    expect(cut.days.at(-1)!.date).toBe("2026-07-01");
    expect(cut.stages.find((s) => s.code === "maturity")!.on).toBeNull();
  });

  it("état à une date : stade atteint, suivant, origine de la météo", () => {
    const w = summer("2026-04-10", 120).map((d, i) => ({ ...d, basis: i < 80 ? ("observed" as const) : ("forecast" as const) }));
    const sim = simulateSeason({ model: CROP_MODELS.maize, sownOn: "2026-04-10", weather: w, tawMm: 100 });
    const s = stateAt(sim, "2026-05-15"); // 36 jours × 13 = 468 °Cj
    expect(s.stage!.code).toBe("v6");
    expect(s.next!.code).toBe("v10");
    expect(stateAt(sim, "2026-04-12").stage).toBeNull(); // semé, pas levé
    expect(sim.stages.find((x) => x.code === "flowering")!.basis).toBe("observed");
  });
});

describe("modèle de croissance : bilan hydrique", () => {
  it("en sec, la réserve s'épuise et le stress apparaît ; irriguée, le besoin d'irrigation remplace le stress", () => {
    const dry = simulateSeason({ model: CROP_MODELS.maize, sownOn: "2026-04-10", weather: summer("2026-04-10", 150), tawMm: 100 });
    const at = stateAt(dry, "2026-08-15");
    expect(at.stressDays).toBeGreaterThan(30);
    expect(at.floweringStressDays).toBeGreaterThan(0);
    expect(at.day!.reserve).toBeLessThan(0.45);
    expect(at.irrigationMm).toBe(0);
    const wet = simulateSeason({ model: CROP_MODELS.maize, sownOn: "2026-04-10", weather: summer("2026-04-10", 150), tawMm: 100, irrigated: true });
    const w = stateAt(wet, "2026-08-15");
    expect(w.stressDays).toBe(0);
    expect(w.irrigationMm).toBeGreaterThan(150);
    // La réserve accessible croît avec l'enracinement (30 % à la levée, toute à la floraison).
    expect(dry.days[0]!.tawMm).toBe(30);
    expect(dry.days.find((d) => d.gdd >= 950)!.tawMm).toBe(100);
  });

  it("une grosse réserve et des pluies régulières : pas de stress", () => {
    const rainy = summer("2026-04-10", 150).map((d) => ({ ...d, rainMm: 6 }));
    const sim = simulateSeason({ model: CROP_MODELS.maize, sownOn: "2026-04-10", weather: rainy, tawMm: 200 });
    expect(stateAt(sim, "2026-09-01").stressDays).toBe(0);
  });
});

describe("modèle de croissance : météo continue", () => {
  it("météo connue, puis normales des années précédentes", () => {
    const history = [2024, 2025].flatMap((y) => summer(`${y}-06-01`, 30, { tminC: y === 2024 ? 10 : 14 }));
    const normals = dailyNormals(history);
    expect(normals.get("06-15")).toMatchObject({ tminC: 12, tmaxC: 26 });
    const known = new Map(summer("2026-06-01", 5, { basis: "forecast" }).map((d) => [d.day, d]));
    const series = weatherSeries("2026-06-01", "2026-06-10", known, normals);
    expect(series.map((d) => d.basis)).toEqual([...Array(5).fill("forecast"), ...Array(5).fill("normals")]);
    // Sans normale (hors de l'historique), la série s'arrête.
    expect(weatherSeries("2026-06-25", "2026-07-05", new Map(), normals).at(-1)!.day).toBe("2026-06-30");
  });
});
