import { describe, expect, it } from "vitest";
import { CROP_GROUPS, NA_SOIL_TYPES, type Table } from "../src/types.js";
import { NA_DEPARTMENTS, naMethods } from "../src/na-2025/methods.js";
import { naSoils } from "../src/na-2025/soils.js";
import { keqRules, naProKeq, naProProducts, type ProKeqRow } from "../src/na-2025/pro.js";
import {
  naRapeseedEquation,
  naRapeseedIrrigation,
  naRapeseedM,
  naRapeseedMha,
  naRapeseedPi,
  naRapeseedRf,
  naRapeseedRi,
} from "../src/na-2025/rapeseed.js";
import { naSunflowerHeliotest, naSunflowerPivotByYield } from "../src/na-2025/sunflower-pivot.js";
import {
  naAsparagusReference3340,
  naCoverCropListedPro,
  naCoverCropRules,
  naCoverCropUnlistedPro,
  naExportedCoverCrops,
  naLegumeCeilings,
  naLegumeNitrogenAuthorisations,
  naOtherCeilings,
  naSoyNodulationPivot,
  naVegetableCeilings,
} from "../src/na-2025/ceilings.js";
import { naYieldReferences } from "../src/na-2025/yields.js";
import { naRshRecommendations } from "../src/na-2025/rsh.js";

const ALL: Table<unknown>[] = [
  naMethods,
  naSoils,
  naProProducts,
  naProKeq,
  naRapeseedRf,
  naRapeseedRi,
  naRapeseedM,
  naRapeseedMha,
  naRapeseedIrrigation,
  naSunflowerPivotByYield,
  naSunflowerHeliotest,
  naVegetableCeilings,
  naAsparagusReference3340,
  naLegumeCeilings,
  naLegumeNitrogenAuthorisations,
  naSoyNodulationPivot,
  naOtherCeilings,
  naCoverCropListedPro,
  naCoverCropUnlistedPro,
  naExportedCoverCrops,
  naYieldReferences,
  naRshRecommendations,
];

const cropSet = new Set<string>(CROP_GROUPS);

