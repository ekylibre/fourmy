import { describe, it, expect } from "vitest";
import type { CropPlanDraft } from "@fourmy/contracts";
import {
  abPlanFindings,
  agronomyFindings,
  checkCropPlan,
  cropPlanCheckInput,
  defaultEffectiveOn,
  operationBlockers,
  emptyDraft,
  hvePlanFindings,
  resolveParcels,
  type AgronomyParcel,
  type CropPlanActivity,
  type CropPlanBaseParcel,
  type CropPlanCertificationContext,
  type ParcelYearCrop,
} from "../src/index.js";

const HA = 10_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const y = (main: string | null, extra: Partial<ParcelYearCrop> = {}): ParcelYearCrop => ({ main, secondary: false, ...extra });
const parcel = (name: string, main: string | null, years: Record<number, ParcelYearCrop>): AgronomyParcel => ({
  key: `p:${name}`,
  name,
  main,
  history: [{ parcelId: name, share: 1, years }],
});

describe("Agronomie : délais de retour", () => {
  it("colza deux ans après un colza : retour en 2 ans, 4 conseillés", () => {
    const fs = agronomyFindings([parcel("Le Champ", "CZH", { 2025: y("CZH"), 2026: y("BTH") })], 2027);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ ruleId: "agro.return.cruciferes", level: "warning", value: 2, threshold: 4, refs: { parcelIds: ["p:Le Champ"] } });
    expect(fs[0]!.message).toBe("Le Champ : crucifères (colza, moutarde, cameline) en 2027, déjà en 2025 : retour en 2 ans, 4 conseillés.");
    expect(fs[0]!.source).toContain("repère à relire");
  });

  it("le groupe compte : moutarde puis colza", () => {
    expect(agronomyFindings([parcel("A", "CZH", { 2026: y("MOT") })], 2027)[0]!.value).toBe(1);
  });

  it("blé sur blé : signalé ; blé un an sur deux : rien", () => {
    expect(agronomyFindings([parcel("A", "BTH", { 2026: y("BTP") })], 2027)).toHaveLength(1);
    expect(agronomyFindings([parcel("A", "BTH", { 2025: y("BTH"), 2026: y("CZH") })], 2027)).toEqual([]);
  });

  it("délai propre à la ferme ; culture sans repère ; année inconnue : rien", () => {
    const p = parcel("A", "CZH", { 2024: y("CZH") });
    expect(agronomyFindings([p], 2027)).toHaveLength(1);
    expect(agronomyFindings([p], 2027, { cruciferes: 3 })).toEqual([]);
    expect(agronomyFindings([parcel("B", "MIS", { 2026: y("MIS") })], 2027)).toEqual([]);
    expect(agronomyFindings([parcel("C", "CZH", {})], 2027)).toEqual([]);
  });

  it("parcelle fusionnée : le retour le plus proche de ses origines", () => {
    const merged: AgronomyParcel = {
      key: "n:m",
      name: "Fusion",
      main: "LIP",
      history: [
        { parcelId: "x", share: 0.7, years: { 2022: y("LIF") } },
        { parcelId: "z", share: 0.3, years: { 2024: y("LIH") } },
      ],
    };
    expect(agronomyFindings([merged], 2027)[0]!.value).toBe(3);
  });

  it("précédent à éviter : féverole après luzerne", () => {
    const fs = agronomyFindings([parcel("A", "FVP", { 2026: y("LUZ") })], 2027);
    expect(fs.map((f) => f.ruleId)).toEqual(["agro.succession.feverole-apres-legumineuse"]);
    expect(fs[0]!.message).toContain("précédent LUZ en 2026");
  });
});

