import { describe, it, expect } from "vitest";
import { assignInterventions, deriveItinerary, doseOf, type DeriveIntervention, type DeriveProduction } from "../src/index.js";

/**
 * ITK depuis l'historique (lot IT2), sur deux jeux anonymisés construits
 * d'après les profils observés : reprise Ekylibre à l'heure près avec
 * matériels mais sans date de semis ; import au jour près sans matériel.
 */
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const ACT = "act-mais";
const TRACTEUR = "aaaaaaaa-0000-4000-8000-000000000001";
const OUTIL = "aaaaaaaa-0000-4000-8000-000000000002";
const PIERRE = "aaaaaaaa-0000-4000-8000-000000000003";
const SEMENCE = "aaaaaaaa-0000-4000-8000-000000000004";
const ENGRAIS = "aaaaaaaa-0000-4000-8000-000000000005";
const HERBI = "aaaaaaaa-0000-4000-8000-000000000006";
const H = 3600;

const prod = (id: string, parcelId: string, campaign: number, over: Partial<DeriveProduction> = {}): DeriveProduction => ({
  id,
  parcelId,
  activityId: ACT,
  campaign,
  areaM2: 100_000,
  startedOn: null,
  stoppedOn: null,
  ...over,
});
const iv = (id: string, procedure: string, day: string, parcelId: string, over: Partial<DeriveIntervention> = {}): DeriveIntervention => ({
  id,
  procedure,
  day,
  origin: "migration",
  dayPrecision: false,
  durationS: 4 * H,
  targets: [{ parcelId, workedAreaM2: 100_000 }],
  inputs: [],
  equipmentIds: [TRACTEUR, OUTIL],
  personIds: [PIERRE],
  crewTemplateId: null,
  ...over,
});
const articles = new Map([
  [SEMENCE, { name: "Maïs DKC", kind: "seed" as const }],
  [ENGRAIS, { name: "Ammonitrate", kind: "fertilizer" as const }],
  [HERBI, { name: "Herbicide", kind: "phyto" as const }],
]);

describe("ITK depuis l'historique : rattachement aux productions", () => {
  it("une intervention après la récolte du maïs 2025 appartient au maïs 2026", () => {
    const p25 = prod("p25", "A", 2025);
    const p26 = prod("p26", "A", 2026);
    const list = [iv("h25", "harvesting", "2025-10-20", "A"), iv("l26", "plowing", "2025-12-05", "A"), iv("s26", "all_in_one_sowing", "2026-05-02", "A")];
    const out = assignInterventions([p25, p26], list);
    expect(out.get("p25")!.map((i) => i.id)).toEqual(["h25"]);
    expect(out.get("p26")!.map((i) => i.id)).toEqual(["l26", "s26"]);
  });
});

