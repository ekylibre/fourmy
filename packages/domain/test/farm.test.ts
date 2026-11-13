import { describe, it, expect } from "vitest";
import { farmCertificationWrite, farmProfileIdentity, farmSiteWrite, siretKeyValid, vatFromSiren, type FarmCertification } from "@fourmy/contracts";
import { certificationAlerts, geocodeQuality } from "../src/index.js";

describe("SIRET", () => {
  it("vérifie la clé de Luhn", () => {
    expect(siretKeyValid("73282932000074")).toBe(true);
    expect(siretKeyValid("73282932000075")).toBe(false);
    expect(siretKeyValid("7328293200007")).toBe(false);
  });
  it("applique la règle propre à La Poste", () => {
    // Somme des chiffres multiple de 5, même si la clé de Luhn est fausse.
    expect(siretKeyValid("35600000000010")).toBe(true);
    expect(siretKeyValid("35600000000048")).toBe(false);
  });
});

describe("TVA proposée depuis le SIREN", () => {
  it("calcule la clé", () => {
    expect(vatFromSiren("404833048")).toBe("FR83404833048");
    expect(vatFromSiren("12345678")).toBeNull();
  });
});

describe("contrat de l'identité", () => {
  const base = { name: "GAEC du Pré", legalName: "", legalForm: null, siret: "732 829 320 00074", vatNumber: "fr83404833048", nafCode: "", pacage: null, cvi: null, ede: null, phone: " ", email: "", legalRep: null };
  it("normalise les saisies : espaces, majuscules, vides", () => {
    const r = farmProfileIdentity.parse(base);
    expect(r).toMatchObject({ siret: "73282932000074", vatNumber: "FR83404833048", legalName: null, nafCode: null, phone: null, email: null });
  });
  it("refuse un SIRET à la clé fausse avec un message clair", () => {
    const r = farmProfileIdentity.safeParse({ ...base, siret: "73282932000075" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/clé de contrôle/);
  });
});

describe("contrats des sites et certificats", () => {
  const site = { name: "Siège", address: { line1: null, line2: null, postalCode: null, city: null, inseeCode: null }, location: null, locationSource: null, geocode: null, radiusM: 10000 };
  it("exige une origine pour un point, et un point géocodé pour un score", () => {
    expect(farmSiteWrite.safeParse(site).success).toBe(true);
    expect(farmSiteWrite.safeParse({ ...site, location: { lat: 45, lon: 1 } }).success).toBe(false);
    expect(farmSiteWrite.safeParse({ ...site, location: { lat: 45, lon: 1 }, locationSource: "manual", geocode: { score: 0.9, type: "street" } }).success).toBe(false);
  });
  it("borne le rayon de 1 à 30 km", () => {
    expect(farmSiteWrite.safeParse({ ...site, radiusM: 500 }).success).toBe(false);
    expect(farmSiteWrite.safeParse({ ...site, radiusM: 31000 }).success).toBe(false);
  });
  it("réserve le niveau à la HVE", () => {
    const c = { kind: "organic", body: "Ecocert", number: "FR-BIO-01", level: "2", expiresOn: null };
    expect(farmCertificationWrite.safeParse(c).success).toBe(false);
    expect(farmCertificationWrite.safeParse({ ...c, kind: "hve" }).success).toBe(true);
  });
});

describe("qualité du géocodage", () => {
  it("signale une commune seule ou un score faible", () => {
    expect(geocodeQuality(0.92, "housenumber")).toBe("precise");
    expect(geocodeQuality(0.5, "street")).toBe("approximate");
    expect(geocodeQuality(0.95, "municipality")).toBe("approximate");
  });
});

describe("échéances des certificats", () => {
  const cert = (id: string, expiresOn: string | null): FarmCertification => ({ id, kind: "organic", body: null, number: null, level: null, expiresOn });
  it("garde les échéances à moins de 60 jours et les expirés, le plus proche d'abord", () => {
    const r = certificationAlerts([cert("a", "2027-03-01"), cert("b", "2026-12-20"), cert("c", null), cert("d", "2026-11-01")], "2026-11-13");
    expect(r.map((c) => [c.id, c.daysLeft])).toEqual([["d", -12], ["b", 37]]);
  });
});
