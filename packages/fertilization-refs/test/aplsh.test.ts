import { describe, expect, it } from "vitest";
import { aplshAnalytic, aplshPercent, aplshProducts, defaultAplshZone } from "../src/index.js";

describe("APLSH (COMIFER, novembre 2024)", () => {
  it("tables complètes : 18 produits dans les 5 zones, 8 classes par zone", () => {
    expect(aplshProducts.rows).toHaveLength(18);
    for (const p of aplshProducts.rows) expect(Object.keys(p.percent)).toHaveLength(5);
    expect(aplshAnalytic.rows).toHaveLength(40);
    for (const r of [...aplshProducts.rows.flatMap((p) => Object.values(p.percent)), ...aplshAnalytic.rows.map((r) => r.percent)]) {
      expect(r).toHaveLength(10);
      for (const v of r!) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("valeurs du fichier : lisier mixte de porc et fumier de bovins dans le bassin du Sud-Ouest", () => {
    expect(aplshPercent({ zone: "bassin_sud_ouest", date: "2025-07-01", productKey: "lisier_mixte_de_porc" })?.percent).toBe(80);
    expect(aplshPercent({ zone: "bassin_sud_ouest", date: "2025-12-20", productKey: "lisier_mixte_de_porc" })?.percent).toBe(75);
    // Un apport du 28/07 prend la référence du 15/07.
    expect(aplshPercent({ zone: "bassin_sud_ouest", date: "2025-07-28", productKey: "fumier_de_bovins_stockage_moins_2_mois" })?.percent).toBe(50);
  });

  it("par le C/N et la part minérale ; case absente : null", () => {
    expect(aplshPercent({ zone: "bassin_sud_ouest", date: "2025-09-20", cN: 15, mineralPct: 30 })).toMatchObject({ percent: 40 });
    expect(aplshPercent({ zone: "bassin_sud_ouest", date: "2025-09-20", cN: 7, mineralPct: 30 })).toBeNull();
  });

  it("zone par défaut : 64 bassin du Sud-Ouest, 86 océanique altéré", () => {
    expect(defaultAplshZone("64")).toBe("bassin_sud_ouest");
    expect(defaultAplshZone("86")).toBe("oceanique_altere");
    expect(defaultAplshZone("75")).toBeNull();
  });
});
