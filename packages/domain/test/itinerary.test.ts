import { describe, it, expect } from "vitest";
import { PROCEDURES } from "@fourmy/contracts";
import { buildActivityItinerary, buildParcelItinerary, cropSpan, groupMarks, laneOf, TIKA_DEFAULT_COLORS, toTikaSystem, type ItineraryIntervention } from "../src/index.js";

/** Itinéraires techniques (conception §3) : couloirs, dates des cultures, rattachement, regroupement. */
const w2026 = { year: 2026, from: "2025-09-01", to: "2026-09-01" };
const w2025 = { year: 2025, from: "2024-09-01", to: "2025-09-01" };
/** Campagne civile (cas d'Ekylibre) : la récolte du maïs en octobre y reste. */
const c2026 = { year: 2026, from: "2026-01-01", to: "2027-01-01" };
const P1 = { id: "p1", name: "Grande pièce" };
const P2 = { id: "p2", name: "Bas du bois" };
let n = 0;
const iv = (procedure: string, day: string, more: Partial<ItineraryIntervention> = {}): ItineraryIntervention => ({
  id: `i${++n}`,
  procedure,
  status: "done",
  at: `${day}T08:00:00Z`,
  irrigation: false,
  label: procedure,
  details: [],
  parcels: [P1],
  ...more,
});

describe("couloir d'une intervention", () => {
  it("travaux au-dessus, intrants au-dessous, entretien du matériel exclu", () => {
    expect(laneOf("plowing")).toBe("works");
    expect(laneOf("all_in_one_sowing")).toBe("works");
    expect(laneOf("harvesting")).toBe("works");
    expect(laneOf("vine_pruning")).toBe("works");
    expect(laneOf("fertilizing")).toBe("inputs");
    expect(laneOf("vine_spraying_without_fertilizing")).toBe("inputs");
    expect(laneOf("watering")).toBe("inputs");
    expect(laneOf("hoeing", true)).toBe("inputs"); // irrigation renseignée
    expect(laneOf("equipment_maintenance")).toBeNull();
    expect(laneOf("procedure_ekylibre_rare")).toBe("works");
  });
  it("aucune procédure de culture ou de vigne du catalogue n'est sans couloir", () => {
    const orphans = PROCEDURES.filter((p) => (p.category === "crops" || p.category === "vine") && laneOf(p.code) === null);
    expect(orphans.map((p) => p.code)).toEqual([]);
  });
});

describe("dates d'une culture", () => {
  it("du premier semis à la dernière récolte réalisés", () => {
    const span = cropSpan([iv("plowing", "2025-10-01"), iv("sowing", "2025-10-15"), iv("harvesting", "2026-07-10"), iv("harvesting", "2026-07-20")], w2026);
    expect(span).toEqual({ from: "2025-10-15", to: "2026-07-20", source: "interventions" });
  });
  it("vigne sans semis, ou récolte seulement prévue : bornes de la campagne", () => {
    expect(cropSpan([iv("vine_pruning", "2026-02-01"), iv("mecanical_vine_harvest", "2026-08-20")], w2026)).toEqual({ from: "2025-09-01", to: "2026-08-20", source: "campaign" });
    expect(cropSpan([iv("sowing", "2025-10-15"), iv("harvesting", "2026-07-10", { status: "planned" })], w2026)).toEqual({ from: "2025-10-15", to: "2026-08-31", source: "campaign" });
  });
  it("le semis d'un couvert ne fixe pas le début de la culture", () => {
    expect(cropSpan([iv("plant_cover_sowing", "2025-09-10"), iv("sowing", "2026-04-12"), iv("harvesting", "2026-08-25")], w2026).from).toBe("2026-04-12");
  });
  it("une intervention tard le soir compte pour son jour à Paris", () => {
    // 22 h 30 UTC le 14 octobre = 0 h 30 le 15 à Paris
    expect(cropSpan([{ procedure: "sowing", status: "done", at: "2025-10-14T22:30:00Z" }, iv("harvesting", "2026-07-10")], w2026).from).toBe("2025-10-15");
  });
});

