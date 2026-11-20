import { describe, it, expect } from "vitest";
import type { CropPlanDraft } from "@fourmy/contracts";
import {
  bcae7Class,
  bcae7Criteria,
  bcae7Findings,
  bcae7Parcels,
  diffCropPlan,
  emptyDraft,
  resolveParcels,
  summarizeCropPlan,
  type Bcae7Farm,
  type Bcae7Parcel,
  type CropPlanActivity,
  type CropPlanBaseParcel,
  type ExistingProduction,
  type ParcelYearCrop,
} from "../src/index.js";

const HA = 10_000;
const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const base: CropPlanBaseParcel[] = [
  { id: "a", name: "Le Champ", areaM2: 12 * HA },
  { id: "b", name: "La Côte", areaM2: 8 * HA },
  { id: "c", name: "Le Bas", areaM2: 5 * HA },
];

const split = (source: string, pieces: [string, number][], effectiveOn = "2026-08-01"): CropPlanDraft["operations"][number] => ({
  kind: "split",
  source: source as `p:${string}`,
  pieces: pieces.map(([key, ha]) => ({ key: key as `n:${string}`, name: key.slice(2), shape: square, areaM2: ha * HA })),
  effectiveOn,
});

describe("resolveParcels", () => {
  it("rejoue découpes et fusions, origines au prorata des surfaces", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      operations: [
        split("p:a", [["n:a1", 7], ["n:a2", 5]]),
        { kind: "merge", sources: ["n:a2", "p:c"], result: { key: "n:ac", name: "Le Bas agrandi", shape: square, areaM2: 10 * HA }, effectiveOn: "2026-08-01" },
      ],
    };
    const r = resolveParcels(base, draft);
    expect(r.issues).toEqual([]);
    expect(r.parcels.map((p) => p.key).sort()).toEqual(["n:a1", "n:ac", "p:b"]);
    expect(r.byKey.get("n:a1")!.origins).toEqual([{ parcelId: "a", share: 1 }]);
    const ac = r.byKey.get("n:ac")!;
    expect(ac.existing).toBe(false);
    expect(ac.origins).toEqual([
      { parcelId: "a", share: 0.5 },
      { parcelId: "c", share: 0.5 },
    ]);
  });

  it("signale une source inconnue, une clé réemployée, des surfaces qui ne collent pas", () => {
    const r = resolveParcels(base, {
      ...emptyDraft(2027),
      operations: [split("p:zz", [["n:x", 1], ["n:y", 1]]), split("p:b", [["n:b1", 3], ["n:b2", 3]]), split("p:c", [["n:b1", 2], ["n:c2", 3]])],
    });
    expect(r.issues.map((i) => i.operation)).toEqual([0, 1, 2]);
    expect(r.issues[1]!.message).toContain("Surface");
    expect(r.byKey.has("p:c")).toBe(true); // opération refusée : rien ne change
  });
});

const activities = new Map<string, CropPlanActivity>([
  [uuid(1), { id: uuid(1), name: "Blé tendre", family: "Céréales", capCode: "BTH" }],
  [uuid(2), { id: uuid(2), name: "Colza", family: "Oléagineux", capCode: "CZH" }],
  [uuid(3), { id: uuid(3), name: "Maïs", family: "Céréales", capCode: "MIS" }],
  [uuid(4), { id: uuid(4), name: "Sarrasin dérobé", family: "Céréales", capCode: "SRS" }],
]);

const assign = (id: string, key: string, activity: number, extra: Partial<CropPlanDraft["assignments"][number]> = {}): CropPlanDraft["assignments"][number] => ({
  id,
  key: key as `p:${string}`,
  role: "main",
  activityId: uuid(activity),
  startedOn: null,
  stoppedOn: null,
  ...extra,
});

