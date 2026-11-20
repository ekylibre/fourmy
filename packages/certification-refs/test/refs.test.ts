import { describe, it, expect } from "vitest";
import { ANNEX_II, breachOf, COPPER_EPHY, copperOfAmm, copperOfSubstance, cycleFromLexicon, INAO_BREACHES, RULE_BREACH } from "../src/index.js";
import { readFileSync } from "node:fs";

/** Noms des produits, en commentaire du fichier généré. */
const COPPER_EPHY_NAMES: Record<string, string> = Object.fromEntries(
  [...readFileSync(new URL("../src/ab/copper-ephy.ts", import.meta.url), "utf8").matchAll(/^  "(\d+)": .*\/\/ (.*)$/gm)].map((m) => [m[1]!, m[2]!.trim()]),
);

describe("référentiels AB", () => {
  it("cycle d'une production d'après Lexicon (durée de vie, usage)", () => {
    expect(cycleFromLexicon(null)).toBe("annual");
    expect(cycleFromLexicon(1)).toBe("annual");
    // Prairie, luzerne, trèfle : 5 à 10 ans dans Lexicon, mais fourrages pérennes (2 ans de conversion).
    expect(cycleFromLexicon(5, "meadow")).toBe("semi_perennial");
    expect(cycleFromLexicon(10, "fodder")).toBe("semi_perennial");
    expect(cycleFromLexicon(3, "fruit")).toBe("semi_perennial");
    expect(cycleFromLexicon(20, "fruit")).toBe("perennial");
  });

  it("chaque règle renvoie à un manquement du catalogue ; le cuivre est à confirmer", () => {
    for (const n of Object.values(RULE_BREACH)) expect(INAO_BREACHES[n], n).toBeDefined();
    expect(breachOf("R5")).toMatchObject({ number: "4", class: "major", first: ["DL", "DPA"] });
    expect(breachOf("R16")).toMatchObject({ number: "40", class: "minor" });
    expect(breachOf("R21")).toMatchObject({ number: "328", unconfirmed: true });
    expect(breachOf("R99")).toBeNull();
  });
});

describe("cuivre métal des produits E-Phy", () => {
  it("convertit le composé quand la formule est unique, refuse sinon", () => {
    expect(copperOfSubstance("cuivre de l'oxyde cuivreux (Copper compounds) 750.0 g/kg")).toEqual({ g: 750, per: "kg" });
    expect(copperOfSubstance("cuivre (Copper compounds) 20.0 %")).toEqual({ g: 200, per: "kg" });
    expect(copperOfSubstance("hydroxyde de cuivre (Copper compounds) 614.2 g/L")).toEqual({ g: 400.1, per: "L" });
    expect(copperOfSubstance("bouillie bordelaise (Copper compounds) 733.4 g/kg")).toEqual({ g: 200, per: "kg" });
    expect(copperOfSubstance("sulfate de cuivre (Copper compounds) 12.0 %")).toBeNull();
    expect(copperOfSubstance("sulfate de cuivre tribasique (Copper compounds) 345.0 g/L")).toBeNull();
    expect(copperOfSubstance("hydroxyde de cuivre (Copper compounds)")).toBeNull();
  });

  it("vérifié sur tous les produits dont le nom donne la teneur en cuivre (« … 20 … », « … 35 WP »)", () => {
    // Produits dont le nom porte la teneur en cuivre métal (en %), connue des étiquettes.
    const named: Record<string, number> = { "SODICUIVRE 50": 50, "STYROCUIVRE DF": 50, "CUPROZIN 35 WP": 35, "BORDO 20 MICRO": 20 };
    const byName = new Map<string, string>();
    for (const [amm, line] of Object.entries(COPPER_EPHY_NAMES)) byName.set(line, amm);
    let checked = 0;
    for (const [name, pct] of Object.entries(named)) {
      const amm = byName.get(name);
      expect(amm, name).toBeDefined();
      const c = copperOfAmm(amm)!;
      expect(c.per).toBe("kg");
      expect(Math.abs(c.g - pct * 10), name).toBeLessThan(5);
      checked++;
    }
    expect(checked).toBe(4);
    // Couverture : la conversion n'échoue que sur les sulfates (et les teneurs absentes).
    const unknown = Object.entries(COPPER_EPHY).filter(([amm]) => copperOfAmm(amm) === null).flatMap(([, s]) => s);
    for (const s of unknown) {
      if (copperOfSubstance(s) !== null) continue;
      expect(s, s).toMatch(/^(sulfate de cuivre|bouillie bordelaise|[^(]+\(Copper compounds\)\s*$|.*\(Copper compounds\) 0?\.?0)/);
    }
    expect(copperOfAmm("0000000")).toBeUndefined();
  });

  it("annexe II : codes uniques, effluents comptés dans les 170 N", () => {
    expect(new Set(ANNEX_II.map((c) => c.code)).size).toBe(ANNEX_II.length);
    expect(ANNEX_II.filter((c) => c.counts170N).map((c) => c.code)).toEqual(["manure", "dried_manure", "composted_manure", "liquid_manure"]);
    // Six dans la version d'origine, plus la struvite (règlement 2023/121 : lisier non issu d'un élevage industriel).
    expect(ANNEX_II.filter((c) => c.industrialForbidden)).toHaveLength(7);
    expect(ANNEX_II.find((c) => c.code === "household_compost")!.label).toMatch(/^Biodéchets/);
  });
});
