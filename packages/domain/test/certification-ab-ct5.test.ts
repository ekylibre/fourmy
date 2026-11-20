import { describe, it, expect } from "vitest";
import { growingModeFindings, justificationFindings, mixityFindings, seedFindings, type AbApplication, type AbProduction } from "../src/index.js";

const names = new Map([["p1", "Le Champ"]]);
const seed = (extra: Partial<AbApplication>): AbApplication => ({
  interventionId: "s1",
  day: "2026-04-10",
  parcelId: "p1",
  articleId: "a1",
  product: "Blé Renan",
  kind: "seed",
  organicStatus: "conventional",
  seedTreated: false,
  plant: false,
  derogation: null,
  ...extra,
});

describe("AB semences et plants (R24, R25)", () => {
  it("bio : rien ; statut inconnu : à renseigner", () => {
    expect(seedFindings([seed({ organicStatus: "organic" })], names)).toEqual([]);
    expect(seedFindings([seed({ organicStatus: null })], names)[0]!.level).toBe("missing");
  });

  it("non bio : sans dérogation rouge (n° 349) ; dérogation après le semis orange (n° 38) ; avant : conforme", () => {
    expect(seedFindings([seed({})], names)[0]).toMatchObject({ level: "danger", breach: { inao: "349" } });
    expect(seedFindings([seed({ derogation: { grantedOn: "2026-04-15", reference: "D-1" } })], names)[0]).toMatchObject({ level: "warning", breach: { inao: "38" } });
    expect(seedFindings([seed({ derogation: { grantedOn: "2026-03-01", reference: "D-1" } })], names)[0]).toMatchObject({ level: "ok" });
  });

  it("semence traitée ou plant non bio : rouge (n° 37), même avec une dérogation", () => {
    expect(seedFindings([seed({ seedTreated: true, derogation: { grantedOn: "2026-03-01", reference: null } })], names)[0]).toMatchObject({ level: "danger", breach: { inao: "37" } });
    expect(seedFindings([seed({ plant: true, derogation: { grantedOn: "2026-03-01", reference: null } })], names)[0]).toMatchObject({ level: "danger", breach: { inao: "37" } });
  });
});

describe("AB justification, mode de culture, mixité", () => {
  it("R20 : traitement autorisé sans justification : orange, une fois par intervention", () => {
    const phyto = (extra: Partial<AbApplication>): AbApplication => ({ interventionId: "t1", day: "2026-05-01", parcelId: "p1", articleId: "c", product: "Cuivre", kind: "phyto", organicAllowed: true, justified: false, ...extra });
    expect(justificationFindings([phyto({}), phyto({ articleId: "d", product: "Soufre" })], names)).toHaveLength(1);
    expect(justificationFindings([phyto({ justified: true })], names)).toEqual([]);
  });

  const prod = (extra: Partial<AbProduction>): AbProduction => ({ id: "x", parcelId: "p1", label: "Tomate", species: "solanum_lycopersicum", variety: "Cœur de bœuf", cycle: "annual", sownOn: null, harvestOn: null, ...extra });

  it("R10, R13 : hors sol rouge ; pot à vérifier ; serre chauffée à justifier", () => {
    expect(growingModeFindings([prod({ cultivationMode: "soilless" })], names)[0]).toMatchObject({ level: "danger", breach: { inao: "36", class: "critical" } });
    expect(growingModeFindings([prod({ cultivationMode: "pot" })], names)[0]!.level).toBe("warning");
    expect(growingModeFindings([prod({ cultivationMode: "heated_shelter" })], names)[0]!.ruleId).toBe("ab.R13");
    expect(growingModeFindings([prod({ cultivationMode: "open_field" })], names)).toEqual([]);
  });

  it("R7 mixité : même variété rouge ; variétés différentes conformes ; variété inconnue à renseigner", () => {
    expect(mixityFindings([prod({})], [{ species: "solanum_lycopersicum", label: "Tomate", variety: "cœur de bœuf" }])[0]).toMatchObject({ level: "danger", breach: { inao: "31" } });
    expect(mixityFindings([prod({})], [{ species: "solanum_lycopersicum", label: "Tomate", variety: "Marmande" }])[0]!.level).toBe("ok");
    expect(mixityFindings([prod({ variety: null })], [{ species: "solanum_lycopersicum", label: "Tomate", variety: "Marmande" }])[0]!.level).toBe("missing");
    expect(mixityFindings([prod({})], [{ species: "zea_mays", label: "Maïs", variety: null }])).toEqual([]);
  });
});
