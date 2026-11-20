import { COMPOSITION_ORIGIN_LABELS, compositionOrigin, fertilizerComposition, type CompositionOrigin, type FertilizerArticle } from "@fourmy/contracts";
import { nitrogenNote } from "../src/features/fertilization/fertilization";

/**
 * Origine de la composition d'un engrais : celles des imports de fichiers
 * (« imported », migration 0062) faisaient planter la fiche d'une
 * intervention (« s is undefined ») faute de libellé.
 */
const fert = (origin: string): FertilizerArticle => ({
  id: "f1",
  name: "Sulfertil 26N 13S",
  kind: "fertilizer",
  unit: "kilogram",
  lexiconRef: null,
  composition: fertilizerComposition.parse({ basis: "mass_percent", nTotal: 26, nMineralShare: 1 }),
  origin: origin as CompositionOrigin,
  source: null,
  proposal: null,
  analyses: [],
  usage: 0,
  abCategories: null,
  effluentOrigin: null,
});

describe("origine de la composition d'un engrais", () => {
  it("chaque origine permise en base a un libellé", () => {
    // Liste de la contrainte article_fertilizers_origin_check (migration 0062).
    expect([...compositionOrigin.options].sort()).toEqual(["analysis", "confirmed", "imported", "migrated", "proposed"]);
    for (const o of compositionOrigin.options) expect(COMPOSITION_ORIGIN_LABELS[o]).toBeTruthy();
  });

  it("engrais importé d'un fichier : note d'azote avec son origine", () => {
    const note = nitrogenNote(fert("imported"), { quantity: 100, per: "hectare", unit: "kilogram" }, 1, "2026-06-04");
    expect(note).toMatchObject({ ok: true, totalKgHa: 26, origin: "importée d'un fichier" });
  });

  it("origine inconnue de l'interface : pas de plantage", () => {
    const note = nitrogenNote(fert("autre"), { quantity: 100, per: "hectare", unit: "kilogram" }, 1, "2026-06-04");
    expect(note).toMatchObject({ ok: true, origin: "origine inconnue" });
  });
});