const base: CropPlanBaseParcel[] = [
  { id: "a", name: "Le Champ", areaM2: 12 * HA },
  { id: "b", name: "La Côte", areaM2: 8 * HA },
  { id: "c", name: "Le Bas", areaM2: 5 * HA },
];
const activities = new Map<string, CropPlanActivity>([
  [uuid(1), { id: uuid(1), name: "Blé tendre", family: "Céréales", capCode: "BTH", species: "triticum_aestivum", cycle: "annual" }],
  [uuid(2), { id: uuid(2), name: "Féverole", family: "Protéagineux", capCode: "FVP", species: "vicia_faba", cycle: "annual", legume: true }],
  [uuid(3), { id: uuid(3), name: "Maïs", family: "Céréales", capCode: "MIS", species: "zea_mays", cycle: "annual" }],
  [uuid(4), { id: uuid(4), name: "Prairie permanente", family: "Fourrages", capCode: "PPH", species: "poaceae", cycle: "perennial" }],
]);
const assign = (key: string, activity: number, extra: Partial<CropPlanDraft["assignments"][number]> = {}): CropPlanDraft["assignments"][number] => ({
  id: `${key}-${activity}`,
  key: key as `p:${string}`,
  role: "main",
  activityId: uuid(activity),
  startedOn: null,
  stoppedOn: null,
  ...extra,
});
const noCert: CropPlanCertificationContext = { abParcels: new Map(), hve: false, abRotation: { years: 5, sameSpeciesMax: 2 } };

describe("Certifications sur l'assolement prévu", () => {
  const history = new Map<string, Record<number, ParcelYearCrop>>([
    ["a", {
      2022: y("MIS", { species: "zea_mays", label: "Maïs" }),
      2023: y("BTH", { species: "triticum_aestivum", label: "Blé" }),
      2024: y("FVP", { species: "vicia_faba", label: "Féverole", legume: true }),
      2025: y("BTH", { species: "triticum_aestivum", label: "Blé" }),
      2026: y("MIS", { species: "zea_mays", label: "Maïs" }),
    }],
  ]);

  it("AB : statut prévu de la récolte, rotation avec la culture prévue, mixité", () => {
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      assignments: [assign("p:a", 1, { startedOn: "2026-10-20", stoppedOn: "2027-07-15" }), assign("p:b", 1), assign("p:c", 3)],
    };
    const context: CropPlanCertificationContext = { ...noCert, abParcels: new Map([["a", { conversionStart: "2024-06-01" }]]) };
    const fs = abPlanFindings({ plan: resolveParcels(base, draft), draft, activities, history, context });
    const status = fs.find((f) => f.ruleId === "ab.plan.harvest-status")!;
    expect(status.message).toBe("Le Champ : récolte 2027 de blé tendre prévue en AB (Agriculture biologique).");
    expect(fs.find((f) => f.ruleId === "ab.R11")).toMatchObject({ level: "ok", refs: { parcelIds: ["p:a"] } });
    const mix = fs.find((f) => f.ruleId === "ab.R7")!;
    expect(mix.level).toBe("warning");
    expect(mix.refs.parcelIds).toEqual(["p:a", "p:b"]);
  });

  it("AB : semis moins de 24 mois après le début de la conversion : C2", () => {
    const draft: CropPlanDraft = { ...emptyDraft(2027), assignments: [assign("p:a", 1, { startedOn: "2026-10-20", stoppedOn: "2027-07-15" })] };
    const context: CropPlanCertificationContext = { ...noCert, abParcels: new Map([["a", { conversionStart: "2025-06-01" }]]) };
    expect(abPlanFindings({ plan: resolveParcels(base, draft), draft, activities, history, context })[0]!.message).toContain("prévue en C2");
  });

  it("AB : fusion de surfaces AB et non AB signalée", () => {
    const square = { type: "Polygon", coordinates: [] };
    const draft: CropPlanDraft = {
      ...emptyDraft(2027),
      operations: [{ kind: "merge", sources: ["p:a", "p:b"], result: { key: "n:ab", name: "Grande pièce", shape: square, areaM2: 20 * HA }, effectiveOn: "2026-08-01" }],
      assignments: [assign("n:ab", 1)],
    };
    const context: CropPlanCertificationContext = { ...noCert, abParcels: new Map([["a", { conversionStart: "2020-01-01" }]]) };
    const fs = abPlanFindings({ plan: resolveParcels(base, draft), draft, activities, history, context });
    expect(fs.map((f) => [f.ruleId, f.level])).toEqual([["ab.plan.mixed-parcel", "danger"]]);
  });

  it("HVE : projection des points 4.2 à 4.4 sur les surfaces prévues", () => {
    const draft: CropPlanDraft = { ...emptyDraft(2027), assignments: [assign("p:a", 1), assign("p:b", 2), assign("p:c", 4)] };
    const fs = hvePlanFindings({ plan: resolveParcels(base, draft), draft, activities, history, context: { ...noCert, hve: true } });
    expect(fs.map((f) => f.ruleId)).toEqual(["hve.4.2", "hve.4.3", "hve.4.4"]);
    // Hors prairie permanente : blé 12 ha sur 20 ha = 60 %.
    expect(fs[1]!.message).toContain("Projection 2027 : Culture principale : Blé tendre, 60 %");
    expect(hvePlanFindings({ plan: resolveParcels(base, draft), draft, activities, history, context: noCert })).toEqual([]);
  });
});

