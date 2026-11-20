import { describe, it, expect } from "vitest";
import { DEFAULT_CERTIFICATION_SETTINGS } from "@fourmy/contracts";
import {
  cmrFindings,
  cmrInterventionFindings,
  diversityFindings,
  evaluateCampaign,
  hvePhytoFindings,
  iftFindings,
  untreatedFindings,
  type HveParcel,
  type HvePhytoContext,
  type HveTreatment,
  type HveYear,
} from "../src/index.js";

const parcel = (id: string, family: HveParcel["family"], areaM2 = 100_000, extra: Partial<HveParcel> = {}): HveParcel => ({ id, name: id, areaM2, family, species: null, variety: null, ...extra });
const treat = (parcelId: string, extra: Partial<HveTreatment> = {}): HveTreatment => ({
  interventionId: `i-${parcelId}`,
  day: "2026-05-01",
  parcelId,
  articleId: "a1",
  product: "Produit",
  authorization: null,
  biocontrol: false,
  treatedM2: null,
  ...extra,
});
const year = (extra: Partial<HveYear> = {}): HveYear => ({ campaign: 2026, parcels: [], treatments: [], ift: [], iftPending: [], ...extra });

describe("HVE 5.1 CMR", () => {
  it("CMR2 : 1 point perdu par catégorie ; aucun : 2 points", () => {
    expect(cmrFindings([], []).findings[0]!.points).toEqual({ got: 2, max: 2 });
    // 2000003 : SULTAN, herbicide CMR2.
    const r = cmrFindings([treat("p1", { authorization: "2000003", product: "SULTAN" })], []);
    expect(r.cmr1).toBe(false);
    expect(r.findings[0]).toMatchObject({ points: { got: 1, max: 2 } });
    expect(r.findings[0]!.message).toMatch(/herbicide\(s\) CMR2 : SULTAN/);
  });

  it("discordance avec les mentions de danger E-Phy : à vérifier, la liste fait foi", () => {
    const r = cmrFindings([treat("p1", { authorization: "2000003", hazardCmr: 1 })], []);
    expect(r.findings.find((f) => f.ruleId === "hve.5.1.hazards")).toMatchObject({ level: "warning" });
  });

  it("saisie : CMR2 orange ; produit non classé : rien", () => {
    expect(cmrInterventionFindings("2026-05-01", [{ articleId: "a", product: "SULTAN", authorization: "2000003" }])[0]).toMatchObject({ level: "warning" });
    expect(cmrInterventionFindings("2026-05-01", [{ articleId: "a", product: "X", authorization: "0000000" }])).toEqual([]);
  });
});

describe("HVE 5.2 surfaces non traitées", () => {
  it("biocontrôle seul = non traitée ; prairie permanente : seule la surface traitée compte", () => {
    const y = year({
      parcels: [parcel("p1", "field_crops"), parcel("p2", "field_crops"), parcel("pp", "permanent_grassland")],
      treatments: [treat("p1"), treat("p2", { biocontrol: true }), treat("pp", { treatedM2: 10_000 })],
    });
    // Traité : p1 (10 ha) + 1 ha de pp = 11 ha sur 30 : 63,3 % non traités → 6 points.
    expect(untreatedFindings(y)[0]).toMatchObject({ value: 63.33, points: { got: 6, max: 10 } });
  });
});

describe("HVE 5.3 IFT", () => {
  const ctx = (y: HveYear, extra: Partial<HvePhytoContext> = {}): HvePhytoContext => ({
    years: [y],
    average: false,
    references: { field_crops: [1, 1.7, 0.26, 1.15] },
    referenceIssues: {},
    treatedSeeds: [],
    ...extra,
  });

  it("herbicides et hors herbicides par ha de la famille ; biocontrôle et semences exclus ; × part de SAU", () => {
    const y = year({
      parcels: [parcel("p1", "field_crops"), parcel("p2", "field_crops"), parcel("v", "permanent_grassland", 200_000)],
      ift: [
        { interventionId: "i1", parcelId: "p1", segmentCode: "S3", ift: 2, signed: true },
        { interventionId: "i2", parcelId: "p1", segmentCode: "S5", ift: 1, signed: true },
        { interventionId: "i3", parcelId: "p2", segmentCode: "S2", ift: 5, signed: true },
        { interventionId: "i4", parcelId: "p2", segmentCode: "S1", ift: 5, signed: true },
      ],
    });
    // Herbicides : 2 × 10 ha / 20 ha = 1 → 5 pts ; hors herbicides : 0,5 dans ]0,4825 ; 0,705] → 3 pts ; × 50 % de SAU = 4.
    const [f] = iftFindings(ctx(y));
    expect(f).toMatchObject({ level: "ok", points: { got: 4, max: 5 } });
  });

  it("sans référence : données manquantes ; IFT non signé : à vérifier ; IFT en attente : manquant", () => {
    const y = year({ parcels: [parcel("p1", "field_crops")], ift: [{ interventionId: "i1", parcelId: "p1", segmentCode: "S3", ift: 1, signed: false }] });
    expect(iftFindings(ctx(y, { references: { field_crops: null }, referenceIssues: { field_crops: "commune du siège" } }))[0]!.level).toBe("missing");
    expect(iftFindings(ctx(y)).map((f) => f.ruleId)).toEqual(["hve.5.3", "hve.5.3.signature"]);
    const pending = year({ parcels: [parcel("p1", "field_crops")], treatments: [treat("p1", { interventionId: "i9" })], iftPending: ["i9"] });
    expect(iftFindings(ctx(pending))[0]!.level).toBe("missing");
  });
});

describe("HVE 5.8 et indicateur", () => {
  it("diversité : cépages, variétés par espèce, × part de SAU", () => {
    const y = year({
      parcels: [
        parcel("v1", "vine", 50_000, { variety: "Malbec" }),
        parcel("v2", "vine", 50_000, { variety: "Merlot" }),
        parcel("v3", "vine", 50_000, { variety: "Cabernet franc" }),
        parcel("f", "field_crops", 50_000),
      ],
    });
    expect(diversityFindings(y)[0]).toMatchObject({ points: { got: 1.5, max: 1.5 } });
  });

  it("CMR1 : tous les items à 0, indicateur non conforme ; rapport HVE avec la section phyto", () => {
    const y = year({ parcels: [parcel("p1", "field_crops")] });
    const base: HvePhytoContext = { years: [y], average: false, references: { field_crops: [1, 1.7, 0.26, 1.15] }, referenceIssues: {}, treatedSeeds: [] };
    const ok = hvePhytoFindings(base);
    expect(ok.find((f) => f.ruleId === "hve.5.2")!.points!.got).toBe(10);
    const report = evaluateCampaign({
      kind: "hve",
      campaign: 2026,
      period: { from: "2026-01-01", to: "2026-12-31" },
      parcels: [{ id: "p1", name: "p1", areaM2: 100_000 }],
      certifications: [{ parcelId: "p1", kind: "hve", level: "3", startedOn: "2025-01-01", stoppedOn: null }],
      settings: DEFAULT_CERTIFICATION_SETTINGS,
      hve: { phyto: base },
    });
    const phyto = report.sections.find((s) => s.id === "phyto")!;
    // 2 (CMR) + 10 (5.2) + 10 (IFT) = 22 ≥ 10 : conforme malgré les items déclaratifs manquants (« à vérifier »).
    expect(phyto).toMatchObject({ level: "warning", points: { got: 22, min: 10 } });
  });
});
