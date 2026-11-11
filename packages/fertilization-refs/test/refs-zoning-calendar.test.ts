import { describe, expect, it } from "vitest";
import { adourGaronneVulnerableZones2026 as zv } from "../src/zoning/adour-garonne-2026.js";
import {
  calendarPeriods,
  calendarTexts,
  communeZones,
  fertilizersByType,
  pan7Notes,
  periodTexts,
} from "../src/calendar/pan7.js";
import { naSplittingRules } from "../src/na-2025/splitting.js";
import {
  durumWheatSudOuestDefaultBq14,
  durumWheatSudOuestVarietyNeeds2026 as bd,
  softWheatVarietyNeeds2026 as bth,
} from "../src/varieties/wheat-2026.js";

describe("zones vulnérables Adour-Garonne 2026", () => {
  it("compte les communes de l'annexe", () => {
    expect(zv.rows).toHaveLength(3312);
    expect(zv.rows.filter((r) => r.status === "partial")).toHaveLength(338);
    expect(zv.rows.filter((r) => r.status === "total")).toHaveLength(2974);
  });

  it("a des codes INSEE uniques, cohérents avec le département", () => {
    expect(new Set(zv.rows.map((r) => r.insee)).size).toBe(zv.rows.length);
    for (const r of zv.rows) {
      expect(r.insee).toMatch(/^\d[0-9AB]\d{3}$/);
      expect(r.insee.startsWith(r.department)).toBe(true);
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it("couvre les départements du bassin", () => {
    const deps = [...new Set(zv.rows.map((r) => r.department))].sort();
    expect(deps).toEqual(["09", "11", "12", "16", "17", "24", "31", "32", "33", "40", "46", "47", "64", "65", "79", "81", "82", "86"]);
    expect(zv.rows.filter((r) => r.department === "64")).toHaveLength(248);
  });

  it("classe en totalité les deux communes du Béarn", () => {
    const m = zv.rows.find((r) => r.insee === "64389");
    const s = zv.rows.find((r) => r.insee === "64488");
    expect(m).toMatchObject({ name: "MONASSUT-AUDIRACQ", department: "64", status: "total" });
    expect(s).toMatchObject({ name: "SAINT-LAURENT-BRETAGNE", department: "64", status: "total" });
  });

  it("décrit les communes partielles", () => {
    for (const r of zv.rows.filter((x) => x.status === "partial")) expect(r.detail).toBeTruthy();
    expect(zv.rows.find((r) => r.insee === "09021")?.detail).toBe("sections: 090210000A, 090210000C; feuilles: 090210000B03, 090210000B01");
    expect(zv.rows.find((r) => r.insee === "64181")?.name).toBe("CASTILLON (CANTON D'ARTHEZ-DE-BEARN)");
  });
});

describe("calendrier d'épandage (PAN7, Nouvelle-Aquitaine 2025-2026)", () => {
  const cereals = calendarPeriods.rows.filter(
    (r) => r.cropSubCategory.startsWith("culture principale autre que colza") && r.fertilizerType === "III",
  );

  it("reste en région 75 et référence des textes existants", () => {
    expect(calendarPeriods.rows).toHaveLength(149);
    for (const r of calendarPeriods.rows) {
      expect(r.region).toBe("75");
      expect(r.from).toMatch(/^\d{2}-\d{2}$/);
      expect(r.to).toMatch(/^\d{2}-\d{2}$/);
      for (const ref of [r.startComplementRef, r.prescriptionPanRef, r.prescriptionParRef]) {
        if (ref !== undefined) expect(calendarTexts[ref]).toBeTruthy();
      }
    }
    expect(fertilizersByType.II).toHaveLength(19);
  });

  it("céréales d'automne, type III : 1er septembre - 31 janvier hors zone sud (PAN)", () => {
    expect(cereals.find((r) => r.zone.sud === false && r.zone.ouest === false)).toMatchObject({ from: "09-01", to: "01-31" });
  });

  it("note (5) : fin au 15 janvier en zone sud (dont Pyrénées-Atlantiques)", () => {
    expect(pan7Notes.some((n) => n.startsWith("(5)") && n.includes("Pyrénées Atlantiques") && n.includes("15 janvier"))).toBe(true);
    expect(cereals.find((r) => r.zone.sud === true && r.zone.ouest === false)).toMatchObject({ from: "09-01", to: "01-15" });
    // zone ouest : renforcement régional dès le 1er juillet, avec dérogations en prescription PAR
    const ouestSud = cereals.find((r) => r.zone.sud === true && r.zone.ouest === true);
    expect(ouestSud).toMatchObject({ from: "07-01", to: "01-15" });
    expect(ouestSud && periodTexts(ouestSud).prescriptionPar).toContain("cependant autorisé");
  });

  it("note (4) : maïs irrigué, type III jusqu'au brunissement des soies", () => {
    const n4 = pan7Notes.find((n) => n.startsWith("(4)"));
    expect(n4).toBe(
      "(4) En présence d’une culture irriguée, l’apport de fertilisants azotés de type III est autorisé jusqu’au 15 juillet et, sur maïs irrigué, jusqu’au stade du brunissement des soies du maïs.",
    );
    const spring = calendarPeriods.rows.find(
      (r) => r.cropSubCategory.startsWith("Culture de printemps ou d'hiver exportée") && r.fertilizerType === "III",
    );
    expect(spring).toMatchObject({ from: "07-01", to: "02-15" });
    expect(spring && periodTexts(spring).prescriptionPan).toContain("maïs irrigué");
  });

  it("communes : Béarn en zone ouest et zone sud, insee uniques", () => {
    expect(communeZones.rows).toHaveLength(4306);
    expect(new Set(communeZones.rows.map((r) => r.insee)).size).toBe(4306);
    expect(communeZones.rows.find((r) => r.insee === "64389")).toEqual({ insee: "64389", name: "MONASSUT AUDIRACQ", zv: "in", ouest: true, sud: true });
    expect(communeZones.rows.find((r) => r.insee === "64488")).toEqual({ insee: "64488", name: "SAINT LAURENT BRETAGNE", zv: "in", ouest: true, sud: true });
    expect(communeZones.rows.every((r) => !r.est)).toBe(true);
  });
});

describe("fractionnement (guide PAR7 Nouvelle-Aquitaine)", () => {
  it("reprend les tableaux 6 à 8", () => {
    const [c, r, m] = naSplittingRules.rows;
    expect(c).toMatchObject({ table: 6, firstApplicationCapKgN: 50 });
    expect(c?.minApplications.map((x) => [x.count, x.doseFromKgN, x.doseToKgN])).toEqual([[2, 110, 160], [3, 160, null]]);
    expect(r).toMatchObject({ table: 7, firstApplicationCapKgN: 80 });
    expect(r?.minApplications.map((x) => [x.count, x.doseFromKgN, x.doseToKgN])).toEqual([[2, 80, 170], [3, 170, null]]);
    expect(m).toMatchObject({ table: 8, firstApplicationCapKgN: 50 });
    expect(m?.minApplications.map((x) => [x.count, x.doseFromKgN])).toEqual([[2, 120]]);
  });
});

describe("besoins unitaires des variétés de blé 2026", () => {
  it("blé tendre", () => {
    expect(bth.rows).toHaveLength(120);
    expect(new Set(bth.rows.map((r) => r.variety)).size).toBe(120);
    expect(bth.rows.find((r) => r.variety === "LG NIKLAS")).toMatchObject({ b: 2.8, bq115: 2.8, bc: 0, endOfStemReserveKgN: 40 });
    expect(bth.rows.find((r) => r.variety === "CHEVIGNON")).toMatchObject({ b: 2.8, bq115: 3, bc: 0.2, endOfStemReserveKgN: 60 });
    expect(bth.rows.find((r) => r.variety === "UNIK")).toMatchObject({ b: 3.2, bq115: 3.2, bc: 0 });
    for (const r of bth.rows) expect(Math.round((r.b + r.bc) * 10) / 10).toBe(r.bq115);
  });

  it("blé dur Sud-Ouest", () => {
    expect(bd.rows).toHaveLength(70);
    expect(bd.rows.find((r) => r.variety === "RGT VOILUR")).toEqual({ variety: "RGT VOILUR", bq14: 3.5, endOfStemReserve: "40 kg N" });
    expect(bd.rows.find((r) => r.variety === "ANVERGUR")?.bq14).toBe(3.7);
    expect(bd.rows.find((r) => r.variety === "SARAGOLLA")).toMatchObject({ bq14: 3.9, endOfStemReserve: "De 60 à 80 kg N" });
    expect(durumWheatSudOuestDefaultBq14).toBe(3.7);
  });
});