describe("checkCropPlan", () => {
  it("sections PAC, Agronomie ; Certifications seulement si la ferme est certifiée", () => {
    const draft: CropPlanDraft = { ...emptyDraft(2027), assignments: [assign("p:a", 1), assign("p:b", 2), assign("p:c", 3)] };
    const r = checkCropPlan({ base, draft, activities, history: new Map(), settings: { bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} }, certification: noCert });
    expect(r.sections.map((s) => s.id)).toEqual(["pac", "agronomy"]);
    expect(r.sections[1]!.level).toBe("na");
    const hve = checkCropPlan({ base, draft, activities, history: new Map(), settings: { bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} }, certification: { ...noCert, hve: true } });
    expect(hve.sections.map((s) => s.id)).toEqual(["pac", "agronomy", "certification"]);
  });

  it("300 parcelles avec 5 ans d'historique : moins de 200 ms par geste", () => {
    const codes = ["BTH", "CZH", "ORH", "MIS", "TRN", "FVP", "PPR", "LIP"];
    const many: CropPlanBaseParcel[] = Array.from({ length: 300 }, (_, i) => ({ id: `x${i}`, name: `P${i}`, areaM2: (2 + (i % 7)) * HA }));
    const acts = new Map<string, CropPlanActivity>(codes.map((c, i) => [uuid(i + 10), { id: uuid(i + 10), name: c, family: "F", capCode: c, species: c.toLowerCase() }]));
    const hist = new Map(many.map((p, i) => [p.id, Object.fromEntries([2022, 2023, 2024, 2025, 2026].map((yr, k) => [yr, y(codes[(i + k) % codes.length]!)]))]));
    const draft: CropPlanDraft = { ...emptyDraft(2027), assignments: many.map((p, i) => assign(`p:${p.id}`, 10 + ((i * 3) % codes.length))) };
    const abParcels = new Map(many.slice(0, 100).map((p) => [p.id, { conversionStart: "2020-01-01" }]));
    const input = { base: many, draft, activities: acts, history: hist, settings: { bcae7Preferred: "rotation" as const, alsaceRhinePlain: false, returnIntervals: {} }, certification: { abParcels, hve: true, abRotation: { years: 5, sameSpeciesMax: 2 } } };
    checkCropPlan(input); // échauffement
    const t0 = performance.now();
    const r = checkCropPlan(input);
    const ms = performance.now() - t0;
    expect(r.plan.parcels).toHaveLength(300);
    expect(ms).toBeLessThan(200);
  });
});

