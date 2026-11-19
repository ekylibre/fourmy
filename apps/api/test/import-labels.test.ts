import { describe, it, expect } from "vitest";
import { labelWords } from "../src/repos/import-reconcile.js";

/** Libellés de cultures sans code AgroEDI (historique Geofolia) : mots comparables à ceux de Lexicon. */
describe("mots d'un libellé de culture", () => {
  it("sans accent, casse, pluriel, apostrophe ni mot vide ; l'espèce en premier", () => {
    expect(labelWords("Colza oléagineux d'hiver")).toEqual(["colza", "oleagineu", "hiver"]);
    expect(labelWords("Colza d’hiver")).toEqual(["colza", "hiver"]);
    expect(labelWords("Mélange de légumineuses")).toEqual(["melange", "legumineuse"]);
    expect(labelWords("Jachère autre semée")).toEqual(["jachere", "semee"]);
  });
});
