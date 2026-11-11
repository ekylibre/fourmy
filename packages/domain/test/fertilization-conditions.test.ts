import { describe, it, expect } from "vitest";
import { checkSoilCover, checkSpreadingConditions, type SoilCoverInput } from "../src/fertilization/index.js";

describe("conditions d'épandage (PAN 7, annexe I, VI)", () => {
  const base = { type: "III", solid: false, liquid: false, foliar: false, weather: null, water: null };
  it("gel : interdit sauf fumiers compacts et composts ; forte pluie : sol détrempé", () => {
    expect(checkSpreadingConditions({ ...base, weather: { minTemperatureC: -2, precipitationMm: 0 } })).toEqual([
      { code: "fert_frost", level: "warning", message: "Gel (-2 °C) : épandage interdit sur sol gelé, même en surface, et sur sol enneigé." },
    ]);
    expect(checkSpreadingConditions({ ...base, type: "Ia", solid: true, weather: { minTemperatureC: -2, precipitationMm: 0 } })[0]).toMatchObject({ level: "info" });
    expect(checkSpreadingConditions({ ...base, weather: { minTemperatureC: 5, precipitationMm: 22 } })).toEqual([expect.objectContaining({ code: "fert_wet", level: "info" })]);
    expect(checkSpreadingConditions({ ...base, foliar: true, weather: { minTemperatureC: -5, precipitationMm: 40 } })).toEqual([]);
  });

  it("cours d'eau : 35 m pour les types 0, I et II, 2 m pour le type III ; pente à moins de 100 m", () => {
    const near = { name: "Le Luy", distanceM: 20 };
    expect(checkSpreadingConditions({ ...base, type: "II", liquid: true, water: near }).map((i) => [i.code, i.level])).toEqual([
      ["fert_water", "warning"],
      ["fert_slope", "info"],
    ]);
    expect(checkSpreadingConditions({ ...base, water: near }).map((i) => i.code)).toEqual(["fert_slope"]);
    expect(checkSpreadingConditions({ ...base, water: { name: null, distanceM: 1 } })[0]!.message).toMatch(/à moins de 2 m des berges/);
    expect(checkSpreadingConditions({ ...base, type: "II", water: { name: "x", distanceM: 150 } })).toEqual([]);
  });
});

describe("couverture des sols en interculture (PAR 7 NA, tableaux 11 et 12)", () => {
  const maize: SoilCoverInput = { crop: "maize_grain", previous: { crop: "soft_wheat", harvestedOn: "2025-07-10" }, zar: false, cover: null, residueWorks: [] };
  const cover = { kind: "sown" as const, pureLegumes: false, sownOn: "2025-08-25", destroyedOn: "2025-12-10", destructionMode: "mechanical" };

  it("après un blé : couvert avant le 30/09, maintenu 2,5 mois, détruit après le 15/11", () => {
    expect(checkSoilCover(maize)).toMatchObject({ level: "warning", situation: "long", messages: [expect.stringMatching(/au plus tard le 30\/09\/2025/)] });
    expect(checkSoilCover({ ...maize, cover })).toMatchObject({ level: "ok" });
    expect(checkSoilCover({ ...maize, zar: true, cover: { ...cover, sownOn: "2025-09-20" } }).messages[0]).toMatch(/après la date limite du 15\/09\/2025/);
    expect(checkSoilCover({ ...maize, cover: { ...cover, destroyedOn: "2025-11-01" } }).messages).toEqual(expect.arrayContaining([expect.stringMatching(/au plus tôt le 15\/11\/2025/)]));
    expect(checkSoilCover({ ...maize, cover: { ...cover, sownOn: "2025-09-28", destroyedOn: "2025-11-20" } })).toMatchObject({ level: "warning", messages: [expect.stringMatching(/^Couvert du/), expect.stringMatching(/à maintenir 2,5 mois \(jusqu'au 13\/12\/2025\)/)] });
    expect(checkSoilCover({ ...maize, cover: { ...cover, destructionMode: "chemical" } }).messages.at(-1)).toMatch(/Destruction chimique/);
    expect(checkSoilCover({ ...maize, cover: { ...cover, pureLegumes: true } }).messages.at(-1)).toMatch(/au plus tôt le 01\/02\/2026 pour des légumineuses pures/);
  });

  it("récolte entre le 15/09 et le 15/10 : 15 jours ; après le 15/10 : non obligatoire", () => {
    const late = { ...maize, previous: { crop: "maize_silage" as const, harvestedOn: "2025-09-25" } };
    expect(checkSoilCover(late).messages[0]).toMatch(/au plus tard le 10\/10\/2025/);
    expect(checkSoilCover({ ...late, previous: { crop: "maize_silage", harvestedOn: "2025-10-20" } })).toMatchObject({ level: "ok", messages: [expect.stringMatching(/non obligatoire/)] });
  });

  it("derrière un maïs grain : cannes broyées et enfouies sous 15 jours, ou couvert avant le 01/12", () => {
    const mm = { ...maize, previous: { crop: "maize_grain" as const, harvestedOn: "2025-10-20" } };
    expect(checkSoilCover(mm)).toMatchObject({ level: "warning", messages: [expect.stringMatching(/cannes à broyer.*au plus tard le 04\/11\/2025/)] });
    expect(checkSoilCover({ ...mm, residueWorks: ["2025-10-28"] })).toMatchObject({ level: "ok", messages: [expect.stringMatching(/Cannes broyées ou enfouies le 28\/10\/2025/)] });
    expect(checkSoilCover({ ...mm, residueWorks: ["2025-11-15"] }).level).toBe("warning");
  });

  it("culture d'hiver : interculture courte, contrôlée derrière colza seulement", () => {
    expect(checkSoilCover({ ...maize, crop: "soft_wheat" })).toMatchObject({ situation: "none", level: "ok" });
    const afterRape = { ...maize, crop: "soft_wheat" as const, previous: { crop: "rapeseed_winter" as const, harvestedOn: "2025-07-05" } };
    expect(checkSoilCover(afterRape)).toMatchObject({ situation: "short_after_rapeseed", level: "warning" });
    expect(checkSoilCover({ ...afterRape, cover: { kind: "regrowth_rapeseed", pureLegumes: false, sownOn: "2025-07-05", destroyedOn: "2025-08-20", destructionMode: "mechanical" } }).level).toBe("ok");
    expect(checkSoilCover({ ...maize, previous: { crop: "soft_wheat", harvestedOn: null } }).level).toBe("info");
  });
});