describe("itinéraire d'une parcelle", () => {
  it("labour avant le semis : jour négatif ; entretien du matériel et campagne vide écartés", () => {
    const it = buildParcelItinerary({
      title: "Grande pièce",
      campaigns: [
        { window: w2025, crops: [], cover: null },
        { window: w2026, crops: [{ name: "Blé tendre", color: "#d9a441", attributes: [{ label: "Variété", value: "Rubisko" }] }], cover: null },
      ],
      interventions: [iv("plowing", "2025-10-05"), iv("sowing", "2025-10-15"), iv("fertilizing", "2026-03-01"), iv("equipment_maintenance", "2026-03-02"), iv("harvesting", "2026-07-15")],
    });
    expect(it.campaigns).toEqual([2025, 2026]);
    expect(it.steps).toHaveLength(1);
    const step = it.steps[0]!;
    expect(step).toMatchObject({ kind: "crop", name: "Blé tendre", from: "2025-10-15", to: "2026-07-15", datesFrom: "interventions" });
    expect(step.marks.map((m) => [m.procedure, m.day, m.lane])).toEqual([
      ["plowing", -10, "works"],
      ["sowing", 0, "works"],
      ["fertilizing", 137, "inputs"],
      ["harvesting", 273, "works"],
    ]);
  });
  it("couvert : étape secondaire, semis et destruction rattachés au couvert, pas à la culture précédente", () => {
    const it = buildParcelItinerary({
      title: "Grande pièce",
      campaigns: [
        { window: w2025, crops: [{ name: "Orge", color: null, attributes: [] }], cover: null },
        { window: w2026, crops: [{ name: "Maïs", color: null, attributes: [] }], cover: { name: "Moutarde", sownOn: "2025-08-25", destroyedOn: "2026-02-15", attributes: [] } },
      ],
      interventions: [
        iv("sowing", "2024-10-10"),
        iv("harvesting", "2025-07-10"),
        iv("plant_cover_sowing", "2025-08-26"), // fenêtre 2025, mais c'est le couvert de 2026
        iv("plant_grinding", "2026-02-15"),
        iv("sowing", "2026-04-20"),
        iv("harvesting", "2026-08-30"),
      ],
    });
    expect(it.steps.map((s) => `${s.kind}:${s.name}`)).toEqual(["crop:Orge", "cover:Moutarde", "crop:Maïs"]);
    const [orge, cover, mais] = it.steps;
    expect(cover!.marks.map((m) => m.procedure)).toEqual(["plant_cover_sowing", "plant_grinding"]);
    expect(orge!.marks.map((m) => m.procedure)).toEqual(["sowing", "harvesting"]);
    expect(mais!.marks.map((m) => m.procedure)).toEqual(["sowing", "harvesting"]);
  });
  it("deux productions la même campagne : une étape « A + B »", () => {
    const it = buildParcelItinerary({
      title: "x",
      campaigns: [{ window: w2026, crops: [{ name: "Blé", color: null, attributes: [] }, { name: "Pois", color: null, attributes: [] }], cover: null }],
      interventions: [],
    });
    expect(it.steps.map((s) => [s.name, s.datesFrom])).toEqual([["Blé + Pois", "campaign"]]);
  });
});

describe("vue fusionnée", () => {
  it("regroupe à 7 jours d'écart (en chaîne), 15 pour la récolte ; statuts séparés ; parcelles distinctes", () => {
    const marks = buildParcelItinerary({
      title: "x",
      campaigns: [{ window: c2026, crops: [{ name: "Maïs", color: null, attributes: [] }], cover: null }],
      interventions: [
        iv("sowing", "2026-04-12", { parcels: [P1] }),
        iv("sowing", "2026-04-17", { parcels: [P2] }),
        iv("sowing", "2026-04-22", { parcels: [P1, P2] }), // chaîne : 5 jours après le précédent
        iv("sowing", "2026-05-10", { parcels: [P2] }), // 18 jours : nouveau groupe
        iv("sowing", "2026-05-11", { parcels: [P1], status: "planned" }),
        iv("harvesting", "2026-09-01", { parcels: [P1] }),
        iv("harvesting", "2026-09-14", { parcels: [P2] }),
      ],
    }).steps[0]!.marks;
    const grouped = groupMarks(marks, "2026-04-12");
    expect(grouped.map((m) => [m.procedure, m.status, m.from, m.to, m.interventionIds.length, m.parcels.length])).toEqual([
      ["sowing", "done", "2026-04-12", "2026-04-22", 3, 2],
      ["sowing", "done", "2026-05-10", "2026-05-10", 1, 1],
      ["sowing", "planned", "2026-05-11", "2026-05-11", 1, 1],
      ["harvesting", "done", "2026-09-01", "2026-09-14", 2, 2],
    ]);
    const first = grouped[0]!;
    expect(first.at).toBe("2026-04-17");
    expect(first.day).toBe(5);
    expect(first.label).toBe("sowing, 2 parcelles");
    expect(first.details[0]).toEqual({ label: "Dates", value: "du 12 avril au 22 avril" });
  });
  it("activité : dates englobantes, parcelles hors activité ignorées, parcelles sans intervention comptées", () => {
    const outside = { id: "p9", name: "Ailleurs" };
    const a = buildActivityItinerary({
      title: "Maïs 2026",
      window: c2026,
      crop: { name: "Maïs", color: "#e0b000", attributes: [] },
      parcels: [
        { id: "p1", name: "Grande pièce", areaM2: 50_000 },
        { id: "p2", name: "Bas du bois", areaM2: 30_000 },
        { id: "p3", name: "Coteau", areaM2: 20_000 },
      ],
      interventions: [
        iv("sowing", "2026-04-12", { parcels: [P1, outside] }),
        iv("sowing", "2026-04-20", { parcels: [P2] }),
        iv("harvesting", "2026-09-10", { parcels: [P1] }),
        iv("harvesting", "2026-10-02", { parcels: [P2] }),
        iv("plowing", "2026-03-01", { parcels: [outside] }),
      ],
    });
    const step = a.steps[0]!;
    expect(step).toMatchObject({ from: "2026-04-12", to: "2026-10-02", datesFrom: "interventions" });
    expect(step.marks.every((m) => m.parcels.every((p) => p.id !== "p9"))).toBe(true);
    expect(step.marks.some((m) => m.procedure === "plowing")).toBe(false);
    expect(a.parcels).toEqual([
      { id: "p2", name: "Bas du bois", areaM2: 30_000, interventions: 2 },
      { id: "p3", name: "Coteau", areaM2: 20_000, interventions: 0 },
      { id: "p1", name: "Grande pièce", areaM2: 50_000, interventions: 2 },
    ]);
  });
});

