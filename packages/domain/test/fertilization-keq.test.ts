import { describe, expect, it } from "vitest";
import { keqOf, keqTotal } from "../src/fertilization/index.js";

const slurry = (date: string, n = 120) => ({ date, product: "Lisier de porc", proKey: "lisier_porcs_mixte_fosse_arvalis", nTotalKgHa: n });

describe("équivalent engrais minéral des produits organiques (annexe 5 NA)", () => {
  it("maïs : apport de printemps après l'ouverture, Keq bilan 0,56", () => {
    expect(keqOf(slurry("2026-04-10"), "maize_grain", "2026-04-01", "campaign")).toMatchObject({ xa: 120 * 0.56, ri: 0, period: "apport de printemps", missing: null });
  });
  it("blé : apport d'automne avant l'ouverture, Keq Ri 0,56 dans l'APL et Keq bilan 0,05 dans Xa ; déconseillé", () => {
    const r = keqOf(slurry("2025-10-20"), "soft_wheat", "2026-02-01", "campaign");
    expect(r).toMatchObject({ ri: 120 * 0.56, notRecommended: true, period: "apport d'automne" });
    expect(r.xa).toBeCloseTo(6);
  });
  it("colza avant l'ouverture : Keq bilan seul ; précédent : Keq cycle « nr » nommé manquant", () => {
    expect(keqOf(slurry("2025-09-01"), "rapeseed_winter", "2026-02-01", "campaign").xa).toBeCloseTo(6);
    expect(keqOf(slurry("2025-09-01"), "rapeseed_winter", null, "previous").missing).toMatch(/non référencé/);
  });
  it("produit sans ligne d'annexe : nommé ; total des Xa", () => {
    const none = keqOf({ ...slurry("2026-04-10"), proKey: null }, "maize_grain", "2026-04-01", "campaign");
    expect(none.missing).toMatch(/ligne de l'annexe 5/);
    const t = keqTotal([keqOf(slurry("2026-04-10", 100), "maize_grain", "2026-04-01", "campaign"), none]);
    expect(t).toMatchObject({ xa: 56, ri: 0, missing: [expect.stringContaining("Lisier de porc du 10/04")] });
    expect(t.detail).toBe("Lisier de porc du 10/04 : 100 kg N × Keq 0,56");
  });
  it("prairie : apport de fin d'été lu en automne", () => {
    expect(keqOf(slurry("2025-08-20"), "grassland", "2026-02-01", "campaign")).toMatchObject({ xa: 120 * 0.15, missing: null });
  });
});
