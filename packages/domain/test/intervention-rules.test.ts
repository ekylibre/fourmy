import { describe, it, expect } from "vitest";
import { getProcedure, PROCEDURES, PROCEDURE_LABELS } from "@fourmy/contracts";
import { deriveNature, validateIntervention, periodBounds, storedUnit, splitUnit } from "../src/index.js";

const kinds: Record<string, "phyto" | "fertilizer" | "seed" | "harvest" | "other"> = {
  "00000000-0000-7000-8000-000000000001": "phyto",
  "00000000-0000-7000-8000-000000000002": "fertilizer",
  "00000000-0000-7000-8000-000000000003": "seed",
  "00000000-0000-7000-8000-000000000004": "harvest",
};
const ctx = { articleKind: (id: string) => kinds[id] };
const [PHYTO, FERTI, , HARVEST] = Object.keys(kinds) as [string, string, string, string];
const parcel = { kind: "land_parcel" as const, id: "00000000-0000-7000-8000-0000000000a1" };
const tractor = { kind: "equipment" as const, id: "00000000-0000-7000-8000-0000000000b1" };
const day = [{ startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T10:00:00Z" }];
const empty = { periods: [], targets: [], inputs: [], outputs: [], purposes: [] };

describe("catalogue des procédures", () => {
  it("chaque procédure du catalogue a son libellé officiel Ekylibre", () => {
    expect(PROCEDURES.length).toBeGreaterThan(50);
    for (const p of PROCEDURES) expect(PROCEDURE_LABELS[p.code], p.code).toBe(p.label);
  });
  it("couvre les 37 procédures utilisées par les fermes pilotes", () => {
    const used = "all_in_one_sowing raking spraying plowing harvesting equipment_maintenance fertilizing vine_spraying_without_fertilizing superficial_plowing vine_raking vine_soil_fertilizing vine_pruning vine_trunk_cleaning_debudding crop_residues_grinding vine_shearing vine_folding intervine_maintenance vine_spraying_with_fertilizing vine_shoot_extracting vine_lifting sowing vine_trimming generic_spraying vine_inter_row_grinding vine_trellising_construction vine_shoot_grinding vine_inter_row_sowing intervine_hill_removing vine_complanting intervine_hilling vine_plowing vine_wire_lifting_dropping hoeing installation_maintenance vine_grubbing vine_planting vine_stakes_replacing".split(" ");
    expect(used).toHaveLength(37);
    for (const code of used) expect(getProcedure(code).legacy, code).toBe(false);
  });
  it("une procédure inconnue reste lisible (forme travail, libellé Ekylibre)", () => {
    const p = getProcedure("grape_pressing");
    expect(p).toMatchObject({ shape: "work", label: "Pressage de raisin", legacy: true });
  });
});

describe("règles de forme", () => {
  const spraying = getProcedure("spraying");

  it("irrigation : dose obligatoire à la réalisation, refusée hors irrigation", () => {
    const watering = getProcedure("watering");
    expect(watering).toMatchObject({ label: "Irrigation", legacy: false, category: "crops" });
    const body = { ...empty, periods: day, targets: [parcel] };
    expect(validateIntervention(watering, body, "complete", ctx)).toContain("Indiquez la dose d'eau apportée (mm).");
    expect(validateIntervention(watering, body, "plan", ctx)).toEqual([]);
    expect(validateIntervention(watering, { ...body, irrigation: { depthMm: 30, method: "reel" } }, "complete", ctx)).toEqual([]);
    expect(validateIntervention(getProcedure("plowing"), { ...body, irrigation: { depthMm: 30 } }, "complete", ctx)).toContain(
      "La dose d'eau ne concerne que les irrigations.",
    );
  });

  it("traitement réalisé valide : parcelle, phyto, période", () => {
    const body = { ...empty, periods: day, targets: [parcel], inputs: [{ articleId: PHYTO, quantity: 2, per: "hectare" as const }], purposes: ["fungicide" as const] };
    expect(validateIntervention(spraying, body, "complete", ctx)).toEqual([]);
  });

  it("à la planification, seules les incompatibilités comptent", () => {
    expect(validateIntervention(spraying, empty, "plan", ctx)).toEqual([]);
    expect(validateIntervention(spraying, { ...empty, targets: [tractor] }, "plan", ctx)).toEqual(["« Pulvérisation » porte sur des parcelles."]);
  });

  it("à la réalisation, les minimums de la forme s'appliquent", () => {
    expect(validateIntervention(spraying, empty, "complete", ctx)).toEqual([
      "Choisissez au moins une parcelle.",
      "Un traitement demande au moins un produit phytosanitaire.",
      "Au moins une période de travail.",
    ]);
  });

  it("refuse une nature d'intrant que la procédure n'accepte pas", () => {
    const body = { ...empty, inputs: [{ articleId: FERTI, quantity: 100, per: "hectare" as const }] };
    expect(validateIntervention(spraying, body, "plan", ctx)).toEqual(["« Pulvérisation » n'accepte pas de fertilisant en intrant."]);
    // … mais la pulvérisation avec fertilisation (vigne) l'accepte.
    expect(validateIntervention(getProcedure("vine_spraying_with_fertilizing"), body, "plan", ctx)).toEqual([]);
  });

  it("une récolte exige un produit récolté et sa destination", () => {
    const harvest = getProcedure("manual_vine_harvest");
    const base = { ...empty, periods: day, targets: [parcel] };
    expect(validateIntervention(harvest, base, "complete", ctx)).toEqual(["Une récolte demande au moins un produit récolté."]);
    const noDest = { ...base, outputs: [{ articleId: HARVEST, quantity: 3000, per: "total" as const }] };
    expect(validateIntervention(harvest, noDest, "complete", ctx)).toEqual(["Sortie n° 1 : précisez où elle est rangée (lieu ou cuve)."]);
    const ok = { ...base, outputs: [{ articleId: HARVEST, quantity: 3000, per: "total" as const, to: { containerId: tractor.id } }] };
    expect(validateIntervention(harvest, ok, "complete", ctx)).toEqual([]);
  });

  it("un entretien porte sur un matériel ; les motifs sont réservés aux traitements", () => {
    const maint = getProcedure("equipment_maintenance");
    expect(validateIntervention(maint, { ...empty, periods: day, targets: [tractor] }, "complete", ctx)).toEqual([]);
    expect(validateIntervention(maint, { ...empty, targets: [parcel] }, "plan", ctx)).toEqual([
      "Un entretien porte sur un matériel ou un bâtiment, pas sur une parcelle.",
    ]);
    expect(validateIntervention(getProcedure("plowing"), { ...empty, purposes: ["herbicide"] }, "plan", ctx)).toEqual([
      "Les motifs (herbicide, fongicide…) ne concernent que les traitements.",
    ]);
  });

  it("périodes : ordre et chevauchement", () => {
    const overlap = [
      { startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T12:00:00Z" },
      { startedAt: "2026-06-10T11:00:00Z", stoppedAt: "2026-06-10T13:00:00Z" },
    ];
    expect(validateIntervention(getProcedure("vine_pruning"), { ...empty, targets: [parcel], periods: overlap }, "complete", ctx)).toEqual([
      "Deux périodes de travail se chevauchent.",
    ]);
    expect(periodBounds([...overlap].reverse())).toEqual({ startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T13:00:00Z" });
  });
});

describe("unités", () => {
  it("dose par hectare ↔ unité stockée", () => {
    expect(storedUnit("liter", "hectare")).toBe("liter_per_hectare");
    expect(splitUnit("kilogram_per_hectare")).toEqual({ unit: "kilogram", per: "hectare" });
    expect(splitUnit("ton")).toEqual({ unit: "ton", per: "total" });
  });
});

describe("entretien (lot K)", () => {
  const maint = getProcedure("equipment_maintenance");
  const EQ = "0193a000-0000-7000-8000-00000000e001";
  const OP = "0193a000-0000-7000-8000-00000000c001";
  const period = [{ startedAt: "2026-11-08T08:00:00.000Z", stoppedAt: "2026-11-08T10:00:00.000Z" }];
  const base = { periods: period, targets: [{ kind: "equipment" as const, id: EQ, meter: { value: 4330 } }], inputs: [], outputs: [], purposes: [] };
  const ctx = { articleKind: () => "part" as const };

  it("préventif dès qu'une opération du plan est cochée ; curatif sinon, avec le problème", () => {
    expect(deriveNature([{ result: "ok" }])).toBe("preventive");
    expect(deriveNature([])).toBe("corrective");
    expect(validateIntervention(maint, { ...base, maintenance: { operations: [{ equipmentId: EQ, operationId: OP, result: "done" }] } }, "complete", ctx)).toEqual([]);
    expect(validateIntervention(maint, { ...base, maintenance: { operations: [] } }, "complete", ctx)).toContain("Une réparation (entretien curatif) demande la description du problème.");
    expect(validateIntervention(maint, { ...base, maintenance: { operations: [], problem: "Fuite vérin relevage AV" } }, "complete", ctx)).toEqual([]);
    // Sans bloc entretien (ancien mobile) : accepté comme avant.
    expect(validateIntervention(maint, base, "complete", ctx)).toEqual([]);
  });

  it("opérations, pièces et relevés visent les matériels entretenus", () => {
    const other = "0193a000-0000-7000-8000-00000000e002";
    expect(validateIntervention(maint, { ...base, maintenance: { operations: [{ equipmentId: other, operationId: OP, result: "done" }] } }, "plan", ctx)).toContain(
      "Une opération du plan doit viser un matériel entretenu.",
    );
    expect(validateIntervention(maint, { ...base, inputs: [{ articleId: OP, quantity: 1, per: "total", equipmentId: other }] }, "plan", ctx)).toContain(
      "Une pièce ou un fluide est rattaché à un matériel qui n'est pas entretenu.",
    );
    const plowing = getProcedure("plowing");
    expect(validateIntervention(plowing, { ...base, targets: [{ kind: "land_parcel", id: EQ, meter: { value: 1 } }] }, "plan", ctx)).toContain("Un relevé de compteur se saisit sur un matériel.");
  });
});