describe("summarizeCropPlan", () => {
  it("surfaces par activité et famille, écart avec l'an passé, parcelles non affectées", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      assignments: [assign("1", "p:a", 1), assign("2", "p:b", 2), assign("3", "p:a", 4, { role: "secondary" })],
    };
    const r = resolveParcels(base, draft);
    const s = summarizeCropPlan(r.parcels, draft, activities, new Map([[uuid(1), 20 * HA], [uuid(3), 5 * HA]]));
    expect(s.totalM2).toBe(25 * HA);
    expect(s.assignedM2).toBe(20 * HA);
    expect(s.unassigned).toEqual({ keys: ["p:c"], areaM2: 5 * HA });
    expect(s.byActivity.map((l) => [l.name, l.areaM2 / HA, l.previousM2 / HA])).toEqual([
      ["Blé tendre", 12, 20],
      ["Colza", 8, 0],
      ["Maïs", 0, 5],
    ]);
    expect(s.byFamily[0]).toMatchObject({ family: "Céréales", areaM2: 12 * HA, previousM2: 25 * HA });
    expect(s.secondary).toEqual([{ activityId: uuid(4), name: "Sarrasin dérobé", areaM2: 12 * HA }]);
  });

  it("« sans culture » compte à part et sort des non affectées", () => {
    const draft: CropPlanDraft = { ...emptyDraft(2027), assignments: [assign("1", "p:a", 1), assign("2", "p:b", 1)], fallow: [{ key: "p:c", capCode: "JAC" }] };
    const s = summarizeCropPlan(resolveParcels(base, draft).parcels, draft, activities);
    expect(s.fallowM2).toBe(5 * HA);
    expect(s.unassigned.keys).toEqual([]);
  });
});

describe("diffCropPlan", () => {
  const existing: ExistingProduction[] = [
    { id: uuid(101), landParcelId: "a", activityId: uuid(1), role: "main", startedOn: null, stoppedOn: null, hasDoneInterventions: false },
    { id: uuid(102), landParcelId: "b", activityId: uuid(1), role: "main", startedOn: null, stoppedOn: null, hasDoneInterventions: true },
    { id: uuid(103), landParcelId: "c", activityId: uuid(3), role: "main", startedOn: null, stoppedOn: null, hasDoneInterventions: false },
  ];

  it("crée, modifie, supprime ; campagne créée au besoin", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      assignments: [
        assign("1", "p:a", 1, { productionId: uuid(101) }),
        assign("2", "p:b", 2, { productionId: uuid(102), startedOn: "2026-08-25" }),
        assign("3", "p:c", 2),
      ],
    };
    const d = diffCropPlan(draft, resolveParcels(base, draft), existing, { campaignExists: false });
    expect(d.blockers).toEqual([]);
    expect(d.changes.map((c) => c.kind)).toEqual(["campaign.create", "production.update", "production.create", "production.delete"]);
    const upd = d.changes.find((c) => c.kind === "production.update")!;
    expect(upd).toMatchObject({ productionId: uuid(102), before: { activityId: uuid(1) }, after: { activityId: uuid(2), startedOn: "2026-08-25" } });
    expect(d.changes.find((c) => c.kind === "production.delete")).toMatchObject({ productionId: uuid(103), key: "p:c" });
  });

  it("bloque : parcelle sans culture, production réalisée retirée, parcelle découpée encore affectée", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      operations: [split("p:a", [["n:a1", 6], ["n:a2", 6]])],
      assignments: [assign("1", "p:a", 1, { productionId: uuid(101) }), assign("2", "n:a1", 2)],
    };
    const d = diffCropPlan(draft, resolveParcels(base, draft), existing, { campaignExists: true });
    expect(d.blockers.map((b) => b.code).sort()).toEqual(["done-interventions", "unassigned", "unknown-parcel"]);
    expect(d.blockers.find((b) => b.code === "unassigned")!.keys.sort()).toEqual(["n:a2", "p:b", "p:c"]);
    expect(d.blockers.find((b) => b.code === "done-interventions")!.keys).toEqual(["p:b"]);
    expect(d.changes.filter((c) => c.kind === "parcel.split")).toHaveLength(1);
    // La production de la parcelle découpée, non reprise, est supprimée (sans intervention réalisée).
    expect(d.changes.some((c) => c.kind === "production.delete" && c.productionId === uuid(101))).toBe(true);
  });

  it("une production reprise sur un morceau devient une nouvelle production", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      operations: [split("p:c", [["n:c1", 2], ["n:c2", 3]])],
      assignments: [assign("1", "n:c1", 3, { productionId: uuid(103) }), assign("2", "n:c2", 1), assign("3", "p:a", 1), assign("4", "p:b", 1, { productionId: uuid(102) })],
    };
    const d = diffCropPlan(draft, resolveParcels(base, draft), existing, { campaignExists: true });
    expect(d.blockers).toEqual([]);
    expect(d.changes.filter((c) => c.kind === "production.create")).toHaveLength(3);
  });
});

