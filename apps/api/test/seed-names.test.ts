import { describe, it, expect } from "vitest";
import { nameParts } from "../src/repos/seed-catalog.js";

/** Noms des semences reprises d'Ekylibre (recette SE8) : espèce et variété. */
describe("nom d'une semence reprise", () => {
  it("« Semence(s) de <espèce> - <variété> », « Semence d'<espèce> »", () => {
    expect(nameParts("Semence de maïs -  DKC5065")).toEqual({ species: "maïs", variety: "DKC5065" });
    expect(nameParts("Semences de maïs - MAS 524A")).toEqual({ species: "maïs", variety: "MAS 524A" });
    expect(nameParts("Semence d'avoine")).toEqual({ species: "avoine", variety: null });
    expect(nameParts("Semence de Triticale")).toEqual({ species: "Triticale", variety: null });
    expect(nameParts("Semence de blé tendre - Rubisko")).toEqual({ species: "blé tendre", variety: "Rubisko" });
  });

  it("un autre nom ne se découpe pas", () => {
    expect(nameParts("Thermidor")).toBeNull();
    expect(nameParts("Couvert Avoine + Vesce")).toBeNull();
    expect(nameParts("Semencier")).toBeNull();
  });
});
