import { describe, expect, it } from "vitest";
import { computeBalance, isMissing, type BalanceInput } from "../src/index.js";

const colza: BalanceInput = {
  campaign: 2027,
  department: "86",
  crop: "rapeseed_winter",
  soilType: null,
  irrigated: false,
  yieldTarget: 35,
  rootingDepthCm: 90,
  rapeseed: { biomassEndWinterKgM2: 1.2, biomassStartWinterKgM2: null, legumeCompanion: true, organicHistory: { product: "Fumier de bovins", frequency: "every_two" } },
};
const value = (r: ReturnType<typeof computeBalance>, t: string) => {
  const x = r.terms[t as keyof typeof r.terms];
  return x && !isMissing(x) ? x.value : undefined;
};

describe("colza d'hiver : bilan additif (annexe 2.4 NA)", () => {
  it("X = (Pf + Rf) − (Pi + Ri + M + Fleg + Fass + Mha + Nirr + Xa)", () => {
    const r = computeBalance(colza);
    expect(r).toMatchObject({ method: "bilan_additive", annex: "2.4", missing: [] });
    expect([value(r, "Pf"), value(r, "Rf"), value(r, "Ri"), value(r, "M"), value(r, "Pi"), value(r, "Fass"), value(r, "Mha"), value(r, "Fleg")]).toEqual([245, 30, 30, 40, 78, 30, 15, 0]);
    // 245 + 30 − (78 + 30 + 40 + 0 + 30 + 15) = 82
    expect(r.dose).toBe(82);
  });
  it("gel hivernal : Pi = MV SH × 65 + 0,5 × (MV EH × 50 − MV SH × 65) / 1,35", () => {
    const r = computeBalance({ ...colza, rapeseed: { ...colza.rapeseed!, biomassStartWinterKgM2: 2 } });
    expect(value(r, "Pi")).toBe(86); // 78 + 0,5 × 22 / 1,35
    expect(r.dose).toBe(74);
  });
  it("sans pesée de sortie d'hiver ni profondeur : termes manquants ; plafonds de 330 (Pf) et 250 (X)", () => {
    const r = computeBalance({ ...colza, rootingDepthCm: null, rapeseed: { ...colza.rapeseed!, biomassEndWinterKgM2: null } });
    expect(r.dose).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining([expect.stringMatching(/^Pi : pesée/), expect.stringMatching(/^Rf : profondeur/)]));
    const big = computeBalance({ ...colza, yieldTarget: 60, rapeseed: { ...colza.rapeseed!, biomassEndWinterKgM2: 0, legumeCompanion: false, organicHistory: null } });
    expect(value(big, "Pf")).toBe(330);
    expect(big.dose).toBe(250); // 330 + 30 − 70 = 290, ramené à 250
    expect(big.warnings[0]).toMatch(/ramenée au plafond de 250/);
  });
});
