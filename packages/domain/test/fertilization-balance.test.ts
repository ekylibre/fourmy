import { describe, expect, it } from "vitest";
import { computeBalance, cropGroupOf, isMissing, yieldTarget, type BalanceInput } from "../src/index.js";

/** Cas chiffrés à la main d'après les annexes 2.2.b et 2.1.b du référentiel Nouvelle-Aquitaine (lot AG). */
const maize: BalanceInput = {
  campaign: 2027,
  department: "64",
  crop: "maize_grain",
  soilType: "limoneux",
  irrigated: true,
  yieldTarget: 107,
  previous: { crop: "maize_grain", strawReturned: null, yieldRealized: 117, xMineral: 200 },
  rainMm: 700,
  irrigation: { plannedMm: 150, no3MgL: null, origin: "groundwater" },
  nBefore4Leaves: 30,
};
const value = (r: ReturnType<typeof computeBalance>, t: string) => {
  const x = r.terms[t as keyof typeof r.terms];
  return x && !isMissing(x) ? x.value : undefined;
};

describe("dose prévisionnelle : maïs en Pyrénées-Atlantiques (bilan CAU en deux temps)", () => {
  it("terme par terme, puis la dose", () => {
    const r = computeBalance(maize);
    expect(r.method).toBe("bilan_cau_two_phase");
    expect(r.annex).toBe("2.2.b");
    expect(r.missing).toEqual([]);
    expect(value(r, "Pf")).toBe(235); // 107 q × 2,2 (palier 100 à 120 q)
    expect(value(r, "Rf")).toBe(30);
    expect(value(r, "Mh")).toBe(60); // limoneux irrigué
    expect(value(r, "Mr")).toBe(0); // précédent maïs grain, ouverture en avril
    expect(value(r, "Nirr")).toBe(14); // 150 mm × 40 mg/L ÷ 443
    // APL = [(140 + 200) − 117 × 2,2] × 0,48 = 39,6 ; grille limoneux à 700 mm : 27 (APL 20) et 28 (APL 40).
    expect(value(r, "Ri")).toBe(28);
    // [(235 + 30) − (28 + 60 + 0 + 0 + 0 + 14 + 30 × 0,6)] / 0,8 − 0 + 30 = 211,25.
    expect(r.dose).toBe(211);
    expect(r.floor30).toBe(false);
  });

  it("reliquat mesuré, eau de surface sous le seuil, en sec", () => {
    const r = computeBalance({ ...maize, irrigated: false, rshMeasured: { kgNHa: 52, sampledOn: "2027-03-20" }, nBefore4Leaves: 0 });
    expect(r.terms.Ri).toMatchObject({ value: 52, origin: "measured" });
    expect(value(r, "Mh")).toBe(45);
    expect(value(r, "Nirr")).toBe(0);
    // (265 − (52 + 45)) / 0,8 = 210.
    expect(r.dose).toBe(210);
    const small = computeBalance({ ...maize, irrigation: { plannedMm: 90, no3MgL: null, origin: "surface" } });
    expect(small.terms.Nirr).toMatchObject({ value: 0 });
  });

  it("arrondit sans l'erreur des flottants : 95 q × 2,3 = 218,5 → 219", () => {
    expect(value(computeBalance({ ...maize, yieldTarget: 95 }), "Pf")).toBe(219);
  });

  it("ce qui manque est listé, sans dose", () => {
    const r = computeBalance({ ...maize, soilType: null, irrigation: null, previous: null, yieldTarget: null });
    expect(r.dose).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining([expect.stringMatching(/^Pf/), expect.stringMatching(/^Rf/), expect.stringMatching(/^Mh/), expect.stringMatching(/^Mr/), expect.stringMatching(/^Ri/), expect.stringMatching(/^Nirr/)]));
  });

  it("une valeur de la ferme remplace la référence, avec son motif", () => {
    const r = computeBalance({ ...maize, overrides: { Mh: { value: 50, reason: "référence locale chambre 64" } } });
    expect(r.terms.Mh).toMatchObject({ value: 50, origin: "override", detail: "référence locale chambre 64" });
    expect(r.dose).toBe(224); // (265 − 112) / 0,8 + 30 = 221,25 + … : 28 + 50 + 14 + 18 = 110 → 155 / 0,8 + 30 = 223,75
  });
});

describe("couvert d'interculture (MrCi, lot AI)", () => {
  it("valeur de la table quand le couvert est complet ; sinon le manque est nommé", () => {
    const full = computeBalance({ ...maize, cover: { family: "cruciferes", biomass: "1_3", destruction: "nov_dec" } });
    expect(full.terms.MrCi).toMatchObject({ origin: "reference", detail: "couvert détruit en novembre-décembre" });
    expect(full.missing).not.toContain("biomasse du couvert d'interculture");
    const noBiomass = computeBalance({ ...maize, cover: { family: "cruciferes", biomass: null, destruction: "nov_dec" } });
    expect(noBiomass.terms.MrCi).toEqual({ missing: "biomasse du couvert d'interculture" });
    expect(noBiomass.dose).toBeNull();
    const notDestroyed = computeBalance({ ...maize, cover: { family: "cruciferes", biomass: "1_3", destruction: null } });
    expect(notDestroyed.terms.MrCi).toEqual({ missing: "date de destruction du couvert d'interculture" });
  });
});

