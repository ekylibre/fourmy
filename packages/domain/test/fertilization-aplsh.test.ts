import { describe, expect, it } from "vitest";
import type { FertilizerComposition } from "@fourmy/contracts";
import { aplshOfApplication, aplshTotal } from "../src/fertilization/index.js";

const organic = (extra: Partial<FertilizerComposition> = {}): FertilizerComposition => ({
  basis: "kg_per_m3",
  nTotal: 4,
  nMineralShare: 0.6,
  p2o5: null,
  k2o: null,
  so3: null,
  density: null,
  nitrateType: "II",
  foliar: false,
  ...extra,
});

describe("APLSH d'un apport (COMIFER 2024)", () => {
  it("lisier mixte de porc, 120 kg N au 01/09 dans le bassin du Sud-Ouest : 75 %", () => {
    expect(aplshOfApplication(organic({ aplshProduct: "lisier_mixte_de_porc" }), "2025-09-03", 120, "bassin_sud_ouest")).toMatchObject({ kgNHa: 90, percent: 75 });
  });
  it("par le C/N : C/N 9 et 60 % minéral → 60 % en septembre", () => {
    expect(aplshOfApplication(organic({ cN: 9 }), "2025-09-03", 100, "bassin_sud_ouest")).toMatchObject({ kgNHa: 60, percent: 60 });
  });
  it("engrais minéral : tout l'azote ; sans référence : manquant", () => {
    expect(aplshOfApplication(organic({ nitrateType: "III", nMineralShare: 1 }), "2025-09-03", 40, null)).toMatchObject({ kgNHa: 40 });
    expect(aplshOfApplication(organic(), "2025-09-03", 40, "bassin_sud_ouest")).toEqual({ missing: "dénomination COMIFER ou C/N du produit (Stocks → Fertilisants)" });
  });
});

describe("plafond de 70 kg d'APLSH", () => {
  const cover = { kind: "cover" as const, from: "2025-07-15", countsMineral: false };
  it("cumul depuis la récolte du précédent, types 0 à II ; type III compté sur un couvert exporté", () => {
    const apps = [
      { date: "2025-07-10", product: "Avant récolte", type: "II", aplsh: { kgNHa: 50, percent: 50, source: "" } },
      { date: "2025-08-20", product: "Lisier", type: "II", aplsh: { kgNHa: 45, percent: 75, source: "" } },
      { date: "2025-09-10", product: "Fumier", type: "Ib", aplsh: { kgNHa: 30, percent: 45, source: "" } },
      { date: "2025-09-12", product: "Ammonitrate", type: "III", aplsh: { kgNHa: 30, percent: 100, source: "" } },
    ];
    expect(aplshTotal(cover, apps)).toEqual({ kgNHa: 75, ceiling: 70, over: true, missing: [], counted: 2 });
    expect(aplshTotal({ ...cover, countsMineral: true }, apps)).toMatchObject({ kgNHa: 105, counted: 3 });
    expect(aplshTotal(cover, [{ date: "2025-08-01", product: "Digestat", type: "II", aplsh: { missing: "x" } }])).toMatchObject({ kgNHa: 0, over: false, missing: ["Digestat : x"] });
  });
});