// --- BCAE 7 -------------------------------------------------------------

const farm: Bcae7Farm = { year: 2026, allOrganic: false, alsaceRhinePlain: false };
const y = (main: string | null, secondary = false): ParcelYearCrop => ({ main, secondary });
const parcel = (name: string, ha: number, main: string | null, years: Record<number, ParcelYearCrop>, secondary: (string | null)[] = []): Bcae7Parcel => ({
  key: `p:${name}`,
  name,
  areaM2: ha * HA,
  main,
  secondary,
  history: [{ parcelId: name, share: 1, years }],
});
const rule = (fs: ReturnType<typeof bcae7Findings>, id: string) => fs.find((f) => f.ruleId === id)!;
/** Historique varié sur 2023-2025 : le critère pluriannuel ne gêne pas. */
const varied = (y2025: string): Record<number, ParcelYearCrop> => ({ 2023: y("TRN"), 2024: y("ORH"), 2025: y(y2025) });

describe("BCAE 7 : classes de codes", () => {
  it("cultivées, exclues de la rotation annuelle, non arables, inconnues", () => {
    expect(bcae7Class("BTH")).toBe("cultivated");
    expect(bcae7Class("PTR")).toBe("arable-excluded");
    expect(bcae7Class("LUZ")).toBe("arable-excluded");
    expect(bcae7Class("GRA")).toBe("arable-excluded");
    expect(bcae7Class("SNE")).toBe("not-exploited");
    expect(bcae7Class("VRC")).toBe("non-arable");
    expect(bcae7Class("ZZZ")).toBe("unknown");
    expect(bcae7Class(null)).toBe("unknown");
  });
});

