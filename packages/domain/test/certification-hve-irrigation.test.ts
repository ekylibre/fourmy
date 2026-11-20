import { describe, it, expect } from "vitest";
import { evaluateCampaign, hveIrrigationFindings, irrigationRecordFindings, lowWaterFindings, type HveIrrigation, type HveIrrigationContext } from "../src/index.js";
import { DEFAULT_CERTIFICATION_SETTINGS } from "@fourmy/contracts";

const irr = (day: string, extra: Partial<HveIrrigation> = {}): HveIrrigation => ({
  interventionId: `i-${day}`,
  day,
  parcelIds: ["p1"],
  depthMm: 30,
  areaM2: 100_000,
  method: "reel",
  origin: "groundwater",
  trigger: "probe",
  mobile: true,
  equipment: true,
  ...extra,
});
const parcel = { id: "p1", name: "Maïs irrigué", productionId: "pr1", crop: "Maïs", droughtTolerant: false, sownOn: "2026-04-20", waterSaving: "non-labour", harvested: true };
const ctx = (extra: Partial<HveIrrigationContext> = {}): HveIrrigationContext => ({ irrigations: [irr("2026-07-10")], parcels: [parcel], irrigationEquipment: [], ...extra });

describe("HVE irrigation", () => {
  it("exploitation non irrigante : sans objet, sauf matériel d'irrigation au parc", () => {
    expect(hveIrrigationFindings(ctx({ irrigations: [] }))[0]!.level).toBe("na");
    expect(hveIrrigationFindings(ctx({ irrigations: [], irrigationEquipment: ["Enrouleur"] }))[0]!.level).toBe("warning");
    const r = evaluateCampaign({
      kind: "hve",
      campaign: 2026,
      period: { from: "2026-01-01", to: "2026-12-31" },
      parcels: [],
      certifications: [],
      settings: DEFAULT_CERTIFICATION_SETTINGS,
      hve: { phyto: { years: [], average: false, references: {}, referenceIssues: {}, treatedSeeds: [] }, irrigation: ctx({ irrigations: [] }) },
    });
    expect(r.sections.find((s) => s.id === "irrigation")!.level).toBe("na");
  });

  it("7.1 : 7 données par apport, 5 par parcelle ; R = manquantes / total", () => {
    expect(irrigationRecordFindings(ctx())[0]).toMatchObject({ value: 0, points: { got: 6 } });
    // 2 manquantes sur 12 (16,7 %) → 4 points.
    const partial = ctx({ irrigations: [irr("2026-07-10", { origin: null, trigger: null })] });
    expect(irrigationRecordFindings(partial)[0]).toMatchObject({ value: 16.7, points: { got: 4 } });
  });

  it("7.6 : prélèvements dans le milieu en juin-août ; retenue hors étiage ; origine inconnue : manquante", () => {
    // 30 mm × 10 ha = 3 000 m³ en juillet sur 6 000 m³ : 50 % → 3 points.
    expect(lowWaterFindings(ctx({ irrigations: [irr("2026-07-10"), irr("2026-05-10")] }))[0]).toMatchObject({ value: 50, points: { got: 3 } });
    expect(lowWaterFindings(ctx({ irrigations: [irr("2026-07-10", { origin: "reservoir" })] }))[0]).toMatchObject({ value: 0, points: { got: 5 } });
    expect(lowWaterFindings(ctx({ irrigations: [irr("2026-07-10", { origin: null })] }))[0]!.level).toBe("missing");
  });
});