describe("ITK depuis l'historique : reprise à l'heure près, sans date de semis", () => {
  // 4 parcelles de maïs 2026, 10 ha chacune : labour J-20, semis J0 (semence 90 milliers/ha), désherbage J+20 sur 1 parcelle, récolte.
  const parcels = ["A", "B", "C", "D"];
  const productions = parcels.map((p) => prod(`p-${p}`, p, 2026));
  const interventions = parcels.flatMap((p, k) => [
    iv(`lab-${p}`, "plowing", `2026-04-${String(10 + k).padStart(2, "0")}`, p, { durationS: 5 * H }),
    iv(`sem-${p}`, "all_in_one_sowing", `2026-05-${String(1 + k).padStart(2, "0")}`, p, {
      inputs: [{ articleId: SEMENCE, quantity: 90, unit: "thousand", per: "hectare" }],
      durationS: 4 * H,
    }),
    iv(`rec-${p}`, "harvesting", `2026-10-${String(10 + k).padStart(2, "0")}`, p, { durationS: 2 * H }),
  ]);
  interventions.push(iv("des-A", "spraying", "2026-05-21", "A", { inputs: [{ articleId: HERBI, quantity: 15, unit: "liter", per: "total" }] }));
  const out = deriveItinerary({ activityId: ACT, campaigns: [2026], productions, interventions, articles, newId });

  it("ancre sur la première intervention de semis, étapes dans l'ordre du temps", () => {
    expect(out.stats).toMatchObject({ productions: 4, excluded: 0, interventions: 13, toComplete: 0 });
    expect(out.content.steps.map((s) => [s.procedure, s.anchor])).toEqual([
      ["plowing", { kind: "sowing", offsetDays: -21 }],
      ["all_in_one_sowing", { kind: "sowing", offsetDays: 0 }],
      ["spraying", { kind: "sowing", offsetDays: 20 }],
      ["harvesting", { kind: "harvest", offsetDays: 0 }],
    ]);
  });

  it("dose médiane à l'hectare, matériels habituels, débit observé", () => {
    const sowing = out.content.steps[1]!;
    expect(sowing.inputs).toEqual([{ articleId: SEMENCE, kind: "seed", label: "Maïs DKC", dose: 90, unit: "thousand_per_hectare" }]);
    expect(sowing.staffing).toMatchObject({ equipmentIds: [TRACTEUR, OUTIL], personIds: [PIERRE] });
    expect(sowing.evidence).toMatchObject({ parcels: 4, ofParcels: 4, campaigns: [2026], observedRateHaH: 2.5, observedSamples: 4 });
    expect(sowing.workRateHaH).toBeUndefined(); // observé, pas saisi
  });

  it("étape faite sur une parcelle sur quatre : facultative, part 25 %, dose ramenée à l'hectare", () => {
    const spraying = out.content.steps[2]!;
    expect(spraying).toMatchObject({ optional: true, share: 0.25 });
    expect(spraying.inputs).toEqual([{ articleId: HERBI, kind: "phyto", label: "Herbicide", dose: 1.5, unit: "liter_per_hectare" }]);
  });
});

describe("ITK depuis l'historique : import au jour près, sans matériel", () => {
  const productions = [prod("w1", "A", 2026, { startedOn: "2025-10-31", stoppedOn: "2026-06-24" }), prod("w2", "B", 2026, { startedOn: "2025-11-05", stoppedOn: "2026-06-24" }), prod("w3", "C", 2026)];
  const imported = (over: Partial<DeriveIntervention>) => ({ origin: "import", dayPrecision: true, durationS: 24 * H, equipmentIds: [], personIds: [], ...over });
  const interventions = [
    iv("s1", "sowing", "2025-10-31", "A", imported({ inputs: [{ articleId: SEMENCE, quantity: 180, unit: "kilogram", per: "hectare" }] })),
    iv("s2", "sowing", "2025-11-05", "B", imported({ inputs: [{ articleId: SEMENCE, quantity: 200, unit: "kilogram", per: "hectare" }] })),
    iv("n1", "mineral_fertilizing", "2026-02-20", "A", imported({ inputs: [{ articleId: ENGRAIS, quantity: 150, unit: "Kilogramme", per: "hectare" }] })),
    iv("n2", "mineral_fertilizing", "2026-02-24", "B", imported({ inputs: [{ articleId: ENGRAIS, quantity: 150, unit: "kilogram", per: "hectare" }] })),
    iv("r1", "harvesting", "2026-06-24", "A", imported({})),
    iv("r2", "harvesting", "2026-06-24", "B", imported({})),
  ];
  const out = deriveItinerary({ activityId: ACT, campaigns: [2026], productions, interventions, articles, newId });

  it("production sans date ni intervention écartée ; aucun débit observé ; étapes « à compléter »", () => {
    expect(out.stats).toMatchObject({ productions: 2, excluded: 1, toComplete: 3, unconvertedInputs: 0 });
    for (const s of out.content.steps) {
      expect(s.evidence?.observedRateHaH).toBeUndefined();
      expect(s.staffing).toMatchObject({ equipmentIds: [], personIds: [], people: 1 });
    }
  });

  it("semis ancré sur la date de la production, doses médianes, libellé d'unité repris", () => {
    expect(out.content.steps.map((s) => [s.procedure, s.anchor.kind, "offsetDays" in s.anchor ? s.anchor.offsetDays : null])).toEqual([
      ["sowing", "sowing", 0],
      ["mineral_fertilizing", "sowing", 112],
      ["harvesting", "harvest", 0],
    ]);
    expect(out.content.steps[0]!.inputs[0]).toMatchObject({ dose: 190, unit: "kilogram_per_hectare" });
    expect(out.content.steps[1]!.inputs[0]).toMatchObject({ dose: 150, unit: "kilogram_per_hectare" });
  });
});