describe("NA 2025 tables: metadata", () => {
  it("every table has an id, ref, date, url, organisation and licence", () => {
    const ids = new Set<string>();
    for (const t of ALL) {
      expect(t.id).toMatch(/^na-2025\//);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.source.ref, t.id).toBeTruthy();
      expect(t.source.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.source.url).toMatch(/^https:\/\/www\.nouvelle-aquitaine\.developpement-durable\.gouv\.fr\/IMG\/pdf\/.+\.pdf$/);
      expect(t.source.organisation).toBe("Préfecture de la région Nouvelle-Aquitaine (GREN)");
      expect(t.source.licence).toBeTruthy();
      expect(t.rows.length).toBeGreaterThan(0);
    }
  });
  it("dates: 2025-07-29 for the arrêté, 2025-09-03 for yields", () => {
    for (const t of ALL) expect(t.source.date).toBe(t === naYieldReferences ? "2025-09-03" : "2025-07-29");
  });
});

describe("annexe 1: methods", () => {
  it("rows, crops and departments", () => {
    expect(naMethods.rows).toHaveLength(19);
    for (const r of naMethods.rows) {
      for (const c of r.crops) expect(cropSet.has(c), c).toBe(true);
      if (r.departments !== "all") for (const d of r.departments) expect(NA_DEPARTMENTS).toContain(d);
    }
  });
  it("spot values", () => {
    const maize24 = naMethods.rows.filter((r) => r.crops.includes("maize_grain") && r.departments !== "all" && r.departments.includes("24"));
    expect(maize24).toEqual([expect.objectContaining({ method: "bilan_cau_two_phase", annex: "2.2.b" })]);
    const cereals86 = naMethods.rows.filter((r) => r.crops.includes("soft_wheat") && r.departments !== "all" && r.departments.includes("86"));
    expect(cereals86.map((r) => r.method).sort()).toEqual(["bilan_additive", "bilan_cau"]);
    expect(naMethods.rows.find((r) => r.crops.includes("tobacco") && r.departments !== "all" && r.departments.includes("17"))?.method).toBe("bilan_additive");
    expect(naMethods.rows.find((r) => r.crops.includes("sunflower"))).toMatchObject({ method: "pivot", annex: "3.1", departments: "all" });
  });
  it("every department has exactly one CAU-family method for maize", () => {
    for (const d of NA_DEPARTMENTS) {
      const n = naMethods.rows.filter((r) => r.method === "bilan_cau_two_phase" && r.departments !== "all" && r.departments.includes(d)).length;
      expect(n, d).toBe(1);
    }
  });
});

describe("annexe 7: soils", () => {
  it("one row per NaSoilType", () => {
    expect(naSoils.rows.map((r) => r.key).sort()).toEqual([...NA_SOIL_TYPES].sort());
  });
  it("spot values", () => {
    const by = Object.fromEntries(naSoils.rows.map((r) => [r.key, r]));
    expect(by.sableux?.ruClasses.high).toBe("Non concerné");
    expect(by.argilo_calcaire?.vernaculars[1]).toEqual({ name: "Aubues, champagnes, tuffeau", texture: "LAS/A", ph: ">7", stones: "Cx de Craie" });
    expect(by.sableux?.vernaculars[2]?.ph).toBe("<5");
    expect(by.marais_argileux_sodiques?.ruClasses.low).toBe("Non concerné");
    expect(by.limoneux?.vernacularNames).toHaveLength(4);
  });
});

describe("annexe 5: organic products", () => {
  it("counts and unique keys", () => {
    expect(naProProducts.rows).toHaveLength(71);
    const keys = naProProducts.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_]+$/);
    expect(naProKeq.rows).toHaveLength(71 * 12);
    const keySet = new Set(keys);
    for (const r of naProKeq.rows) expect(keySet.has(r.product)).toBe(true);
    const combos = naProKeq.rows.map((r) => `${r.product}|${r.cropColumn}|${r.apport}`);
    expect(new Set(combos).size).toBe(combos.length);
  });
  it("units follow the state", () => {
    for (const p of naProProducts.rows) {
      if (p.state === "solid") expect(p.unit).toBe("kgN/t");
      if (p.state === "liquid") expect(p.unit).toBe("kgN/m3");
    }
  });
  const keq = (product: string, col: ProKeqRow["cropColumn"], apport: string) =>
    naProKeq.rows.find((r) => r.product === product && r.cropColumn === col && r.apport === apport);
  it("spot values verified on the rendered pages", () => {
    const p = (k: string) => naProProducts.rows.find((r) => r.key === k);
    expect(p("fumier_bovins_mixtes_corpen")).toMatchObject({ nTotal: 5.5, state: "solid", family: "Bovins" });
    expect(p("lisier_veaux_purs_corpen")?.nTotal).toBe(2.86);
    expect(p("guano")).toMatchObject({ nTotal: 160, family: null, typeProduitColumn: "5" });
    expect(p("autres_engrais_biologiques")?.nTotal).toBeNull();
    expect(keq("lisier_porcs_corpen", "straw_cereals", "apports d’automne")).toMatchObject({ keqRi: 0.56, keqBilan: 0.05, keqCycle: 0.61, notRecommended: true });
    expect(keq("fumier_bovins_tres_compacts_litiere_accumulee", "maize_sorghum_tobacco", "apports d’automne")).toMatchObject({ keqRi: 0.26, keqBilan: 0.1, keqCycle: 0.36 });
    expect(keq("fumier_bovins_tres_compacts_litiere_accumulee", "maize_sorghum_tobacco", "apports d’automne")?.notRecommended).toBeUndefined();
    expect(keq("boues_urbaines_compostees", "rapeseed", "apport de fin d’été ou d’automne")).toMatchObject({ keqBilan: 0.1, keqCycle: "nr" });
    expect(keq("fumier_dindes_sortie_batiment", "rapeseed", "apport de fin d’été ou d’automne")).toMatchObject({ keqBilan: 0.2, keqCycle: 0.55 });
    expect(keq("fumier_lapins", "grassland", "apports d’automne")?.keq).toBe("dire_d_expert");
    expect(keq("lisier_lapins", "grassland", "apports de printemps")?.keq).toBe(0.45);
    expect(keq("effluents_prunicoles", "grassland", "apports d’automne")?.keq).toBe("ng");
    expect(keq("tourteaux_ricin", "maize_sorghum_tobacco", "apports de printemps")).toMatchObject({ keqBilan: 0.7, keqCycle: 0.7 });
    expect(keq("guano", "grassland", "apports d’automne")).toMatchObject({ keq: 0.35, notRecommended: true });
    expect(keq("autres_engrais_biologiques", "other_crops", "apports de printemps")?.keq).toBe(0.25);
  });
  it("Keq cycle = Keq Ri + Keq bilan wherever all three are numbers", () => {
    let checked = 0;
    for (const r of naProKeq.rows) {
      if (typeof r.keqRi === "number" && typeof r.keqBilan === "number" && typeof r.keqCycle === "number") {
        expect(r.keqRi + r.keqBilan, `${r.product} ${r.cropColumn} ${r.apport}`).toBeCloseTo(r.keqCycle, 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
  it("spring / after-opening columns have bilan = cycle", () => {
    for (const r of naProKeq.rows)
      if (r.periods.includes("spring") && r.cropColumn !== "grassland" && r.cropColumn !== "other_crops") expect(r.keqBilan).toBe(r.keqCycle);
  });
  it("keq rules quote case 1 and case 2", () => {
    expect(keqRules.some((s) => s.includes("KeqN Bilan = KeqN Cycle"))).toBe(true);
    expect(keqRules.some((s) => s.includes("KeqN Cycle = KeqN Ri + KeqN Bilan"))).toBe(true);
  });
});

describe("annexe 2.4: rapeseed", () => {
  it("constants", () => {
    expect(naRapeseedEquation).toMatchObject({ bKgNPerQ: 7, pfMaxKgNHa: 330, xMaxKgNHa: 250, flegPeaPreviousKgNHa: 25, fassLegumeCompanionKgNHa: 30 });
    expect(naRapeseedPi).toMatchObject({ coeffEH: 50, coeffSH: 65 });
  });
  it("depth tables", () => {
    expect(naRapeseedRf.rows.map((r) => r.valueKgNHa)).toEqual([15, 30]);
    expect(naRapeseedRi.rows.map((r) => r.valueKgNHa)).toEqual([20, 30]);
    expect(naRapeseedM.rows.map((r) => r.valueKgNHa)).toEqual([20, 40]);
  });
  it("Mha", () => {
    expect(naRapeseedMha.rows).toHaveLength(16);
    expect(naRapeseedMha.rows.find((r) => r.product === "Boues urbaines séchées (90 % MS)")).toMatchObject({ everyYear: 100, twoYearsInThree: 60, everyTwoYears: 50, everyThreeYearsOrMore: 25 });
    expect(naRapeseedMha.rows.find((r) => r.product === "Fumier de cheval")?.everyYear).toBe(40);
    expect(naRapeseedMha.rows.find((r) => r.product === "Fientes de volailles sèches (80 % MS)")?.everyThreeYearsOrMore).toBe(0);
  });
  it("irrigation tables agree with Nirr = Q x T / 443 rounded", () => {
    expect(naRapeseedIrrigation.rows).toHaveLength(16);
    for (const r of naRapeseedIrrigation.rows) expect(Math.round((r.waterMm * r.nitrateMgL) / 443)).toBe(r.nitrogenKgNHa);
  });
});

describe("annexe 3.1: sunflower pivot", () => {
  it("yield table", () => {
    expect(naSunflowerPivotByYield.rows).toHaveLength(3);
    expect(naSunflowerPivotByYield.rows[0]).toMatchObject({ lowResidue30: 90, mediumResidue60: 60, highResidue90: 30 });
    expect(naSunflowerPivotByYield.rows[1]).toMatchObject({ lowResidue30: 75, mediumResidue60: 45, highResidue90: 15 });
    expect(naSunflowerPivotByYield.rows[2]?.highResidue90).toBe(0);
  });
  it("heliotest", () => {
    expect(naSunflowerHeliotest.rows).toHaveLength(4);
    expect(naSunflowerHeliotest.rows[0]).toMatchObject({ y25to30: 30, y30to35: 40, y35to40: 70, y40plus: 100 });
    expect(naSunflowerHeliotest.rows[3]?.y40plus).toBe(40);
  });
});

describe("annexes 4.x: ceilings", () => {
  it("crop groups valid", () => {
    for (const t of [naVegetableCeilings, naLegumeCeilings, naOtherCeilings]) for (const r of t.rows) for (const c of r.crops) expect(cropSet.has(c), c).toBe(true);
  });
  it("vegetables", () => {
    expect(naVegetableCeilings.rows).toHaveLength(38);
    const v = (l: string) => naVegetableCeilings.rows.find((r) => r.cropLabel === l)?.doseKgNHa;
    expect(v("Tomates sous serres")).toBe(420);
    expect(v("Chou-fleur")).toBe(340);
    expect(v("Mâche")).toBe(70);
    expect(v("Asperges (départements 33 et 40) – Production")).toBe(350);
    expect(naAsparagusReference3340.rows).toHaveLength(4);
  });
  it("legumes", () => {
    expect(naLegumeCeilings.rows).toHaveLength(5);
    expect(naLegumeCeilings.rows.find((r) => r.cropLabel === "Pois potager")?.doseKgNHa).toBe(50);
    expect(naLegumeCeilings.rows.find((r) => r.cropLabel === "Luzerne")?.doseKgNHa).toBe(30);
    expect(naLegumeCeilings.rows.find((r) => r.cropLabel.startsWith("Pois chiche"))).toMatchObject({ doseKgNHa: 100, doseMinKgNHa: 50 });
    expect(naLegumeNitrogenAuthorisations.rows.filter((r) => r.allowed === "forbidden")).toHaveLength(2);
    expect(naSoyNodulationPivot.rows.map((r) => r.mineralNKgNHa)).toEqual([80, 100, 120, 140, 150]);
  });
  it("other crops incl. vine special case", () => {
    expect(naOtherCeilings.rows).toHaveLength(35);
    const vine = naOtherCeilings.rows.filter((r) => r.crops.includes("vine"));
    expect(vine).toEqual([
      expect.objectContaining({ doseKgNHa: 80, period: "year", mineralOnly: true }),
      expect.objectContaining({ doseKgNHa: 240, period: "3_years" }),
    ]);
    const o = (l: string) => naOtherCeilings.rows.find((r) => r.cropLabel === l)?.doseKgNHa;
    expect(o("Menthe poivrée")).toBe(260);
    expect(o("Persil")).toBe(320);
    expect(o("Chanvre")).toBe(120);
    expect(o("Sarrasin")).toBe(50);
    expect(o("Pommiers")).toBe(100);
    expect(naOtherCeilings.rows.filter((r) => r.crops.includes("ppam"))).toHaveLength(19);
    expect(naOtherCeilings.rows.filter((r) => r.crops.includes("seed_crops"))).toHaveLength(8);
    expect(naOtherCeilings.rows.at(-1)).toMatchObject({ doseKgNHa: 210, crops: ["other"] });
  });
  it("cover crops", () => {
    expect(naCoverCropListedPro.rows.filter((r) => r.table === 1)).toHaveLength(15);
    expect(naCoverCropListedPro.rows.filter((r) => r.table === 3)).toHaveLength(10);
    const t1 = (p: string) => naCoverCropListedPro.rows.find((r) => r.table === 1 && r.product === p);
    expect(t1("Fumier de bovin décomposé d'étable animaux entravés")).toMatchObject({ nTotal: 5.3, maxJul1Sep30: 29, maxOct1Nov15: 44 });
    expect(t1("Fientes de volaille avec litière")).toMatchObject({ nTotal: 25, maxJul1Sep30: 6, maxOct1Nov15: 8 });
    expect(t1("Boues mixtes papetières")).toMatchObject({ useForecastDose: true, maxJul1Sep30: null });
    expect(naCoverCropListedPro.rows.find((r) => r.table === 3 && r.product.startsWith("Fumier de bovin"))?.maxBanPeriod).toBe(63);
    expect(naCoverCropUnlistedPro.rows).toHaveLength(32);
    const u = (t: number, cn: string, nm: string) => naCoverCropUnlistedPro.rows.find((r) => r.table === t && r.cnClass === cn && r.nminNtotClass === nm);
    expect(u(2, "<=8", ">40")).toMatchObject({ maxNtotJul1Sep30: 93, maxNtotOct1Nov15: 100 });
    expect(u(4, ">8 ; <=10", "<=20")?.maxNtotBanPeriod).toBe(286);
    expect(u(5, "<=8", "<=20")?.maxNtotBanPeriod).toBe(156);
    expect(u(6, ">10 ; <=20", ">40")?.maxNtotBanPeriod).toBe(33);
    expect(u(6, ">20", "<=20")).toMatchObject({ useForecastDose: true, maxNtotBanPeriod: null });
    expect(naCoverCropRules.typeIILowLoadedMaxAplshKgHa).toBe(70);
    expect(naExportedCoverCrops.rows).toHaveLength(2);
  });
});

describe("yield references", () => {
  it("12 departments x 23 crops, nd kept as null", () => {
    expect(naYieldReferences.rows).toHaveLength(276);
    expect(naYieldReferences.rows.filter((r) => r.yieldQHa === null)).toHaveLength(10);
    const keys = naYieldReferences.rows.map((r) => `${r.cropLabel}|${r.department}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of naYieldReferences.rows) {
      expect(NA_DEPARTMENTS).toContain(r.department);
      for (const c of r.crops) expect(cropSet.has(c), c).toBe(true);
    }
  });
  it("spot values", () => {
    const y = (l: string, d: string) => naYieldReferences.rows.find((r) => r.cropLabel === l && r.department === d)?.yieldQHa;
    expect(y("Maïs grain irrigué", "40")).toBe(119);
    expect(y("Maïs grain non irrigué", "79")).toBe(60);
    expect(y("Blé tendre d'hiver et épeautre", "86")).toBe(63);
    expect(y("Colza d'hiver", "23")).toBe(34);
    expect(y("Kiwi", "86")).toBeNull();
    expect(y("Maïs semence", "87")).toBeNull();
    expect(naYieldReferences.rows.find((r) => r.cropLabel === "Maïs grain irrigué")?.irrigated).toBe(true);
  });
});

describe("annexe 6: RSH", () => {
  it("rows and keys", () => {
    expect(naRshRecommendations.rows).toHaveLength(22);
    const keys = naRshRecommendations.rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const v = (k: string) => naRshRecommendations.rows.find((r) => r.key === k)?.value;
    expect(v("depth_minimum")).toBe(60);
    expect(v("cores_per_horizon")).toBe(12);
    expect(v("zone_area")).toBe(2000);
    expect(v("storage_fridge")).toBe(48);
  });
});
