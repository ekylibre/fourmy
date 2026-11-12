import { describe, it, expect } from "vitest";
import { contractTypeOf, parsePostal, privateOf } from "../src/people.js";
import type { PersonRow } from "../src/extract.js";

/** Personnes Ekylibre → Fourmy (lot P4) : adresse, contrat, choix par canal. */
const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  entity_id: 1,
  worker_ids: [10],
  user_id: null,
  first_name: "Léa",
  last_name: "Bernard",
  full_name: "Léa Bernard",
  born_at: new Date("1990-04-02T00:00:00Z"),
  picture_file_name: null,
  user_email: null,
  administrator: null,
  ...o,
});

describe("personnes Ekylibre", () => {
  it("adresse postale : ligne 1 = nom, dernière ligne = « Commune, CP » ou « CP Commune »", () => {
    expect(parsePostal(["Léa Bernard", null, null, "3 chemin des Vignes", null, "Pau, 64000"], "fr")).toEqual({
      line1: "3 chemin des Vignes",
      line2: null,
      postalCode: "64000",
      city: "Pau",
      country: "FR",
    });
    expect(parsePostal(["X", "Bât. B", null, "1 rue Haute", null, "64300 Orthez"], "fr")).toMatchObject({ line1: "Bât. B", line2: "1 rue Haute", postalCode: "64300", city: "Orthez" });
    expect(parsePostal(["X", null, null, null, null, "Bruxelles, 1000"], "be")).toMatchObject({ line1: null, postalCode: "1000", city: "Bruxelles", country: "BE" });
    expect(parsePostal(["X", null, null, null, null, "Londres"], "gb")).toMatchObject({ postalCode: null, city: "Londres" });
    expect(parsePostal(["Seulement le nom", null, null, null, null, null], "fr")).toBeNull();
  });

  it("nature du contrat → type Fourmy", () => {
    expect(contractTypeOf("permanent_worker")).toBe("permanent");
    expect(contractTypeOf("temporary_worker")).toBe("fixed_term");
    expect(contractTypeOf("seasonal_worker")).toBe("seasonal");
    expect(contractTypeOf("autre")).toBeNull();
  });

  it("par canal : l'adresse par défaut, sinon la plus récente (ordre de l'extraction) ; email du compte à défaut", () => {
    const addr = (canal: "email" | "mobile" | "mail", coordinate: string | null) => ({
      entity_id: 1,
      canal,
      coordinate,
      by_default: null,
      lines: [null, null, null, null, null, null],
      mail_country: null,
      updated_at: null,
    });
    const p = privateOf(person({ user_email: "compte@exemple.fr" }), [addr("mobile", "06 12 34 56 78"), addr("mobile", "07 00 00 00 00"), addr("email", "pas un email")], []);
    expect(p).toMatchObject({ email: "compte@exemple.fr", mobile: "06 12 34 56 78", address: null, birthDate: "1990-04-02", contract: null });
    // Un portable illisible (lettres) n'est pas repris.
    expect(privateOf(person(), [addr("mobile", "voir bureau")], []).mobile).toBeNull();
    // Contrat : le plus récent ; une fin avant le début est ignorée.
    const c = privateOf(person(), [], [{ entity_id: 1, nature: "seasonal", started_at: new Date("2026-04-01"), stopped_at: new Date("2026-03-01") }]);
    expect(c.contract).toEqual({ type: "seasonal", startedOn: "2026-04-01", endedOn: null });
  });
});