describe("BCAE 7 : critère annuel (exemple de la fiche, ferme de 125 ha)", () => {
  // 25 ha de prairie temporaire et jachère hors terres arables cultivées ; 100 ha cultivés ;
  // 22 ha seulement changent de culture (blé d'hiver → de printemps, féverole → blé) ;
  // féverole d'hiver puis de printemps : même culture.
  const parcels = (maizeSecondary: (string | null)[] = []) => [
    parcel("PT", 20, "PTR", { 2023: y("PTR"), 2024: y("PTR"), 2025: y("PTR") }),
    parcel("Jachère", 5, "JAC", { 2023: y("JAC"), 2024: y("JAC"), 2025: y("JAC") }),
    parcel("Féverole", 30, "FVP", varied("FVL")),
    parcel("Blé printemps", 12, "BTP", varied("BTH")),
    parcel("Blé", 10, "BTH", varied("FVP")),
    parcel("Maïs", 28, "MIS", varied("MIS"), maizeSecondary),
    parcel("Blé sur blé", 20, "BTH", varied("BTH")),
  ];

  it("22 % : non respecté, il manque 13 ha", () => {
    const f = bcae7Criteria(parcels(), farm).annual;
    expect(f.level).toBe("danger");
    expect(f.value).toBe(22);
    expect(f.message).toContain("13,00 ha");
    expect(f.refs.parcelIds).toEqual(["p:Féverole", "p:Maïs", "p:Blé sur blé"]);
  });

  it("une culture secondaire derrière le maïs suffit (50 %)", () => {
    expect(bcae7Criteria(parcels([null]), farm).annual).toMatchObject({ level: "ok", value: 50 });
  });

  it("la ferme respecte la diversification : la rotation annuelle n'est pas retenue", () => {
    const fs = bcae7Findings(parcels(), farm);
    expect(fs[0]!.message).toBe("BCAE 7 respectée par la diversification.");
    expect(rule(fs, "pac.bcae7.annual").level).toBe("na");
  });

  it("une culture secondaire de la même catégorie ne compte pas", () => {
    expect(bcae7Criteria(parcels(["MID"]), farm).annual.level).toBe("danger");
  });

  it("écart faible (≤ 2 ha) : alerte sans réduction", () => {
    const ps = [parcel("A", 34, "BTH", varied("ORH")), parcel("B", 66, "BTH", varied("BTH")), parcel("C", 1.5, "MIS", varied("MIS"))];
    // 34 / 101,5 = 33,5 % ; écart 1,5 ha
    expect(rule(bcae7Findings(ps, farm), "pac.bcae7.annual").level).toBe("warning");
  });

  it("culture de l'an passé inconnue : données manquantes, pas de faux vert", () => {
    const ps = [parcel("A", 30, "BTH", varied("ORH")), parcel("B", 70, "BTH", { 2023: y("TRN"), 2024: y("ORH") })];
    const f = rule(bcae7Findings(ps, farm), "pac.bcae7.annual");
    expect(f.level).toBe("missing");
    expect(f.missing![0]!.what).toContain("2025");
  });
});

describe("BCAE 7 : critère pluriannuel", () => {
  it("monoculture de maïs 2023-2026 : non respectée ; avec une culture secondaire chaque année : respectée", () => {
    const mono = { 2023: y("MIS"), 2024: y("MIS"), 2025: y("MIS") };
    const others = [parcel("Colza", 60, "CZH", varied("BTH"))];
    expect(rule(bcae7Findings([parcel("Maïs", 15, "MIS", mono), ...others], farm), "pac.bcae7.multiannual")).toMatchObject({
      level: "danger",
      refs: { parcelIds: ["p:Maïs"] },
    });
    const withCovers = { 2023: y("MIS", true), 2024: y("MIS", true), 2025: y("MIS", true) };
    expect(rule(bcae7Findings([parcel("Maïs", 15, "MIS", withCovers, [null]), ...others], farm), "pac.bcae7.multiannual").level).toBe("ok");
  });

  it("cas 2 de la fiche : blé, prairie temporaire, blé, blé : respecté", () => {
    const ps = [parcel("P", 20, "BTH", { 2023: y("BTH"), 2024: y("PTR"), 2025: y("BTH") }), parcel("Q", 60, "CZH", varied("BTH"))];
    expect(rule(bcae7Findings(ps, farm), "pac.bcae7.multiannual").level).toBe("ok");
  });

  it("année non exploitée (SNE) : respecté par défaut ; année inconnue : données manquantes", () => {
    const sne = [parcel("P", 20, "MIS", { 2023: y("MIS"), 2024: y("SNE"), 2025: y("MIS") }), parcel("Q", 60, "CZH", varied("BTH"))];
    expect(rule(bcae7Findings(sne, farm), "pac.bcae7.multiannual").level).toBe("ok");
    const gap = [parcel("P", 20, "MIS", { 2024: y("MIS"), 2025: y("MIS") }), parcel("Q", 60, "CZH", varied("BTH"))];
    expect(rule(bcae7Findings(gap, farm), "pac.bcae7.multiannual").level).toBe("missing");
  });

  it("parcelle fusionnée : chaque origine vérifiée, la part en monoculture compte", () => {
    const merged: Bcae7Parcel = {
      key: "n:m",
      name: "Fusion",
      areaM2: 20 * HA,
      main: "MIS",
      secondary: [],
      history: [
        { parcelId: "x", share: 0.5, years: { 2023: y("MIS"), 2024: y("MIS"), 2025: y("MIS") } },
        { parcelId: "z", share: 0.5, years: varied("BTH") },
      ],
    };
    const f = rule(bcae7Findings([merged, parcel("Q", 60, "CZH", varied("BTH"))], farm), "pac.bcae7.multiannual");
    expect(f.value).toBe(10);
  });
});

