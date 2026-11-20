import { describe, it, expect } from "vitest";
import { hveAnswers } from "@fourmy/contracts";
import { nitrogenExportsOf } from "@fourmy/certification-refs";
import {
  declarativeBiodiversityFindings,
  declarativeFertilizationFindings,
  declarativePhytoFindings,
  hveIrrigationFindings,
  nitrogenBalanceFindings,
  organicNitrogenFindings,
  type HveFertilizationContext,
} from "../src/index.js";

const answers = hveAnswers.parse({
  biodiversity: { animalSpecies: 3, hives: true, threatenedVarieties: 1, threatenedBreeds: 0, soilBiology: "spade_test" },
  phyto: { diagnosticTool: true, collectiveProspection: false, bsvObserverPercent: 0, alternativeMethodsPercent: 40, leakEquipment: 3, interRowCoverPercent: 100 },
  fertilization: { livestockNitrogenKg: 2000, coverRegulatory: true, coverWeeks: 10, coverPercent: 100, vulnerableZone: false },
  irrigation: { supplyTool: true, demandTool: false, mixedTool: false, efficientEquipmentPercent: 60, collective: true, waterSavingPercent: 10 },
});

describe("questionnaire HVE annuel", () => {
  it("réponses absentes : données manquantes, aucun point", () => {
    expect(declarativeBiodiversityFindings({}).every((f) => f.level === "missing" && f.points!.got === 0)).toBe(true);
  });

  it("biodiversité 4.5 à 4.8 et phyto 5.5 à 5.7", () => {
    expect(declarativeBiodiversityFindings(answers.biodiversity).map((f) => f.points!.got)).toEqual([2, 1, 1, 1]);
    const year = { campaign: 2026, parcels: [{ id: "p", name: "p", areaM2: 10_000, family: "field_crops" as const, species: null, variety: null }], treatments: [], ift: [], iftPending: [] };
    expect(declarativePhytoFindings(year, answers.phyto).map((f) => [f.ruleId, f.level, f.points!.got])).toEqual([
      ["hve.5.5", "ok", 1],
      ["hve.5.6", "ok", 1.5],
      ["hve.5.7", "ok", 2],
    ]);
  });

  const wheat = nitrogenExportsOf("triticum_aestivum");
  const ctx: HveFertilizationContext = {
    parcels: [{ id: "p1", name: "p1", areaM2: 100_000, family: "field_crops", species: "triticum_aestivum", variety: null, exports: wheat, legume: false }],
    inputs: [],
    harvests: [],
    livestock: true,
    planParcelIds: [],
    rshParcelIds: [],
    steeringParcelIds: [],
    answers: answers.fertilization,
  };

  it("azote des animaux déclaré : entre au bilan et dans la part organique ; 6.7 couverture", () => {
    // 2 000 kg N sur 10 ha = 200 kg/ha → 0 point, sans donnée manquante.
    expect(nitrogenBalanceFindings(ctx)[0]).toMatchObject({ level: "ok", value: 200, points: { got: 0 } });
    expect(organicNitrogenFindings(ctx)[0]).toMatchObject({ value: 100, points: { got: 4 } });
    expect(declarativeFertilizationFindings(ctx)[0]).toMatchObject({ ruleId: "hve.6.7", level: "ok", points: { got: 4, max: 4 } });
    const missingAnimals = { ...ctx, answers: {} };
    expect(nitrogenBalanceFindings(missingAnimals)[0]!.level).toBe("missing");
  });

  it("irrigation 7.2 à 7.5", () => {
    const f = hveIrrigationFindings({
      irrigations: [{ interventionId: "i", day: "2026-07-01", parcelIds: ["p"], depthMm: 20, areaM2: 10_000, method: "reel", origin: "groundwater", trigger: "probe", mobile: true, equipment: true }],
      parcels: [],
      irrigationEquipment: [],
      answers: answers.irrigation,
    });
    expect(f.filter((x) => /hve\.7\.[2-5]/.test(x.ruleId)).map((x) => x.points!.got)).toEqual([1, 4, 2, 0]);
  });
});
