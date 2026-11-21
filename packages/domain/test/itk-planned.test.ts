import { describe, it, expect } from "vitest";
import { itkContent } from "@fourmy/contracts";
import { plannedKey, plannedSignature, proposeInterventions, reconcilePlanned, type ExistingPlanned, type PlannedProposal } from "../src/index.js";

/** Interventions prévues d'une campagne (lot IT3) : proposition et rapprochement. */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEED = ID(90);
const itk = {
  id: ID(1),
  name: "Blé tendre — Le Champ",
  revision: 2,
  content: itkContent.parse({
    schema: 1,
    steps: [
      { id: ID(11), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, inputs: [{ articleId: SEED, kind: "seed", label: "Blé", dose: 180, unit: "kilogram_per_hectare" }] },
      { id: ID(12), procedure: "mineral_fertilizing", anchor: { kind: "date", monthDay: "02-15", yearOffset: 0 }, repeat: { count: 2, everyDays: 30 }, inputs: [{ kind: "fertilizer", label: "Azote", dose: 40, unit: "kilogram_per_hectare" }] },
      { id: ID(13), procedure: "spraying", anchor: { kind: "sowing", offsetDays: 25 }, share: 0.5, optional: true },
      { id: ID(14), procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 } },
    ],
  }),
};
const production = { id: ID(100), parcelId: ID(200), parcelName: "Le Champ", areaM2: 100_000, activityName: "Blé tendre", campaign: 2027, itineraryId: itk.id, sowingOn: "2026-10-15", harvestOn: null };
const signature = (p: PlannedProposal) =>
  plannedSignature({
    procedure: p.procedure,
    day: p.day!,
    targets: [{ id: p.parcelId, workedAreaM2: p.areaM2 }],
    inputs: p.inputs.filter((i) => i.articleId).map((i) => ({ articleId: i.articleId!, quantity: i.dose, unit: i.unit })),
    equipmentIds: p.equipmentIds,
    personIds: p.personIds,
  });

describe("interventions prévues : proposition", () => {
  const proposals = proposeInterventions([production], new Map([[itk.id, itk]]));

  it("une proposition par étape et par passage, dates calculées, récolte inconnue « à préciser »", () => {
    expect(proposals.map((p) => [p.procedure, p.day, p.label])).toEqual([
      ["sowing", "2026-10-15", "Semis"],
      ["spraying", "2026-11-09", "Pulvérisation"],
      ["mineral_fertilizing", "2027-02-15", "Fertilisation minérale (1/2)"],
      ["mineral_fertilizing", "2027-03-17", "Fertilisation minérale (2/2)"],
      ["harvesting", null, "Récolte"],
    ]);
    expect(proposals[0]!.key).toBe(plannedKey(ID(100), ID(11), 0));
  });

  it("part de la surface, étape facultative, intrant générique dans les notes", () => {
    expect(proposals[1]).toMatchObject({ areaM2: 50_000, optional: true });
    expect(proposals[2]!.notes).toBe("Intrants à préciser : Azote 40 kilogram/ha");
    expect(proposals[0]!.inputs).toEqual([{ articleId: SEED, label: "Blé", dose: 180, unit: "kilogram_per_hectare" }]);
  });

  it("empreinte stable quel que soit l'ordre, sensible au contenu", () => {
    const base = { procedure: "sowing", day: "2026-10-15", targets: [{ id: "a", workedAreaM2: 1 }], inputs: [], equipmentIds: ["x", "y"], personIds: [] };
    expect(plannedSignature(base)).toBe(plannedSignature({ ...base, equipmentIds: ["y", "x"] }));
    expect(plannedSignature(base)).not.toBe(plannedSignature({ ...base, day: "2026-10-16" }));
  });
});

describe("interventions prévues : rapprochement", () => {
  const proposals = proposeInterventions([production], new Map([[itk.id, itk]]));
  const [sowing, spraying, n1, n2] = proposals;
  const ref = (p: PlannedProposal, hash: string) => ({ itineraryId: itk.id, revision: 1, stepId: p.stepId, occurrence: p.occurrence, productionId: p.productionId, campaign: 2027, hash });
  const existing: ExistingPlanned[] = [
    { id: "same", status: "planned", ref: ref(sowing!, signature(sowing!)), currentHash: signature(sowing!) },
    { id: "stale", status: "planned", ref: ref(spraying!, "ancienne"), currentHash: "ancienne" },
    { id: "touched", status: "planned", ref: ref(n1!, signature(n1!)), currentHash: "déplacée" },
    { id: "done", status: "done", ref: ref(n2!, "x"), currentHash: "y" },
    { id: "gone", status: "planned", ref: { ...ref(sowing!, "z"), stepId: ID(99) }, currentHash: "z" },
    { id: "gone-touched", status: "planned", ref: { ...ref(sowing!, "z"), stepId: ID(98) }, currentHash: "autre" },
  ];
  const r = reconcilePlanned(proposals, existing, signature);
  const state = (id: string) => r.find((x) => x.existing?.id === id)?.state;

  it("les cas du §7 : à jour, à refaire, modifiée gardée, réalisée jamais touchée, retirée", () => {
    expect(state("same")).toBe("same");
    expect(state("stale")).toBe("update");
    expect(state("touched")).toBe("modified");
    expect(state("done")).toBe("done");
    expect(state("gone")).toBe("remove");
    expect(state("gone-touched")).toBe("modified");
    expect(r.filter((x) => x.state === "undated")).toHaveLength(1); // récolte sans date
  });

  it("relancée après création : rien de nouveau", () => {
    const created = proposals.filter((p) => p.day).map((p, k) => ({ id: `i${k}`, status: "planned" as const, ref: ref(p, signature(p)), currentHash: signature(p) }));
    expect(reconcilePlanned(proposals, created, signature).filter((x) => x.state !== "same" && x.state !== "undated")).toEqual([]);
  });
});