describe("ITK depuis l'historique : passages répétés et doses", () => {
  it("plus de quatre groupes d'une même procédure : une étape à passages répétés", () => {
    const productions = [prod("m1", "A", 2026, { startedOn: "2026-05-01", stoppedOn: "2026-09-30" }), prod("m2", "B", 2026, { startedOn: "2026-05-01", stoppedOn: "2026-09-30" })];
    const interventions = ["A", "B"].flatMap((p) => Array.from({ length: 6 }, (_, k) => iv(`w-${p}-${k}`, "plant_watering", `2026-06-${String(1 + k * 10 > 30 ? 30 : 1 + k * 10).padStart(2, "0")}`, p)));
    // Juin : 1, 11, 21, 30 ; puis des passages en juillet pour dépasser quatre groupes.
    interventions.push(...["A", "B"].flatMap((p) => [iv(`j-${p}-1`, "plant_watering", "2026-07-12", p), iv(`j-${p}-2`, "plant_watering", "2026-07-24", p)]));
    const out = deriveItinerary({ activityId: ACT, campaigns: [2026], productions, interventions, articles, newId });
    expect(out.content.steps).toHaveLength(1);
    expect(out.content.steps[0]).toMatchObject({ procedure: "plant_watering", anchor: { kind: "sowing", offsetDays: 31 }, repeat: { count: 8 } });
  });

  it("une récolte avant le semis (culture précédente) n'entre pas dans l'itinéraire", () => {
    const productions = [prod("f1", "A", 2026, { startedOn: "2026-05-10", stoppedOn: "2026-09-20" })];
    const interventions = [iv("ens", "harvesting", "2026-05-02", "A"), iv("sem", "sowing", "2026-05-10", "A"), iv("rec", "harvesting", "2026-09-20", "A")];
    const out = deriveItinerary({ activityId: ACT, campaigns: [2026], productions, interventions, articles, newId });
    expect(out.content.steps.map((s) => [s.procedure, s.anchor])).toEqual([
      ["sowing", { kind: "sowing", offsetDays: 0 }],
      ["harvesting", { kind: "harvest", offsetDays: 0 }],
    ]);
  });

  it("prairie en place depuis des années : étapes à dates fixes", () => {
    const productions = [prod("pt", "A", 2026, { startedOn: "2019-04-01", stoppedOn: null })];
    const interventions = [
      iv("f1", "plant_mowing", "2026-05-20", "A"),
      iv("n1", "mineral_fertilizing", "2026-02-25", "A", { inputs: [{ articleId: ENGRAIS, quantity: 100, unit: "kilogram", per: "hectare" }] }),
      iv("d1", "harvesting", "2025-09-15", "A"),
    ];
    const out = deriveItinerary({ activityId: ACT, campaigns: [2026], productions, interventions, articles, newId });
    expect(out.stats).toMatchObject({ productions: 1, excluded: 0 });
    expect(out.content.steps.map((s) => [s.procedure, s.anchor])).toEqual([
      ["harvesting", { kind: "date", monthDay: "09-15", yearOffset: -1 }],
      ["mineral_fertilizing", { kind: "date", monthDay: "02-25", yearOffset: 0 }],
      ["plant_mowing", { kind: "date", monthDay: "05-20", yearOffset: 0 }],
    ]);
  });

  it("conversions et refus", () => {
    expect(doseOf({ articleId: "x", quantity: 250, unit: "grain_per_square_meter", per: "total" }, 10, "seed")).toEqual({ dose: 250, unit: "grain_per_square_meter" });
    expect(doseOf({ articleId: "x", quantity: 500, unit: "gram", per: "hectare" }, 10, "phyto")).toEqual({ dose: 0.5, unit: "kilogram_per_hectare" });
    expect(doseOf({ articleId: "x", quantity: 2, unit: "hectoliter", per: "total" }, 4, "fertilizer")).toEqual({ dose: 50, unit: "liter_per_hectare" });
    expect(doseOf({ articleId: "x", quantity: 3, unit: "Sac de 50 000 grains", per: "hectare" }, 4, "seed")).toBeNull();
    expect(doseOf({ articleId: "x", quantity: 30, unit: "kilogram", per: "total" }, 0, "seed")).toBeNull();
  });
});