describe("cropPlanCheckInput", () => {
  it("contexte JSON de l'API → entrée des contrôles (années numériques, tables)", () => {
    const input = cropPlanCheckInput(
      {
        year: 2027,
        parcels: [{ id: "a", name: "Le Champ", areaM2: 12 * HA, shape: null, validFrom: "2020-01-01", lastStoppedOn: null }],
        activities: [{ id: uuid(1), name: "Blé tendre", family: "plant_farming", color: null, capCode: "BTH", species: "triticum_aestivum", cycle: "annual", legume: false, vegetable: false }],
        history: { a: { "2026": { main: "CZH", secondary: false } } },
        previousByActivity: {},
        certification: { abParcels: { a: { conversionStart: "2020-01-01" } }, hve: false, abRotation: { years: 5, sameSpeciesMax: 2 } },
        settings: { bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} },
        refsVersion: "x",
      },
      emptyDraft(2027),
    );
    expect(input.base).toEqual([{ id: "a", name: "Le Champ", areaM2: 12 * HA }]);
    expect(input.history.get("a")![2026]).toEqual({ main: "CZH", secondary: false });
    expect(input.activities.get(uuid(1))!.capCode).toBe("BTH");
    expect(input.certification.abParcels.get("a")).toEqual({ conversionStart: "2020-01-01" });
  });
});

describe("découpes et fusions : date d'effet", () => {
  const ctx = {
    year: 2027,
    parcels: [
      { id: "a", name: "Le Champ", areaM2: 12 * HA, shape: null, validFrom: "2020-01-01", lastStoppedOn: "2026-07-15" },
      { id: "b", name: "La Côte", areaM2: 8 * HA, shape: null, validFrom: "2026-03-01", lastStoppedOn: null },
    ],
  };
  const square = { type: "Polygon", coordinates: [] };
  const split = (source: string, effectiveOn: string): CropPlanDraft["operations"][number] => ({
    kind: "split",
    source: source as `p:${string}`,
    effectiveOn,
    pieces: [
      { key: "n:x1", name: "Ouest", shape: square, areaM2: 6 * HA },
      { key: "n:x2", name: "Est", shape: square, areaM2: 6 * HA },
    ],
  });

  it("proposée : lendemain de la dernière récolte, sinon 1er janvier de la campagne", () => {
    expect(defaultEffectiveOn(ctx, ["a"])).toBe("2026-07-16");
    expect(defaultEffectiveOn(ctx, ["b"])).toBe("2027-01-01");
    expect(defaultEffectiveOn(ctx, ["a", "b"])).toBe("2026-07-16");
    // Récolte trop ancienne (avant la campagne précédente) : 1er janvier.
    expect(defaultEffectiveOn({ ...ctx, parcels: [{ ...ctx.parcels[0]!, lastStoppedOn: "2024-07-15" }] }, ["a"])).toBe("2027-01-01");
  });

  it("bloquants : avant la fin de la culture en place, hors campagne, culture d'un morceau qui commence avant", () => {
    const base = [{ id: "a", name: "Le Champ", areaM2: 12 * HA }];
    const check = (draft: CropPlanDraft) => operationBlockers(draft, resolveParcels(base, draft), ctx).map((b) => b.message);
    expect(check({ ...emptyDraft(2027), operations: [split("p:a", "2026-08-01")] })).toEqual([]);
    expect(check({ ...emptyDraft(2027), operations: [split("p:a", "2026-07-10")] })[0]).toContain("en place jusqu'au 2026-07-15");
    expect(check({ ...emptyDraft(2027), operations: [split("p:a", "2025-12-01")] }).join(" ")).toContain("hors de la campagne");
    const early = { ...emptyDraft(2027), operations: [split("p:a", "2026-09-01")], assignments: [assign("n:x1", 1, { startedOn: "2026-08-25" })] };
    expect(check(early)[0]).toContain("Ouest : culture prévue à partir du 2026-08-25, avant la date d'effet (2026-09-01)");
  });
});
