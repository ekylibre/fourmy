import { describe, it, expect } from "vitest";
import type { Price, PriceSuggestion } from "@fourmy/contracts";
import { defaultPrice, defaultYield } from "../src/index.js";

/** Rendement et prix par défaut (temps 3, lot E3). */
const agreste = [
  { campaign: 2025, value: 69, unit: "quintal_per_hectare" },
  { campaign: 2024, value: 95, unit: "quintal_per_hectare" },
  { campaign: 2023, value: 101, unit: "quintal_per_hectare" },
  { campaign: 2022, value: 80, unit: "quintal_per_hectare" },
];

describe("rendement par défaut", () => {
  it("médiane de la ferme sur les trois campagnes précédentes", () => {
    const farm = [
      { campaign: 2026, value: 120 },
      { campaign: 2025, value: 104 },
      { campaign: 2024, value: 118 },
      { campaign: 2022, value: 60 },
    ];
    expect(defaultYield(farm, agreste, 2027, "64")).toEqual({ value: 118, unit: "quintal_per_hectare", source: "farm", label: "médiane 2024-2026 de la ferme (3 campagnes)" });
    // Une seule campagne dans la fenêtre.
    expect(defaultYield(farm, agreste, 2024, "64")!.label).toBe("médiane 2022 de la ferme (1 campagne)");
  });

  it("sans historique : médiane Agreste des trois dernières campagnes du département ; rien sinon", () => {
    expect(defaultYield([], agreste, 2027, "64")).toEqual({ value: 95, unit: "quintal_per_hectare", source: "agreste", label: "médiane Agreste 64 2023-2025" });
    expect(defaultYield([], [], 2027)).toBeNull();
  });
});

describe("prix par défaut", () => {
  const sg = (scope: PriceSuggestion["scope"], source: PriceSuggestion["source"], amount: number, date: string, label = "Maïs"): PriceSuggestion => ({ source, scope, label, amount, unit: "ton", date, ref: `${scope}${amount}` });
  const list = [sg("national", "lexicon", 175, "2025-06-01"), sg("matif", "lexicon", 250.5, "2025-12-01"), sg("market", "lexicon", 201.5, "2026-04-13", "Feed maize Bordeaux"), sg("market", "agrifood", 205, "2026-04-20", "Feed maize Bordeaux")];

  it("prix de la ferme d'abord", () => {
    const farm = { amount: 190, unit: "ton", validFrom: "2026-09-01" } as Price;
    expect(defaultPrice(farm, list)).toEqual({ value: 190, unit: "ton", source: "farm", label: "prix de la ferme", date: "2026-09-01" });
  });

  it("sinon place de marché (agrifood avant Lexicon), puis MATIF, puis prix producteur", () => {
    expect(defaultPrice(null, list)).toMatchObject({ value: 205, source: "agrifood", date: "2026-04-20" });
    expect(defaultPrice(null, list)!.label).toMatch(/^Feed maize Bordeaux, avr\. 2026$/);
    expect(defaultPrice(null, list.slice(0, 2))).toMatchObject({ value: 250.5, source: "lexicon", label: "MATIF, déc. 2025" });
    expect(defaultPrice(null, [])).toBeNull();
  });
});