describe("BCAE 7 : diversification et verdict", () => {
  it("plus de 30 ha : trois cultures, principale ≤ 75 %, deux principales ≤ 95 %", () => {
    const ok = [parcel("A", 60, "BTH", varied("BTH")), parcel("B", 30, "CZH", varied("CZH")), parcel("C", 10, "ORP", varied("ORP"))];
    expect(rule(bcae7Findings(ok, farm), "pac.bcae7.diversification").level).toBe("ok");
    const two = [parcel("A", 60, "BTH", varied("BTH")), parcel("B", 40, "CZH", varied("CZH"))];
    expect(rule(bcae7Findings(two, farm), "pac.bcae7.diversification").level).toBe("danger");
    // 70 + 27 = 97 % : dépassement de 2 ha → alerte.
    const tight = [parcel("A", 70, "BTH", varied("BTH")), parcel("B", 27, "CZH", varied("CZH")), parcel("C", 3, "ORP", varied("ORP"))];
    expect(rule(bcae7Findings(tight, farm), "pac.bcae7.diversification").level).toBe("warning");
  });

  it("fruits et légumes : chaque code est une culture", () => {
    const ps = [parcel("A", 20, "POT", varied("POT")), parcel("B", 5, "CAR", varied("CAR"))];
    expect(rule(bcae7Findings(ps, farm), "pac.bcae7.diversification").message).toContain("2 culture(s)");
  });

  it("rotation en échec, diversification respectée : BCAE 7 respectée par la diversification", () => {
    const ps = [parcel("A", 60, "BTH", varied("BTH")), parcel("B", 30, "CZH", varied("CZH")), parcel("C", 10, "ORP", varied("ORP"))];
    const fs = bcae7Findings(ps, farm);
    expect(fs[0]).toMatchObject({ ruleId: "pac.bcae7", level: "ok", message: "BCAE 7 respectée par la diversification." });
    expect(rule(fs, "pac.bcae7.annual").level).toBe("na");
    expect(rule(fs, "pac.bcae7.annual").message).toContain("Critère non retenu");
  });

  it("aucun critère respecté : non conforme ; sous 30 ha de SAU, alerte seulement", () => {
    const big = [parcel("A", 80, "BTH", varied("BTH")), parcel("B", 20, "BTH", varied("BTH"))];
    expect(bcae7Findings(big, farm)[0]!.level).toBe("danger");
    const small = [parcel("A", 20, "BTH", { 2023: y("BTH"), 2024: y("BTH"), 2025: y("BTH") }), parcel("B", 5, "BTH", varied("BTH"))];
    const f = bcae7Findings(small, farm)[0]!;
    expect(f.level).toBe("warning");
    expect(f.message).toContain("pas de contrôle sous 30 ha");
  });

  it("exemptions : ferme AB, 10 ha de terres arables, herbe dominante, prairies permanentes", () => {
    const ps = [parcel("A", 80, "BTH", varied("BTH")), parcel("B", 20, "BTH", varied("BTH"))];
    expect(bcae7Findings(ps, { ...farm, allOrganic: true })).toHaveLength(1);
    expect(bcae7Findings([parcel("A", 9, "BTH", varied("BTH")), parcel("V", 40, "VRC", {})], farm)[0]).toMatchObject({ level: "na" });
    const grass = [parcel("A", 80, "PTR", {}), parcel("B", 20, "BTH", varied("BTH"))];
    expect(bcae7Findings(grass, farm)[0]!.message).toContain("herbe, légumineuses ou jachère");
    const pp = [parcel("P", 80, "PPH", {}), parcel("B", 20, "BTH", varied("BTH"))];
    expect(bcae7Findings(pp, farm)[0]!.message).toContain("prairies permanentes");
  });

  it("ferme viticole avec des parcelles sans culture prévue : exemptée (10 ha de terres arables au plus)", () => {
    const ps = [parcel("V1", 2, "VRC", {}), parcel("V2", 1, null, {}), parcel("V3", 0.5, null, {})];
    const fs = bcae7Findings(ps, farm);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ level: "na" });
    expect(fs[0]!.message).toContain("1,50 ha au plus");
  });

  it("terres arables connues sous 10 ha mais codes manquants au-delà : données manquantes, pas de rouge", () => {
    const ps = [parcel("A", 6, "BTH", varied("ORH")), parcel("X", 8, null, {})];
    const fs = bcae7Findings(ps, farm);
    expect(fs[0]!.level).toBe("missing");
    expect(fs[0]!.message).toContain("1 parcelle(s) sans culture prévue ou sans code PAC (X)");
  });

  it("plaine du Rhin : diversification à points, à vérifier", () => {
    const ps = [parcel("A", 60, "BTH", varied("ORH")), parcel("B", 40, "CZH", varied("BTH"))];
    const fs = bcae7Findings(ps, { ...farm, alsaceRhinePlain: true });
    expect(fs.map((f) => f.ruleId)).toEqual(["pac.bcae7", "pac.bcae7.diversification"]);
    expect(fs[0]!.level).toBe("warning");
  });

  it("code PAC inconnu : signalé, pas d'exemption de surface conclue", () => {
    const ps = [parcel("A", 5, null, {}), parcel("B", 8, "BTH", varied("ORH"))];
    const fs = bcae7Findings(ps, farm);
    expect(fs[0]!.ruleId).toBe("pac.bcae7");
    expect(rule(fs, "pac.bcae7.diversification").missing![0]!.what).toContain("code PAC");
  });
});