describe("dose prévisionnelle : triticale (bilan CAU)", () => {
  it("Ri + Pi lus dans la grille des céréales, CAU 0,9", () => {
    const r = computeBalance({
      campaign: 2027,
      department: "64",
      crop: "triticale",
      soilType: "limoneux",
      irrigated: false,
      yieldTarget: 60,
      previous: { crop: "maize_grain", strawReturned: null, yieldRealized: 110, xMineral: 180 },
      rainMm: 450,
    });
    expect(r.method).toBe("bilan_cau");
    expect(value(r, "Pf")).toBe(156); // 60 × 2,6
    expect(value(r, "Mr")).toBe(-10); // maïs grain, sortie d'hiver
    expect(value(r, "MrCi")).toBe(0);
    expect(r.missing).toEqual([]);
    expect(r.dose).toBeGreaterThan(0);
  });
});

describe("dose plafond et objectif de rendement", () => {
  it("vigne : plafond annuel et rappel des 3 ans ; culture inconnue : 210 kg", () => {
    const vine = computeBalance({ campaign: 2027, department: "33", crop: "vine", soilType: null, irrigated: false, yieldTarget: null });
    expect(vine).toMatchObject({ method: "ceiling", dose: 80, ceiling: 80 });
    expect(vine.warnings.join(" ")).toContain("240 kg N sur trois ans");
    expect(computeBalance({ campaign: 2027, department: "64", crop: "other", soilType: null, irrigated: false, yieldTarget: null })).toMatchObject({ dose: 210 });
    expect(computeBalance({ campaign: 2027, department: "64", crop: "sunflower", soilType: null, irrigated: false, yieldTarget: null })).toMatchObject({ method: "unsupported", dose: null });
  });

  it("moyenne olympique des 5 dernières campagnes (Pierre, maïs)", () => {
    const h = [
      { campaign: 2021, yield: 118.7 },
      { campaign: 2022, yield: 85 },
      { campaign: 2023, yield: 123.2 },
      { campaign: 2024, yield: 117.2 },
      { campaign: 2025, yield: 80 },
      { campaign: 2019, yield: 123.9 },
    ];
    expect(yieldTarget(h, 2026, null)).toMatchObject({ value: 107, origin: "computed" });
    expect(yieldTarget(h.slice(0, 3), 2026, { value: 117, source: "référence départementale 64, maïs grain irrigué" })).toMatchObject({ value: 117, origin: "reference" });
  });

  it("groupe de cultures d'après l'activité ou la culture botanique", () => {
    expect(cropGroupOf({ reference: "grain_corn", cultivation: "zea_mays" })).toBe("maize_grain");
    expect(cropGroupOf({ reference: "winter_triticale" })).toBe("triticale");
    expect(cropGroupOf({ reference: "winter_oat" })).toBe("oat");
    expect(cropGroupOf({ reference: null, cultivation: "vitis_vinifera" })).toBe("vine");
    expect(cropGroupOf({ reference: "unknown_thing", cultivation: null })).toBe("other");
  });
});

describe("fractionnement proposé (PAR 7 Nouvelle-Aquitaine)", () => {
  it("maïs : apport avant 4 feuilles puis le reste ; céréales : 50 kg au tallage, 3 apports au-delà de 160 kg", async () => {
    const { splitDose } = await import("../src/index.js");
    expect(splitDose(211, "maize_grain", { nBefore4Leaves: 30 }).map((a) => [a.stage, a.nKgHa])).toEqual([
      ["Avant 4 feuilles (semis)", 30],
      ["4 à 8 feuilles", 181],
    ]);
    expect(splitDose(180, "maize_grain").map((a) => a.nKgHa)).toEqual([50, 130]);
    expect(splitDose(180, "maize_grain", { steeringReserve: 40 }).map((a) => [a.nKgHa, a.reservedForSteering])).toEqual([
      [50, false],
      [90, false],
      [40, true],
    ]);
    expect(splitDose(140, "triticale").map((a) => a.nKgHa)).toEqual([50, 90]);
    expect(splitDose(190, "soft_wheat").map((a) => a.nKgHa)).toEqual([50, 100, 40]);
    expect(splitDose(40, "triticale").map((a) => a.nKgHa)).toEqual([40]);
    expect(splitDose(0, "maize_grain")).toEqual([]);
  });
});

describe("calendrier d'épandage (PAN 7, Nouvelle-Aquitaine, zone ouest et sud du Béarn)", () => {
  it("maïs, triticale, maïs irrigué (note 4), foliaire, type inconnu", async () => {
    const { checkCalendar } = await import("../src/index.js");
    const z = ["ouest", "sud"];
    const c = (date: string, crop: Parameters<typeof checkCalendar>[0]["crop"], type: "III" | "II" | null, irrigated = false, foliar = false) =>
      checkCalendar({ date, crop, type, irrigated, foliar, zones: z }).level;
    expect(c("2026-01-10", "maize_grain", "III")).toBe("danger"); // du 01/07 au 15/02
    expect(c("2026-05-20", "maize_grain", "III")).toBe("ok");
    expect(c("2026-07-20", "maize_grain", "III", true)).toBe("info");
    expect(c("2026-07-20", "maize_grain", "III")).toBe("danger");
    expect(c("2025-10-10", "triticale", "III")).toBe("danger"); // zone ouest : du 01/07 au 15/01
    expect(c("2026-01-20", "triticale", "III")).toBe("ok");
    expect(c("2025-11-20", "maize_grain", "II")).toBe("danger");
    expect(c("2026-01-10", "maize_grain", "III", false, true)).toBe("ok");
    expect(c("2026-01-10", "maize_grain", null)).toBe("info");
  });
});