describe("conversion au format TIKA", () => {
  it("étapes, couloirs, couvert en culture secondaire, statut et ref pour la fiche", () => {
    const it = buildParcelItinerary({
      title: "Grande pièce",
      campaigns: [{ window: w2026, crops: [{ name: "Maïs", color: null, attributes: [{ label: "Surface", value: "5 ha" }] }], cover: { name: "Couvert : moutarde", sownOn: "2025-09-05", destroyedOn: "2026-02-01", attributes: [] } }],
      interventions: [
        iv("plant_cover_sowing", "2025-09-06"),
        iv("plowing", "2026-03-20"),
        iv("sowing", "2026-04-15"),
        iv("fertilizing", "2026-05-01", { status: "planned", details: [{ label: "Intrants", value: "Ammonitrate 150 kg/ha" }] }),
        iv("harvesting", "2026-08-25"),
      ],
    });
    const t = toTikaSystem(it);
    expect(t.options).toMatchObject({ view: "horizontal", show_transcript: true, title_top_interventions: "Travaux", title_bottom_interventions: "Intrants", title_steps: "Culture", show_climate_diagram: false });
    expect(t.steps.map((s) => [s.name, s.secondary_crop, s.color])).toEqual([
      ["Couvert : moutarde", true, TIKA_DEFAULT_COLORS.cover],
      ["Maïs", false, TIKA_DEFAULT_COLORS.crop],
    ]);
    const mais = t.steps[1]!;
    expect(mais.description).toBe("Surface : 5 ha");
    expect(mais.interventions.map((i) => [i.name, i.day, i.type, i.status])).toEqual([
      ["plowing", -26, "intervention_top", "done"],
      ["sowing", 0, "intervention_top", "done"],
      ["fertilizing", 16, "intervention_bottom", "planned"],
      ["harvesting", 132, "intervention_top", "done"],
    ]);
    expect(mais.interventions[2]!.description).toBe("Intrants : Ammonitrate 150 kg/ha");
    expect(mais.interventions[2]!.ref.interventionIds).toHaveLength(1);
    expect(toTikaSystem(it, { view: "donut" }).options.view).toBe("donut");
    // Sans semis ni récolte : la frise le dit.
    const vine = toTikaSystem(buildParcelItinerary({ title: "x", campaigns: [{ window: w2026, crops: [{ name: "Vigne", color: "#7a3b5c", attributes: [] }], cover: null }], interventions: [] }));
    expect(vine.steps[0]!.description).toBe("Dates : bornes de la campagne (ni semis ni récolte enregistrés)");
    expect(vine.steps[0]!.color).toBe("#7a3b5c");
  });
});

describe("membres d'un groupe", () => {
  it("chaque intervention d'une marque regroupée, pour l'ouvrir", () => {
    const marks = buildParcelItinerary({
      title: "x",
      campaigns: [{ window: { year: 2026, from: "2026-01-01", to: "2027-01-01" }, crops: [{ name: "Maïs", color: null, attributes: [] }], cover: null }],
      interventions: [iv("sowing", "2026-04-12", { parcels: [P1], label: "Semis · DKC" }), iv("sowing", "2026-04-15", { parcels: [P2], label: "Semis · DKC", status: "done" })],
    }).steps[0]!.marks;
    const [g] = groupMarks(marks, "2026-04-12");
    expect(g!.members).toEqual([
      { interventionId: g!.interventionIds[0], at: "2026-04-12", label: "Semis · DKC", status: "done", parcels: ["Grande pièce"] },
      { interventionId: g!.interventionIds[1], at: "2026-04-15", label: "Semis · DKC", status: "done", parcels: ["Bas du bois"] },
    ]);
    expect(toTikaSystem({ title: "x", campaigns: [2026], steps: [{ kind: "crop", campaign: 2026, name: "Maïs", color: null, from: "2026-04-12", to: "2026-09-01", datesFrom: "interventions", attributes: [], marks: [g!] }] }).steps[0]!.interventions[0]!.ref.members).toHaveLength(2);
    // Une marque seule n'a pas de membres.
    expect(marks[0]!.members).toBeUndefined();
  });
});