describe("bcae7Parcels", () => {
  it("culture principale en place au 1er juin, « sans culture » en jachère, couverts dans les dates", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      assignments: [
        assign("1", "p:a", 2, { startedOn: "2026-08-25", stoppedOn: "2027-07-05" }),
        assign("2", "p:a", 4, { role: "secondary", startedOn: "2027-07-10", stoppedOn: "2027-10-01" }),
        assign("3", "p:b", 3, { startedOn: "2027-04-20", stoppedOn: "2027-10-15" }),
      ],
      fallow: [{ key: "p:c" }],
      covers: [
        { id: "c1", key: "p:b", species: ["moutarde"], kind: "sown", sownOn: "2027-10-20", destroyedOn: "2028-02-20" },
        { id: "c2", key: "p:a", species: ["phacélie"], kind: "sown", sownOn: "2027-11-30", destroyedOn: null },
      ],
    };
    const history = new Map([["a", { 2026: y("BTH") }]]);
    const ps = bcae7Parcels(resolveParcels(base, draft), draft, activities, history);
    const by = new Map(ps.map((p) => [p.key, p]));
    expect(by.get("p:a")).toMatchObject({ main: "CZH", secondary: ["SRS"] });
    expect(by.get("p:a")!.history[0]!.years[2026]).toEqual(y("BTH"));
    expect(by.get("p:b")).toMatchObject({ main: "MIS", secondary: [null] });
    expect(by.get("p:c")).toMatchObject({ main: "JAC", secondary: [] });
  });
});
