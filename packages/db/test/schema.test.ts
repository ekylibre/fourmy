import { describe, it, expect } from "vitest";
import { schema } from "../src/index.js";

describe("schéma db", () => {
  it("expose les 20 tables du modèle §4.3", () => {
    const expected = [
      "farms","users","memberships","campaigns","landParcels","landParcelVersions",
      "productions","places","placeVersions","containers","containerVersions",
      "equipments","trackerBindings","positions","articles","lots","lotLineage",
      "interventions","interventionParameters","stockMovements",
    ];
    for (const name of expected) {
      expect(schema, `table ${name} absente`).toHaveProperty(name);
    }
  });
});
