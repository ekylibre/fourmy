import { describe, it, expect } from "vitest";
import { nitrogenExportsOf } from "@fourmy/certification-refs";
import {
  decisionToolFindings,
  exportedNitrogen,
  hveFertilizationFindings,
  legumeFindings,
  nitrogenBalanceFindings,
  organicNitrogenFindings,
  unfertilizedFindings,
  type HveFertParcel,
  type HveFertilizationContext,
} from "../src/index.js";

const wheat = nitrogenExportsOf("triticum_aestivum");
const parcel = (id: string, extra: Partial<HveFertParcel> = {}): HveFertParcel => ({
  id,
  name: id,
  areaM2: 100_000,
  family: "field_crops",
  species: "triticum_aestivum",
  variety: null,
  exports: wheat,
  legume: false,
  ...extra,
});
const ctx = (extra: Partial<HveFertilizationContext> = {}): HveFertilizationContext => ({
  parcels: [parcel("p1")],
  inputs: [],
  harvests: [],
  livestock: false,
  planParcelIds: [],
  rshParcelIds: [],
  steeringParcelIds: [],
  ...extra,
});
const input = (parcelId: string, nTotalKgHa: number | null, organic = false) => ({ interventionId: `i-${parcelId}`, parcelId, articleId: "a", product: "Engrais", nTotalKgHa, organic });

describe("HVE 6.1 bilan azoté", () => {
  it("exportations : grain × teneur ; paille exportée à sa teneur propre", () => {
    expect(exportedNitrogen(wheat, { interventionId: "h", parcelId: "p1", product: "Blé", tonnes: 80, straw: false })).toBe(1440);
    expect(exportedNitrogen(wheat, { interventionId: "h", parcelId: "p1", product: "Paille", tonnes: 50, straw: true })).toBe(285);
  });

  it("BGA en azote total par ha de SAU : 180 kg apportés, 80 t de blé (1 440 kg) sur 10 ha → 36 kg/ha → 5 points", () => {
    const [f] = nitrogenBalanceFindings(ctx({ inputs: [input("p1", 180)], harvests: [{ interventionId: "h", parcelId: "p1", product: "Blé", tonnes: 80, straw: false }] }));
    expect(f).toMatchObject({ level: "ok", value: 36, points: { got: 5, max: 8 } });
  });

  it("cultures mineures ≥ 5 % : note × (1 − part) ; élevage non déclaré : données manquantes ; parcelle sans récolte signalée", () => {
    const minor = parcel("lavande", { species: "lavandula", exports: [] });
    const fs = nitrogenBalanceFindings(ctx({ parcels: [parcel("p1"), minor], livestock: null }));
    // Rien d'apporté ni d'exporté : 0 kg/ha → 8 points × (1 − 50 %) = 4.
    expect(fs[0]).toMatchObject({ level: "missing", points: { got: 4, max: 8 } });
    expect(fs[1]).toMatchObject({ ruleId: "hve.6.1.harvests", level: "warning" });
  });
});

describe("HVE 6.3 à 6.6", () => {
  it("6.3 part organique : 60 kg organiques sur 100 → 4 points", () => {
    expect(organicNitrogenFindings(ctx({ inputs: [input("p1", 60, true), input("p1", 40)] }))[0]).toMatchObject({ value: 60, points: { got: 4 } });
  });

  it("6.4 OAD grandes cultures : plan, reliquat, pilotage", () => {
    const f = decisionToolFindings(ctx({ planParcelIds: ["p1"], rshParcelIds: ["p1"], steeringParcelIds: [] }))[0]!;
    expect(f.points).toEqual({ got: 2, max: 3 });
  });

  it("6.5 SAU non fertilisée et 6.6 légumineuses", () => {
    const c = ctx({ parcels: [parcel("p1"), parcel("pois", { species: "pisum_sativum", legume: true })], inputs: [input("p1", 120)] });
    expect(unfertilizedFindings(c)[0]).toMatchObject({ value: 50, points: { got: 5 } });
    expect(legumeFindings(c)[0]).toMatchObject({ value: 50, points: { got: 4 } });
  });

  it("indicateur : 6.7 à déclarer", () => {
    expect(hveFertilizationFindings(ctx()).map((f) => f.ruleId)).toEqual(["hve.6.1", "hve.6.1.harvests", "hve.6.3", "hve.6.4", "hve.6.5", "hve.6.6", "hve.6.7"]);
  });
});
