import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { draftInterventions, emptyBundle, parisDayBounds, readGeofolia, sig3, stableId, type BundleWorkUnit, type ImportBundle } from "../src/index.js";

const fixture = readGeofolia(new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "geofolia-pilote.zip"))), "x.zip");

/** Bundle minimal : une parcelle, des unités de travail données. */
function bundleOf(units: Partial<BundleWorkUnit>[]): ImportBundle {
  const b = emptyBundle("geofolia");
  b.parcels = ["P1", "P2"].map((key) => ({
    key,
    landKey: key,
    secondary: false,
    campaign: 2026,
    name: key,
    shape: null,
    areaM2: 10_000,
    islet: null,
    inseeCode: null,
    crop: { aeeCode: "ZAR", aeeComplement: null, aeeSowingPeriod: "ZFB", aeeUsage: "ZLD", capCode: null, label: "Blé", variety: null, sownOn: null, harvestedOn: null, destination: null },
    soil: null,
    yield: null,
    advice: null,
    spreadable: null,
    sourceIds: {},
  }));
  b.articles = [
    { key: "HERB", name: "Herbicide", nature: "phyto", amm: "2000000", gnis: null, unit: "liter", composition: null, species: null, purpose: "herbicide", sourceIds: {} },
    { key: "FUM", name: "Fumier", nature: "fertilizer", amm: null, gnis: null, unit: "ton", composition: null, species: null, organic: true, sourceIds: {} },
    { key: "BLE", name: "Blé", nature: "harvest", amm: null, gnis: null, unit: "quintal", composition: null, species: null, sourceIds: {} },
  ];
  b.workUnits = units.map((u, i) => ({
    guid: `G${i}`,
    groupKey: "A1",
    parcelKey: "P1",
    campaign: 2026,
    operation: { aeeCode: "SEX", label: "Traitement", category: null },
    status: "done",
    on: "2026-04-01",
    until: null,
    workedAreaM2: 10_000,
    inputs: [],
    outputs: [],
    waterL: null,
    weather: null,
    purpose: null,
    notes: null,
    doerKeys: [],
    modifiedBy: null,
    ...u,
  }));
  return b;
}

describe("regroupement des interventions", () => {
  it("une action, même dose sur deux parcelles : une intervention, motif tiré du produit", () => {
    const d = draftInterventions(
      bundleOf([
        { parcelKey: "P1", inputs: [{ articleKey: "HERB", total: 1.5, perHa: 1.5, unit: "liter" }] },
        { parcelKey: "P2", workedAreaM2: 20_000, inputs: [{ articleKey: "HERB", total: 3, perHa: 1.5, unit: "liter" }] },
      ]),
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ procedure: "spraying", purposes: ["herbicide"], guids: ["G0", "G1"], inputs: [{ articleKey: "HERB", perHa: 1.5 }] });
    expect(d[0]!.targets.map((t) => t.parcelKey)).toEqual(["P1", "P2"]);
  });

  it("doses différentes : scission, aucune dose inventée", () => {
    const d = draftInterventions(
      bundleOf([
        { parcelKey: "P1", inputs: [{ articleKey: "HERB", total: 1.5, perHa: 1.5, unit: "liter" }] },
        { parcelKey: "P2", inputs: [{ articleKey: "HERB", total: 2, perHa: 2, unit: "liter" }] },
      ]),
    );
    expect(d.map((x) => x.inputs[0]!.perHa).sort()).toEqual([1.5, 2]);
  });

  it("récolte : une intervention par parcelle ; grains d'après l'usage de la culture", () => {
    const d = draftInterventions(
      bundleOf([
        { parcelKey: "P1", operation: { aeeCode: "SER", label: "Récolte", category: null }, outputs: [{ articleKey: "BLE", total: 70, perHa: 70, unit: "quintal" }] },
        { parcelKey: "P2", operation: { aeeCode: "SER", label: "Récolte", category: null }, outputs: [{ articleKey: "BLE", total: 65, perHa: 65, unit: "quintal" }] },
      ]),
    );
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.procedure === "grains_harvest" && x.outputs.length === 1)).toBe(true);
  });

  it("fertilisation avec un effluent : épandage organique", () => {
    const [d] = draftInterventions(bundleOf([{ operation: { aeeCode: "SEM", label: "Fertilisation", category: null }, inputs: [{ articleKey: "FUM", total: 20, perHa: 20, unit: "ton" }] }]));
    expect(d!.procedure).toBe("organic_fertilizing");
    expect(d!.purposes).toEqual([]);
  });

  it("irrigation : dose en mm, refusée au-delà de 100 mm", () => {
    const d = draftInterventions(
      bundleOf([
        { parcelKey: "P1", operation: { aeeCode: "SEO", label: "Irrigation", category: null }, waterL: 300_000 },
        { parcelKey: "P2", groupKey: "A2", operation: { aeeCode: "SEO", label: "Irrigation", category: null }, waterL: 1_500_000 },
      ]),
    );
    expect(d.find((x) => x.targets[0]!.parcelKey === "P1")).toMatchObject({ procedure: "plant_watering", depthMm: 30 });
    expect(d.find((x) => x.targets[0]!.parcelKey === "P2")!.skip).toMatch(/150 mm/);
  });

  it("procédure de repli : opération d'origine en note ; couples déjà importés laissés de côté", () => {
    const b = bundleOf([{ operation: { aeeCode: "ZTC", label: "Autre type de travail", category: null } }, { guid: "X", groupKey: "A9" }]);
    const d = draftInterventions(b, new Set(["X"]));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ procedure: "technical_task", notes: "Autre type de travail (ZTC)" });
  });

  it("jeu anonymisé : chaque couple dans une seule intervention, récoltes séparées", () => {
    const d = draftInterventions(fixture);
    const guids = d.flatMap((x) => x.guids);
    expect(new Set(guids).size).toBe(guids.length);
    expect(guids).toHaveLength(fixture.workUnits.length);
    const harvests = d.filter((x) => ["harvesting", "grains_harvest"].includes(x.procedure));
    expect(harvests).toHaveLength(30);
    expect(harvests.every((h) => h.targets.length === 1)).toBe(true);
    expect(d.filter((x) => x.skip)).toEqual([]);
    expect(d.some((x) => x.sowing === "direct")).toBe(true);
  });
});

describe("outils", () => {
  it("bornes d'un jour à Paris, été comme hiver", () => {
    expect(parisDayBounds("2026-04-01")).toEqual({ startedAt: "2026-03-31T22:00:00.000Z", stoppedAt: "2026-04-01T22:00:00.000Z" });
    expect(parisDayBounds("2026-01-15", "2026-01-16")).toEqual({ startedAt: "2026-01-14T23:00:00.000Z", stoppedAt: "2026-01-16T23:00:00.000Z" });
    // Passage à l'heure d'été (29/03/2026) : la journée fait 23 h.
    expect(parisDayBounds("2026-03-29")).toEqual({ startedAt: "2026-03-28T23:00:00.000Z", stoppedAt: "2026-03-29T22:00:00.000Z" });
  });

  it("identifiant stable et arrondi des doses", () => {
    expect(stableId("f", "agri.crop_zone", "G")).toBe(stableId("f", "agri.crop_zone", "G"));
    expect(stableId("f", "agri.crop_zone", "G")).not.toBe(stableId("g", "agri.crop_zone", "G"));
    expect(stableId("f", "a.b", "k")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sig3(1.79313012)).toBe(1.79);
    expect(sig3(0.000123456)).toBe(0.000123);
  });
});
