import { describe, it, expect } from "vitest";
import { companyIdentity, mergeWithoutOverwrite, type CompanyRow } from "../src/identity.js";

const row = (p: Partial<CompanyRow> = {}): CompanyRow => ({
  id: 1,
  full_name: "GAEC DU PRÉ",
  siret_number: "732 829 320 00074",
  vat_number: "fr83404833048",
  activity_code: "0121Z",
  legal_position_code: "GAEC",
  lines: ["GAEC DU PRÉ", null, "Bâtiment B", "12 route des Vignes", "Lieu-dit Le Bourg", "33500 LIBOURNE"],
  mail_country: "fr",
  ...p,
});

describe("identité de la société Ekylibre", () => {
  it("normalise SIRET, TVA, NAF et forme juridique, et range l'adresse", () => {
    const r = companyIdentity(row());
    expect(r.identity).toEqual({ legal_name: "GAEC DU PRÉ", legal_form: "gaec", siret: "73282932000074", vat_number: "FR83404833048", naf_code: "01.21Z" });
    expect(r.address).toEqual({ address_line1: "12 route des Vignes", address_line2: "Bâtiment B, Lieu-dit Le Bourg", postal_code: "33500", city: "LIBOURNE" });
    expect(r.invalid).toEqual([]);
  });

  it("écarte les valeurs invalides et le signale", () => {
    const r = companyIdentity(row({ siret_number: "73282932000075", vat_number: "BE0123456789", activity_code: "agriculture", legal_position_code: "SASU" }));
    expect(r.identity).toMatchObject({ siret: null, vat_number: null, naf_code: null, legal_form: "other" });
    expect(r.invalid).toHaveLength(3);
  });

  it("sans voie, prend le lieu-dit ; sans adresse, rien", () => {
    expect(companyIdentity(row({ lines: ["X", null, null, null, "Le Bourg", "33500 LIBOURNE"] })).address?.address_line1).toBe("Le Bourg");
    expect(companyIdentity(row({ lines: null, legal_position_code: null })).address).toBeNull();
    expect(companyIdentity(row({ legal_position_code: "" })).identity.legal_form).toBeNull();
  });
});

describe("fusion sans écraser", () => {
  it("remplit les champs vides et signale les écarts", () => {
    const r = mergeWithoutOverwrite(
      { siret: "73282932000074", legal_name: null, naf_code: "01.11Z", vat_number: "" },
      { siret: "73282932000074", legal_name: "GAEC DU PRÉ", naf_code: "01.21Z", vat_number: "FR83404833048" },
    );
    expect(r.updates).toEqual({ legal_name: "GAEC DU PRÉ", vat_number: "FR83404833048" });
    expect(r.conflicts).toEqual(["code NAF : « 01.11Z » gardé, Ekylibre indique « 01.21Z »"]);
  });
});
