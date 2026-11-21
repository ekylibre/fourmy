import { describe, it, expect } from "vitest";
import { itkContent, itkUnitAllowed, type ItkStepInput } from "@fourmy/contracts";
import { anchorDate, anchorLabel, itkMissing, itkPreview, scheduleSteps } from "../src/index.js";

/** Itinéraires techniques, lot IT1 : dates des étapes, contenu, éléments disparus, aperçu. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const step = (n: number, s: Partial<ItkStepInput>): ItkStepInput => ({ id: id(n), procedure: "plowing", anchor: { kind: "sowing", offsetDays: 0 }, ...s });
const content = (steps: ItkStepInput[]) => itkContent.parse({ schema: 1, steps });
const dates = { sowingOn: "2026-10-15", harvestOn: "2027-07-10", year: 2027 };

describe("ITK : dates des étapes", () => {
  it("J-30 du semis, J+3 de la récolte, date fixe de l'année de récolte ou de la précédente", () => {
    expect(anchorDate({ kind: "sowing", offsetDays: -30 }, dates)).toBe("2026-09-15");
    expect(anchorDate({ kind: "harvest", offsetDays: 3 }, dates)).toBe("2027-07-13");
    expect(anchorDate({ kind: "date", monthDay: "02-15", yearOffset: 0 }, dates)).toBe("2027-02-15");
    expect(anchorDate({ kind: "date", monthDay: "09-20", yearOffset: -1 }, dates)).toBe("2026-09-20");
    // 29 février d'une année non bissextile : 28.
    expect(anchorDate({ kind: "date", monthDay: "02-29", yearOffset: 0 }, dates)).toBe("2027-02-28");
  });

  it("passages répétés, ordre du temps, ancre manquante « à préciser » en fin", () => {
    const c = content([
      step(1, { procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 } }),
      step(2, { procedure: "mineral_fertilizing", anchor: { kind: "date", monthDay: "02-15", yearOffset: 0 }, repeat: { count: 3, everyDays: 30 } }),
      step(3, { procedure: "plowing", anchor: { kind: "sowing", offsetDays: -30 } }),
    ]);
    const s = scheduleSteps(c, dates);
    expect(s.map((x) => x.step.id)).toEqual([id(3), id(2), id(1)]);
    expect(s[1]!.occurrences.map((o) => o.on)).toEqual(["2027-02-15", "2027-03-17", "2027-04-16"]);
    const noHarvest = scheduleSteps(c, { ...dates, harvestOn: null });
    expect(noHarvest.at(-1)).toMatchObject({ undated: true, occurrences: [{ occurrence: 0, on: null }] });
  });

  it("libellés d'ancre", () => {
    expect(anchorLabel({ kind: "sowing", offsetDays: -30 })).toBe("semis J-30");
    expect(anchorLabel({ kind: "harvest", offsetDays: 0 })).toBe("récolte J0");
    expect(anchorLabel({ kind: "date", monthDay: "09-20", yearOffset: -1 })).toBe("20/09 (année précédente)");
  });
});

describe("ITK : contenu", () => {
  it("refuse une procédure inconnue ou d'entretien, un intrant refusé par la procédure, une unité de semences hors semis", () => {
    const bad = (s: Partial<ItkStepInput>) => itkContent.safeParse({ schema: 1, steps: [step(1, s)] }).success;
    expect(bad({ procedure: "teleportation" })).toBe(false);
    expect(bad({ procedure: "equipment_maintenance" })).toBe(false);
    expect(bad({ procedure: "plowing", inputs: [{ kind: "phyto", label: "Herbicide", dose: 2, unit: "liter_per_hectare" }] })).toBe(false);
    expect(bad({ procedure: "spraying", inputs: [{ kind: "phyto", label: "Herbicide", dose: 2, unit: "grain_per_square_meter" }] })).toBe(false);
    expect(bad({ procedure: "sowing", inputs: [{ kind: "seed", label: "Blé", dose: 250, unit: "grain_per_square_meter" }] })).toBe(true);
    expect(bad({ share: 1.2 })).toBe(false);
    expect(itkContent.safeParse({ schema: 1, steps: [step(1, {}), step(1, {})] }).success).toBe(false);
  });

  it("valeurs par défaut : part 100 %, non facultative, sans intrant ni matériel", () => {
    const s = content([step(1, {})]).steps[0]!;
    expect(s).toMatchObject({ share: 1, optional: false, inputs: [], staffing: { equipmentIds: [], personIds: [] } });
    expect(itkUnitAllowed("dose_per_hectare", "seed")).toBe(true);
    expect(itkUnitAllowed("dose_per_hectare", "fertilizer")).toBe(false);
  });
});

describe("ITK : éléments disparus et aperçu", () => {
  const c = content([
    step(1, { procedure: "sowing", inputs: [{ articleId: id(90), kind: "seed", label: "Blé Chevignon", dose: 180, unit: "kilogram_per_hectare" }], staffing: { equipmentIds: [id(91)], personIds: [id(92)] } }),
    step(2, { procedure: "spraying", anchor: { kind: "sowing", offsetDays: 25 }, share: 0.8, optional: true }),
    step(3, { procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 } }),
  ]);

  it("article, matériel et personne absents de la ferme : à remplacer", () => {
    const known = { articles: new Set<string>(), equipments: new Set([id(91)]), people: new Set<string>(), crewTemplates: new Set<string>() };
    expect(itkMissing(c, known)).toEqual([
      { stepId: id(1), kind: "article", id: id(90), label: "Blé Chevignon" },
      { stepId: id(1), kind: "person", id: id(92), label: null },
    ]);
  });

  it("frise : une culture du semis à la récolte, marques prévues aux bons couloirs", () => {
    const t = itkPreview({ name: "Blé tendre", color: "#c90", content: c, dates });
    expect(t.steps).toHaveLength(1);
    const s = t.steps[0]!;
    expect(s).toMatchObject({ from: "2026-10-15", to: "2027-07-10", kind: "crop" });
    expect(s.marks.map((m) => [m.procedure, m.lane, m.status, m.at, m.day])).toEqual([
      ["sowing", "works", "planned", "2026-10-15", 0],
      ["spraying", "inputs", "planned", "2026-11-09", 25],
      ["harvesting", "works", "planned", "2027-07-10", 268],
    ]);
    expect(s.marks[1]!.details).toEqual(expect.arrayContaining([{ label: "Part de la surface", value: "80 %" }, { label: "Facultative", value: "si besoin" }]));
  });
});
