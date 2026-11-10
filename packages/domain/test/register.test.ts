import { describe, it, expect } from "vitest";
import { officialRegisterCsv, officialRegisterLine, registerDose, registerNumber, type RawRegisterLine } from "../src/register.js";

const raw: RawRegisterLine = {
  inputId: "in-1",
  targetId: "tg-1",
  interventionId: "int-1",
  landParcelId: "lp-1",
  parcelName: "Les Vignes",
  activityId: "act-1",
  procedureLabel: "Pulvérisation",
  startedAt: "2026-06-10T06:05:00Z",
  stoppedAt: "2026-06-10T08:40:00Z",
  productName: "Fongicide X",
  amm: "2150537",
  quantity: 2,
  unit: "liter_per_hectare",
  interventionAreaM2: 50_000,
  treatedAreaM2: 30_000,
  parcelAreaM2: 40_000,
  lat: 44.812345678,
  lon: 0.501234567,
  cropOepp: "VITVI",
  bbchLabel: "BBCH 57",
  organic: false,
  usageTarget: "Mildiou",
  siret: "12345678900011",
  pacage: "032123456",
  campaign: 2026,
};

describe("registre phyto réglementaire : une ligne", () => {
  it("intitulés et formats de la notice (heure locale, JJ/MM/AAAA, 9999.9999)", () => {
    const l = officialRegisterLine(raw);
    expect(l).toMatchObject({
      idTraitement: "in-1:tg-1",
      idIntervention: "int-1",
      siretApplicateur: "12345678900011",
      numeroAMMProduit: "2150537",
      dateIntervention: "10/06/2026",
      heureDebut: "08:05",
      heureFin: "10:40",
      doseProduitValeur: "2",
      doseProduitUnite: "L/ha",
      surfaceTraitee: "3.00",
      surfaceUnite: "ha",
      coordonneesGps: "44.81235 ; 0.50123",
      cultureOepp: "VITVI",
      codeBbch: "BBCH 57",
      modeDeConduite: "Non",
      usageCible: "Mildiou",
      modeApplication: "Pulvérisation",
      campagne: "2026",
      pacage: "032123456",
      partSurfaceTraitee: "75",
      anomalies: [],
    });
  });

  it("champs obligatoires manquants listés dans anomalies", () => {
    const l = officialRegisterLine({ ...raw, siret: null, amm: "AMM?", cropOepp: null, lat: null, lon: null });
    expect(l.anomalies).toEqual(["siretApplicateur", "numeroAMMProduit", "cultureOepp", "coordonneesGps"]);
    expect(l.numeroAMMProduit).toBe("");
  });

  it("dose : quantité totale ramenée à l'hectare, grammes en kg", () => {
    expect(registerDose(10, "liter", 40_000)).toEqual({ value: "2.5", unit: "L/ha" });
    expect(registerDose(500, "gram_per_hectare", 10_000)).toEqual({ value: "0.5", unit: "kg/ha" });
    expect(registerDose(3, "thousand_per_hectare", 10_000)).toEqual({ value: "3", unit: "unité/ha" });
    expect(registerDose(3, "liter", 0)).toEqual({ value: "", unit: "" });
    expect(registerNumber(1 / 3)).toBe("0.3333");
  });

  it("CSV : BOM, « ; », intitulés standard, cellule GPS entre guillemets", () => {
    const csv = officialRegisterCsv([officialRegisterLine(raw)]);
    expect(csv.startsWith("﻿idTraitement;idIntervention;siretApplicateur;")).toBe(true);
    expect(csv).toContain(';"44.81235 ; 0.50123";VITVI;BBCH 57;Non;\r\n');
    expect(csv.split("\r\n")[0]!.split(";")).toHaveLength(26);
  });
});
