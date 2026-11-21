import { describe, it, expect } from "vitest";
import { itkContent, type ItkWorkContext } from "@fourmy/contracts";
import { isoWeek, itkPerHectare, resolveWorkRate, workload } from "../src/index.js";

/** Temps de travaux (lot IT4) : débit et sa source, allers-retours, étalement, capacité, inconnus. */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TRACTOR = ID(1);
const DRILL = ID(2);
const SPRAYER = ID(3);
const PIERRE = ID(9);
const ctx = (over: Partial<ItkWorkContext> = {}): ItkWorkContext => ({
  year: 2027,
  itineraries: {},
  equipments: [
    { id: TRACTOR, name: "Tracteur", widthM: null, machineryRateId: null, suggestedRateId: null, carrier: true },
    { id: DRILL, name: "Semoir 4 m", widthM: 4, machineryRateId: "semis--semoir-3m", suggestedRateId: null, carrier: false },
    { id: SPRAYER, name: "Pulvé 24 m", widthM: 24, machineryRateId: null, suggestedRateId: null, carrier: false },
  ],
  people: [{ id: PIERRE, name: "Pierre" }],
  crewTemplates: {},
  observed: [],
  machineryRates: { "semis--semoir-3m": { id: "semis--semoir-3m", label: "Semoir 3 m", family: "Semis", widthM: 3, haH: 1.5 } },
  familyPerMeter: { spraying: 0.25 },
  routes: { "p:a": { distanceM: 5000, durationS: 900, method: "osrm" } },
  site: { id: ID(50), name: "Siège" },
  settings: { workdayHours: 8, weeklyHoursPerPerson: 40, defaultSiteId: null },
  rateSource: "BCMA 2024",
  ...over,
});
const step = (s: Record<string, unknown>) => itkContent.parse({ schema: 1, steps: [{ id: ID(100), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, ...s }] }).steps[0]!;

describe("débit d'une étape", () => {
  it("saisi > observé > barème du matériel (à l'échelle de sa largeur) > largeur × famille > inconnu", () => {
    const c = ctx();
    expect(resolveWorkRate(step({ workRateHaH: 3, staffing: { equipmentIds: [TRACTOR, DRILL] } }), c)).toMatchObject({ haH: 3, source: "input" });
    const observed = ctx({ observed: [{ procedure: "sowing", equipmentId: DRILL, haH: 1.2, samples: 5 }] });
    expect(resolveWorkRate(step({ staffing: { equipmentIds: [TRACTOR, DRILL] } }), observed)).toMatchObject({ haH: 1.2, source: "observed", label: "Semoir 4 m" });
    // Barème 1,5 ha/h pour 3 m, semoir de 4 m : 2 ha/h.
    expect(resolveWorkRate(step({ staffing: { equipmentIds: [TRACTOR, DRILL] } }), c)).toMatchObject({ haH: 2, source: "bcma", label: "Semoir 3 m" });
    expect(resolveWorkRate(step({ procedure: "spraying", staffing: { equipmentIds: [SPRAYER] } }), c)).toMatchObject({ haH: 6, source: "width" });
    expect(resolveWorkRate(step({ staffing: { equipmentIds: [], personIds: [], machineryRateId: "semis--semoir-3m" } }), c)).toMatchObject({ haH: 1.5, source: "bcma" });
    expect(resolveWorkRate(step({ procedure: "plowing" }), c)).toBeNull();
    expect(resolveWorkRate(step({ evidence: { parcels: 1, ofParcels: 1, campaigns: [2026], observedRateHaH: 2.6 } }), c)).toMatchObject({ haH: 2.6, source: "observed" });
  });

  it("heures par hectare d'un ITK", () => {
    const content = { steps: [step({ workRateHaH: 2, repeat: { count: 3, everyDays: 10 }, share: 0.5 })] };
    expect(itkPerHectare(content, ctx())[0]!.hoursPerHa).toBe(0.75);
  });
});

describe("cumuls de l'assolement", () => {
  const content = itkContent.parse({
    schema: 1,
    steps: [
      { id: ID(101), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, staffing: { equipmentIds: [TRACTOR, DRILL], personIds: [PIERRE] }, windowDays: 5 },
      { id: ID(102), procedure: "plowing", anchor: { kind: "sowing", offsetDays: -20 } },
      { id: ID(103), procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 }, workRateHaH: 2 },
    ],
  });
  const c = ctx({ itineraries: { itk: { id: "itk", name: "Blé", revision: 0, activityId: "ble", content } } });
  const items = [
    { id: "a", parcelKey: "p:a", routeKey: "p:a", areaM2: 240_000, activityId: "ble", itineraryId: "itk", sowingOn: "2026-10-15", harvestOn: null, year: 2027 },
    { id: "b", parcelKey: "n:b", routeKey: null, areaM2: 40_000, activityId: "ble", itineraryId: "itk", sowingOn: "2026-10-15", harvestOn: "2027-07-10", year: 2027 },
  ];
  const r = workload(items, c, { activities: new Map([["ble", "Blé tendre"]]), procedures: (p) => p });

  it("heures au champ, allers-retours par journée de chantier, km ; inconnus comptés", () => {
    // Semis : 24 ha / 2 ha/h = 12 h (2 journées, 4 trajets de 15 min = 1 h, 20 km) ; 4 ha / 2 = 2 h (trajet inconnu).
    // Récolte : 4 ha / 2 ha/h = 2 h sur b ; date inconnue sur a. Labour : débit inconnu (×2 cultures).
    expect(r.fieldH).toBe(16);
    expect(r.routeH).toBe(1);
    expect(r.km).toBe(20);
    expect(r.unknown).toEqual({ rates: 2, routes: 2, dates: 1 });
    expect(r.rateSources).toEqual({ bcma: 2, input: 2 });
    expect(r.byPerson).toEqual([
      { id: PIERRE, name: "Pierre", hours: 15 },
      { id: null, name: "Main-d'œuvre non nommée", hours: 2 },
    ]);
    expect(r.byEquipment.map((e) => [e.name, e.hours])).toEqual([["Tracteur", 15], ["Semoir 4 m", 15]]);
  });

  it("pointes : semaine ISO, étalement sur la plage, capacité des personnes", () => {
    const oct = r.weeks.filter((w) => w.monday.startsWith("2026-10"));
    expect(oct.reduce((s, w) => s + w.hours, 0)).toBeCloseTo(15, 0); // semaines arrondies au dixième
    expect(oct.map((w) => w.week)).toEqual(["2026-W41", "2026-W42", "2026-W43"]);
    expect(r.weeks.every((w) => w.capacity === 40)).toBe(true);
    expect(isoWeek("2027-01-01")).toEqual({ week: "2026-W53", monday: "2026-12-28" });
    expect(isoWeek("2026-10-15")).toEqual({ week: "2026-W42", monday: "2026-10-12" });
  });
});
