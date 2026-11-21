import { describe, it, expect } from "vitest";
import { MACHINERY_RATES, PROCEDURE_FAMILIES, familyRatePerMeter, hectareRate, machineryRate, machineryRatesFor, suggestMachineryRate } from "../src/index.js";
import { widthOf } from "../scripts/extract-bcma.js";

/** Barème BCMA 2024 (lot IT4) : extraction, familles, largeurs, débits. */
describe("barème BCMA", () => {
  it("1 082 matériels, identifiants uniques, libellés propres", () => {
    expect(MACHINERY_RATES).toHaveLength(1082);
    expect(new Set(MACHINERY_RATES.map((r) => r.id)).size).toBe(MACHINERY_RATES.length);
    for (const r of MACHINERY_RATES) expect(r.label).not.toMatch(/\s{2}|[-]/);
  });

  it("libellé qui finit par un nombre : colonnes non décalées (recette du 21/11)", () => {
    const combine = MACHINERY_RATES.find((r) => r.label.startsWith("Mois-bat coup 420"))!;
    expect(combine).toMatchObject({ label: "Mois-bat coup 420 non conventionnelle coupe à 7,5 m à 9 m occasion", purchasePrice: 188100, annualUse: 350, performancePerH: 3.15 });
    // Aucun prix d'achat absurde (une colonne décalée y mettait un morceau de libellé).
    expect(MACHINERY_RATES.filter((r) => r.purchasePrice < 200).map((r) => r.label)).toEqual([]);
    expect(MACHINERY_RATES.filter((r) => r.unit === "hectares" && r.performancePerH > 50).map((r) => r.label)).toEqual([]);
  });

  it("libellés coupés recollés, largeur lue", () => {
    const drill = MACHINERY_RATES.find((r) => r.label === "Semoir céréal cannelures ou ergots gravitaire 4 m")!;
    expect(drill).toMatchObject({ family: "Semis", unit: "hectares", widthM: 4, performancePerH: 1.8, purchasePrice: 15250 });
    expect(MACHINERY_RATES.some((r) => r.label === "Presse balles chambre variable 120 x 160")).toBe(true);
    expect(widthOf("Pulvérisateur 18 HL rampe 28 m porté")).toBe(28);
    expect(widthOf("Semoir céréal intégré pneumatique 3.5 m")).toBe(3.5);
    expect(widthOf("Tonne à lisier 10 m3")).toBeNull();
  });

  it("familles des procédures toutes présentes dans le barème", () => {
    const families = new Set(MACHINERY_RATES.map((r) => r.family));
    for (const list of Object.values(PROCEDURE_FAMILIES)) for (const f of list) expect(families, f).toContain(f);
    expect(machineryRatesFor("plowing").every((r) => r.family === "Travail du sol profond ou semi-profond")).toBe(true);
  });

  it("débit à l'hectare, débit par mètre d'une famille, proposition pour un matériel", () => {
    expect(hectareRate(machineryRate(MACHINERY_RATES.find((r) => r.unit === "heures")!.id)!)).toBeNull();
    const perM = familyRatePerMeter("Pulvérisateur")!;
    expect(perM).toBeGreaterThan(0.1);
    expect(perM).toBeLessThan(2);
    const s = suggestMachineryRate("mounted_sprayer", 24)!;
    expect(s.family).toBe("Pulvérisateur");
    expect(s.widthM).toBe(24);
    expect(suggestMachineryRate(null, 3)).toBeNull();
  });
});
