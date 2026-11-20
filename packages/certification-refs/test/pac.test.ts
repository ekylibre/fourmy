import { describe, it, expect } from "vitest";
import {
  BCAE7_2026,
  BCAE7_ANNEX1_CODES,
  BCAE7_ANNEX1_WITHOUT_CATEGORY,
  BCAE7_ANNEX2_LEGUMES,
  BCAE7_CATEGORIES,
  BCAE7_NON_ARABLE_CODES,
  bcae7Category,
} from "../src/index.js";

const allCodes = BCAE7_CATEGORIES.flatMap((c) => c.codes);

describe("BCAE 7 2026 : catégories (annexes 3 et 4)", () => {
  it("51 catégories (22 lignes p. 20, 29 p. 21), chaque code culture dans une seule", () => {
    expect(BCAE7_CATEGORIES).toHaveLength(51);
    expect(new Set(allCodes).size).toBe(allCodes.length);
    expect(new Set(BCAE7_CATEGORIES.map((c) => c.id)).size).toBe(BCAE7_CATEGORIES.length);
  });

  it("codes de trois lettres, en majuscules", () => {
    for (const code of [...allCodes, ...BCAE7_ANNEX1_CODES, ...BCAE7_NON_ARABLE_CODES]) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it("hiver et printemps sont des cultures différentes ; féveroles d'hiver et de printemps, une seule", () => {
    expect(bcae7Category("BTH")!.id).not.toBe(bcae7Category("BTP")!.id);
    expect(bcae7Category("CZH")!.id).not.toBe(bcae7Category("CZP")!.id);
    expect(bcae7Category("FVP")!.id).toBe(bcae7Category("FVL")!.id);
    expect(bcae7Category("mis")!.label).toBe("Maïs et maïs semence");
  });

  it("renvois de l'annexe 3 : exclusions de la rotation annuelle, cultures par code, cultures associées", () => {
    const excluded = BCAE7_CATEGORIES.filter((c) => c.annualExcluded).map((c) => c.id);
    expect(excluded.sort()).toEqual(["betterave", "herbe", "lupin-hiver", "lupin-printemps", "luzerne", "ppam"]);
    expect(BCAE7_CATEGORIES.filter((c) => c.perCode).map((c) => c.id).sort()).toEqual(["fruits-legumes-fleurs", "ppam"]);
    expect(bcae7Category("CID")!.rotationByNature).toBe(true);
  });

  it("annexe 1 : chaque code a une catégorie, sauf canne à sucre et houblon", () => {
    for (const code of BCAE7_ANNEX1_CODES) {
      if (BCAE7_ANNEX1_WITHOUT_CATEGORY.includes(code)) expect(bcae7Category(code)).toBeUndefined();
      else expect(bcae7Category(code), code).toBeDefined();
    }
  });

  it("terres non arables et terres arables ne se recoupent pas", () => {
    const arable = new Set([...allCodes, ...BCAE7_ANNEX1_CODES]);
    expect(BCAE7_NON_ARABLE_CODES.filter((c) => arable.has(c))).toEqual([]);
  });

  it("légumineuses de l'annexe 2 : toutes classées", () => {
    for (const code of BCAE7_ANNEX2_LEGUMES) expect(bcae7Category(code), code).toBeDefined();
  });

  it("seuils de la fiche", () => {
    expect(BCAE7_2026.annualMinShare).toBe(0.35);
    expect(BCAE7_2026.multiannualYears).toBe(4);
    expect(BCAE7_2026.diversification.largeFarm).toMatchObject({ minCrops: 3, mainMaxShare: 0.75, twoMainMaxShare: 0.95, toleranceHa: 2 });
    expect(BCAE7_2026.diversification.smallFarm).toMatchObject({ minCrops: 2, mainMaxShare: 0.75, toleranceHa: 0.5 });
  });
});
