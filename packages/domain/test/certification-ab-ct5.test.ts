import { describe, it, expect } from "vitest";
import { growingModeFindings, justificationFindings, mixityFindings, sameSpeciesForMixity, seedFindings, mixityLineage, type AbApplication, type AbProduction } from "../src/index.js";

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

  it("R7, issue #166 : cultures génériques ignorées, note sans effet sur le verdict", () => {
    const ppam = prod({ label: "Plantes médicinales pérennes", species: "plant", lineage: null, variety: null });
    const prairie = { species: "plant", lineage: null, label: "Prairie permanente", variety: null };
    const fs = mixityFindings([ppam], [prairie]);
    expect(fs).toEqual([expect.objectContaining({ ruleId: "ab.R7", level: "na", message: "Plantes médicinales pérennes : espèce à préciser sur l'activité pour contrôler la mixité (R7)." })]);
    // Production hors AB générique : jamais comparée.
    expect(mixityFindings([prod({ lineage: ["solanum_lycopersicum", "solanum"] })], [{ species: null, lineage: null, label: "Jachère", variety: null }])).toEqual([]);
  });

  it("R7, issue #166 : un genre englobe ses espèces ; deux espèces du même genre ne se comparent pas", () => {
    const avoine = prod({ label: "Avoine", species: "avena", lineage: ["avena"], variety: "Une de Mai" });
    const noire = (variety: string | null) => ({ species: "avena_sativa", lineage: ["avena_sativa", "avena"], label: "Avoine noire d'hiver", variety });
    const same = mixityFindings([avoine], [noire("Une de Mai")])[0]!;
    expect(same).toMatchObject({ level: "danger", breach: { inao: "31" } });
    expect(same.message).toBe("Avoine (AB) et Avoine noire d'hiver (hors AB) : même variété (une de mai) en AB et hors AB la même campagne : mixité non autorisée.");
    expect(mixityFindings([avoine], [noire("Pratex")])[0]!.level).toBe("ok");
    expect(mixityFindings([avoine], [noire(null)])[0]!.level).toBe("missing");
    expect(mixityFindings([prod({ species: "avena_strigosa", lineage: ["avena_strigosa", "avena"] })], [noire("Cœur de bœuf")])).toEqual([]);
  });

  it("lignée de mixité : espèce seule sans lignée calculée ; recoupement par l'ancêtre", () => {
    expect(mixityLineage("zea_mays", undefined)).toEqual(["zea_mays"]);
    expect(mixityLineage("plant", null)).toBeNull();
    expect(mixityLineage(null, undefined)).toBeNull();
    expect(sameSpeciesForMixity(["brassica_napus_napus", "brassica_napus", "brassica"], ["brassica_napus", "brassica"])).toBe(true);
    expect(sameSpeciesForMixity(["avena_sativa", "avena"], ["avena_strigosa", "avena"])).toBe(false);
    expect(sameSpeciesForMixity(null, ["avena"])).toBe(false);
  });
});
