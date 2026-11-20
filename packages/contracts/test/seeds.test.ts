import { describe, it, expect } from "vitest";
import { lotSeedWrite, mixtureComponentsWrite, mixtureDose, seedSheetWrite } from "../src/index.js";

/** Semences, lot SE1 : règles de la fiche, d'un mélange et du PMG d'un lot. */
describe("contrat des semences", () => {
  it("fiche d'un maïs à la dose, PMG de l'étiquette", () => {
    const s = seedSheetWrite.parse({ species: "zea_mays", varietyName: "P0573", grainsPerDose: 50000, tgwG: 300, tgwOrigin: "label" });
    expect(s).toMatchObject({ isMixture: false, gnisCode: null, tgwOn: null });
  });

  it("PMG sans origine, ou mélange avec espèce ou PMG : refusés", () => {
    expect(seedSheetWrite.safeParse({ tgwG: 42 }).success).toBe(false);
    expect(seedSheetWrite.safeParse({ isMixture: true, species: "avena_sativa" }).success).toBe(false);
    expect(seedSheetWrite.safeParse({ isMixture: true, tgwG: 40, tgwOrigin: "label" }).success).toBe(false);
    expect(seedSheetWrite.safeParse({ tgwG: 2500, tgwOrigin: "label" }).success).toBe(false);
  });

  it("espèces d'un mélange : pas de doublon", () => {
    expect(mixtureComponentsWrite.safeParse([{ label: "Avoine" }, { label: "Radis" }]).success).toBe(true);
    expect(mixtureComponentsWrite.safeParse([{ label: "Avoine" }, { label: "avoine" }]).success).toBe(false);
  });

  it("PMG d'un lot et dose d'une espèce au semis", () => {
    expect(lotSeedWrite.parse({ tgwG: 48, origin: "label" })).toEqual({ tgwG: 48, origin: "label", on: null });
    expect(mixtureDose.safeParse({ label: "Avoine", kgHa: 0 }).success).toBe(false);
  });
});
