import { describe, it, expect } from "vitest";
import { breachOf, cycleFromLexicon, INAO_BREACHES, RULE_BREACH } from "../src/index.js";

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
