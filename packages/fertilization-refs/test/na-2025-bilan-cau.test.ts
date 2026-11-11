import { describe, it, expect } from "vitest";
import { NA_SOIL_TYPES, CROP_GROUPS } from "../src/types.js";
import {
  bilanCauTables,
  cerealsB,
  cerealsCau,
  cerealsMh,
  cerealsRf,
  equations,
  maizeB,
  maizeCau,
  maizeMh,
  maizeRf,
  maizeSeedCof,
  maizeSeedPf,
  mhp,
  mr,
  mrci,
  nirr,
  nirrExamples,
  piTillers,
  precedentsApl,
  riAfterCover,
  riCerealsApl,
  riGrassland,
  riLegume,
  riMaizeApl,
  valueA,
  valueAAnnual,
} from "../src/na-2025/bilan-cau.js";

const tables = Object.entries(bilanCauTables);

describe("NA 2025 bilan CAU : métadonnées", () => {
  it.each(tables)("%s porte la source de l'arrêté du 29/07/2025", (_name, table) => {
    expect(table.source.date).toBe("2025-07-29");
    expect(table.source.ref?.trim().length ?? 0).toBeGreaterThan(0);
    expect(table.source.licence.length).toBeGreaterThan(0);
    expect(table.rows.length).toBeGreaterThan(0);
  });

  it("ids uniques", () => {
    const ids = tables.map(([, t]) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toute clé de sol est un NaSoilType et toute culture un CropGroup", () => {
    for (const [, table] of tables) {
      for (const row of table.rows as object[]) {
        if ("soil" in row) expect(NA_SOIL_TYPES).toContain((row as { soil: string }).soil);
        if ("sameAs" in row) expect(NA_SOIL_TYPES).toContain((row as { sameAs: string }).sameAs);
        if ("crop" in row) expect(CROP_GROUPS).toContain((row as { crop: string }).crop);
        if ("crops" in row) for (const c of (row as { crops: string[] }).crops) expect(CROP_GROUPS).toContain(c);
      }
    }
  });
});

describe("nombre de lignes", () => {
  it.each([
    ["maizeB", maizeB.rows.length, 16],
    ["cerealsB", cerealsB.rows.length, 8],
    ["maizeSeedPf", maizeSeedPf.rows.length, 13],
    ["maizeSeedCof", maizeSeedCof.rows.length, 9],
    ["maizeRf", maizeRf.rows.length, 8],
    ["cerealsRf", cerealsRf.rows.length, 8],
    ["piTillers", piTillers.rows.length, 7],
    ["precedentsApl", precedentsApl.rows.length, 22],
    ["valueA", valueA.rows.length, 3],
    ["valueAAnnual", valueAAnnual.rows.length, 1],
    ["riMaizeApl", riMaizeApl.rows.length, 6 * 6 * 9],
    ["riCerealsApl", riCerealsApl.rows.length, 6 * 6 * 9],
    ["riLegume", riLegume.rows.length, 3],
    ["riGrassland", riGrassland.rows.length, 20],
    ["riAfterCover", riAfterCover.rows.length, 8],
    ["maizeMh", maizeMh.rows.length, 8],
    ["cerealsMh", cerealsMh.rows.length, 8],
    ["mhp", mhp.rows.length, 65],
    ["mr", mr.rows.length, 23],
    ["mrci", mrci.rows.length, 84],
    ["nirr", nirr.rows.length, 2],
    ["nirrExamples", nirrExamples.rows.length, 30],
    ["maizeCau", maizeCau.rows.length, 7],
    ["cerealsCau", cerealsCau.rows.length, 2],
  ])("%s : %i lignes", (_n, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("chaque sol couvert une fois par les tables par sol", () => {
    for (const t of [maizeRf, cerealsRf, riAfterCover, maizeMh, cerealsMh]) {
      expect(new Set(t.rows.map((r) => r.soil))).toEqual(new Set(NA_SOIL_TYPES));
    }
  });

  it("grilles APL : marais et granite absents, aucune combinaison en double", () => {
    for (const t of [riMaizeApl, riCerealsApl]) {
      const soils = new Set(t.rows.map((r) => r.soil));
      expect(soils.has("marais_argileux_sodiques")).toBe(false);
      expect(soils.has("sur_granite")).toBe(false);
      const keys = t.rows.map((r) => `${r.soil}|${r.aplKgNHa}|${r.rainMm}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

const findRi = (soil: string, apl: number, rain: number) =>
  riMaizeApl.rows.find((r) => r.soil === soil && r.aplKgNHa === apl && r.rainMm === rain)?.riKgNHa;
const findRiPi = (soil: string, apl: number, rain: number) =>
  riCerealsApl.rows.find((r) => r.soil === soil && r.aplKgNHa === apl && r.rainMm === rain)?.riPlusPiKgNHa;

describe("valeurs ponctuelles contrôlées sur le rendu PDF", () => {
  it("b maïs/sorgho (2.2.b tableau 1)", () => {
    const g = maizeB.rows.find((r) => r.crop === "maize_grain" && r.yieldMin === 100)!;
    expect(g).toMatchObject({ b: 2.2, yieldMinInclusive: true, yieldMax: 120, yieldMaxInclusive: true, unit: "q" });
    expect(maizeB.rows.find((r) => r.crop === "maize_popcorn")!.b).toBe(4.1);
    expect(maizeB.rows.find((r) => r.variant === "epis_nus")!.b).toBe(12);
    expect(maizeB.rows.find((r) => r.crop === "sorghum_grain" && r.yieldMin === 50)!).toMatchObject({
      b: 2.5,
      yieldMax: 80,
      yieldMaxInclusive: false,
    });
    expect(maizeB.rows.find((r) => r.crop === "sorghum_silage" && r.yieldMin === 15)!.b).toBe(12.5);
  });

  it("b céréales (2.1.b tableau 1)", () => {
    const by = (k: string) => cerealsB.rows.find((r) => r.key === k)!;
    expect(by("avoine").b).toBe(2.2);
    expect(by("ble_dur").b).toBe(3.7);
    expect(by("ble_tendre_ameliorant").b).toBe(3.5);
    expect(by("triticale").b).toBe(2.6);
  });

  it("maïs semence (tableaux 3a, 3b)", () => {
    expect(maizeSeedPf.rows.find((r) => r.yieldMinQ === 30)!.pfFemaleKgNHa).toBe(125);
    expect(maizeSeedPf.rows.find((r) => r.yieldMinQ === 60)!.pfFemaleKgNHa).toBe(155);
    expect(maizeSeedPf.rows.at(-1)!).toMatchObject({ yieldMinQ: 70, yieldMinInclusive: true, pfFemaleKgNHa: 165 });
    expect(maizeSeedCof.rows.find((r) => r.key === "2x1x2x2_reduit")!.cof).toBe(0.63);
    expect(maizeSeedCof.rows.find((r) => r.key === "4x2_reduit")!.cof).toBe(0.71);
  });

  it("Rf et renvois (*)", () => {
    const marais = maizeRf.rows.find((r) => r.soil === "marais_argileux_sodiques")!;
    expect(marais).toMatchObject({ rfKgNHa: null, sameAs: "fond_vallee_terres_noires" });
    expect(cerealsRf.rows.find((r) => r.soil === "sur_granite")!.sameAs).toBe("argileux_sablo_argileux");
    expect(maizeRf.rows.find((r) => r.soil === "terrasses_vallees")!.rfKgNHa).toBe(15);
    for (const t of [maizeRf, cerealsRf])
      for (const r of t.rows) if (r.sameAs) expect(t.rows.find((x) => x.soil === r.sameAs)!.rfKgNHa).not.toBeNull();
  });

  it("Pi selon les talles", () => {
    expect(piTillers.rows[0]!.piKgNHa).toBe(10);
    expect(piTillers.rows.find((r) => r.tillersMax === null)!.piKgNHa).toBe(40);
  });

  it("précédents (tableau 7)", () => {
    const by = (k: string) => precedentsApl.rows.find((r) => r.key === k)!;
    expect(by("ble_dur_pailles_restituees")).toMatchObject({ bpBase: 3.5, strawReturnedBonus: 0.3, coefRpr: 0.27 });
    expect(by("mais_semence")).toMatchObject({ bpBase: 5.7, coefRpr: 0.48 });
    expect(by("colza").coefRpr).toBe(0.4);
    expect(by("sorgho_grain").bpBase).toBe(2.8);
    expect(by("autres_cultures")).toMatchObject({ bpBase: null, coefRpr: 0.4 });
    for (const r of precedentsApl.rows) if (r.strawReturned) expect(r.strawReturnedBonus).toBe(0.3);
  });

  it("valeur A", () => {
    expect(valueA.rows.map((r) => r.aKgNHa)).toEqual([160, 120, 70]);
    expect(valueAAnnual.rows[0]).toMatchObject({ year: 2025, aKgNHa: 140 });
  });

  it("grille Ri maïs (2.2.b tableau 8)", () => {
    expect(findRi("argilo_calcaire", 0, 250)).toBe(36);
    expect(findRi("sableux", 100, 250)).toBe(148);
    expect(findRi("fond_vallee_terres_noires", 100, 400)).toBe(102);
    expect(findRi("limoneux", 80, 800)).toBe(28);
    expect(findRi("terrasses_vallees", 60, 350)).toBe(78);
    expect(findRi("argileux_sablo_argileux", 100, 700)).toBe(17);
  });

  it("grille Ri + Pi céréales (2.1.b tableau 10)", () => {
    expect(findRiPi("argilo_calcaire", 100, 150)).toBe(104);
    expect(findRiPi("sableux", 0, 250)).toBe(31);
    expect(findRiPi("fond_vallee_terres_noires", 100, 600)).toBe(38);
    expect(findRiPi("limoneux", 60, 300)).toBe(57);
    expect(findRiPi("terrasses_vallees", 100, 200)).toBe(112);
    expect(findRiPi("argileux_sablo_argileux", 0, 450)).toBe(21);
  });

  it("légumineuses, prairies, après CI", () => {
    expect(riLegume.rows.find((r) => r.key === "pois")).toMatchObject({ constantKgNHa: 30, coefA: 0.5 });
    expect(
      riGrassland.rows.find(
        (r) => r.mode === "fauche_paturage" && r.precedent === "prairie_3_6_ans",
      ),
    ).toMatchObject({ constantKgNHa: 52.5, coefA: 0.3 });
    expect(
      riGrassland.rows.find(
        (r) => r.productionType === "association_graminees_legumineuses" && r.precedent === "jachere_annuelle",
      )!.constantKgNHa,
    ).toBe(20);
    expect(riAfterCover.rows.find((r) => r.soil === "sableux")!.riKgNHa).toBe(15);
    expect(riAfterCover.rows.find((r) => r.soil === "sur_granite")!.riKgNHa).toBeNull();
  });

  it("Mh", () => {
    expect(maizeMh.rows.find((r) => r.soil === "sableux")).toMatchObject({
      dryKgNHa: 55,
      irrigatedKgNHa: 70,
      sweetSeedKgNHa: 40,
    });
    expect(maizeMh.rows.find((r) => r.soil === "marais_argileux_sodiques")!.irrigatedKgNHa).toBeNull();
    expect(cerealsMh.rows.find((r) => r.soil === "argileux_sablo_argileux")!.mhKgNHa).toBe(25);
    expect(cerealsMh.rows.find((r) => r.soil === "terrasses_vallees")!.mhKgNHa).toBe(35);
  });

  it("Mhp", () => {
    const get = (d: string, rank: number, mode: string | null, age: string, type?: string) =>
      mhp.rows.find(
        (r) =>
          r.destruction === d &&
          r.rank === rank &&
          r.mode === mode &&
          r.ageClass === age &&
          (type === undefined || r.productionType === type),
      )!.mhpKgNHa;
    expect(get("spring", 1, "pature_integrale", "gt_10_years")).toBe(140);
    expect(get("spring", 2, "fauche_paturage", "6_10_years")).toBe(24.5);
    expect(get("autumn", 1, "fauche_integrale", "4_5_years")).toBe(20);
    expect(get("autumn", 1, null, "2_3_years", "association_graminees_legumineuses")).toBe(30);
    expect(mhp.rows.filter((r) => r.destruction === "autumn" && r.rank === 2).every((r) => r.mhpKgNHa === 0)).toBe(true);
  });

  it("Mr", () => {
    const by = (k: string) => mr.rows.find((r) => r.key === k)!;
    expect(by("cereales_pailles_enfouies")).toMatchObject({ endOfWinterKgNHa: -20, aprilKgNHa: -10 });
    expect(by("ray_grass_derobe")).toMatchObject({ endOfWinterKgNHa: -30, aprilKgNHa: 0 });
    expect(by("luzerne_printemps")).toMatchObject({ endOfWinterKgNHa: 60, aprilKgNHa: 60 });
    expect(new Set(mr.rows.map((r) => r.key)).size).toBe(mr.rows.length);
  });

  it("MrCi", () => {
    const get = (f: string, b: string, d: string, o: string) =>
      mrci.rows.find((r) => r.family === f && r.biomass === b && r.destruction === d && r.opening === o)!.mrciKgNHa;
    expect(get("legumineuses", "ge_3", "after_january", "end_of_winter")).toBe(40);
    expect(get("melange_graminees_legumineuses", "le_1", "after_january", "end_of_winter")).toBe(13);
    expect(get("melange_cruciferes_legumineuses", "1_3", "nov_dec", "april")).toBe(8);
    expect(get("graminees_seigle_avoine", "le_1", "after_january", "april")).toBe(0);
    expect(get("hydrophyllacees", "ge_3", "after_january", "april")).toBe(10);
  });

  it("CAU", () => {
    const seedHigh = maizeCau.rows.find((r) => r.crops.includes("maize_seed") && r.yieldMinQ === 30)!;
    expect(seedHigh).toMatchObject({ cau: 0.8, yieldMinInclusive: false, stage: "4_to_12_leaves" });
    expect(maizeCau.rows.find((r) => r.crops.includes("maize_sweet") && r.stage === "4_to_12_leaves")!.cau).toBe(0.7);
    expect(maizeCau.rows.filter((r) => r.stage === "before_4_leaves").every((r) => r.cau === 0.6)).toBe(true);
    expect(cerealsCau.rows.map((r) => r.cau)).toEqual([0.9, 0.8]);
    expect(cerealsCau.rows[1]!.conditionText).toContain("excès d'eau");
  });

  it("équations : Xa hors de la barre de fraction, plafond 50 avant 4 feuilles", () => {
    expect(equations.maize.general.numerator).not.toContain("Xa");
    expect(equations.cereals.general.numerator).toContain("Pi");
    expect(equations.maize.firstApplicationCap.maxKgNHa).toBe(50);
  });
});

describe("Nirr", () => {
  it("paramètres", () => {
    expect(nirr.rows.find((r) => r.scope === "maize_sorghum")).toMatchObject({
      divisor: 443,
      thresholdMm: 100,
      surfaceNo3MgL: 25,
      groundNo3MgL: 40,
    });
    expect(nirr.rows.find((r) => r.scope === "straw_cereals")!.thresholdMm).toBe(120);
  });

  it.each(nirrExamples.rows.map((r) => [r.scope, r.waterSource, r.waterMm, r.nKgNHa, r.no3MgL] as const))(
    "%s %s %i mm → %i kg N (arrondi au plus proche)",
    (scope, _src, mm, n, no3) => {
      const params = nirr.rows.find((r) => r.scope === scope)!;
      expect(Math.round((mm * no3) / params.divisor)).toBe(n);
    },
  );
});
