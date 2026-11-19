import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zip } from "@fourmy/isoxml";
import { analyzeFile, buildPreview, geofoliaNature, geofoliaUnit, geofoliaUsage, readGeofolia, ImportFileError } from "../src/index.js";

/**
 * Jeu anonymisé tiré d'un export Geofolia réel (scripts/anonymize-geofolia.mjs) :
 * 6 parcelles principales, 7 cultures secondaires, 197 actions.
 */
const fixture = new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "geofolia-pilote.zip")));
const bundle = readGeofolia(fixture, "geofolia-pilote.zip");

describe("lecteur Geofolia", () => {
  it("est enregistré : un ZIP Geofolia est lu à l'analyse", () => {
    const a = analyzeFile("export.zip", fixture);
    expect(a.format).toBe("geofolia");
    expect(a.bundle?.producedBy).toMatch(/^Geofolia 26\./);
    const p = buildPreview(a, { fileName: "export.zip", farmSiret: "40000000000003", decisions: {} });
    expect(p.readable).toBe(true);
    expect(p.farm.siretMatches).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it("parcelles : une terre par culture principale, cultures secondaires sur la terre de leur principale", () => {
    expect(bundle.campaigns).toEqual([2026]);
    expect(bundle.parcels).toHaveLength(13);
    const lands = new Set(bundle.parcels.map((p) => p.landKey));
    expect(lands.size).toBe(6);
    const secondary = bundle.parcels.filter((p) => p.secondary);
    expect(secondary).toHaveLength(7);
    for (const s of secondary) expect(bundle.parcels.find((p) => p.key === s.landKey && !p.secondary), s.key).toBeTruthy();
    // Contours reprojetés en WGS 84 (jeu déplacé vers le centre de la France).
    const [lon, lat] = bundle.parcels[0]!.shape!.coordinates[0]![0]![0]!;
    expect(lon).toBeGreaterThan(-5);
    expect(lon).toBeLessThan(9);
    expect(lat).toBeGreaterThan(41);
    expect(lat).toBeLessThan(52);
  });

  it("cultures : code AgroEDI, usage d'après la destination, historique N-1…N-5 des cultures principales", () => {
    const maize = bundle.parcels.find((p) => p.crop.label === "Maïs fourrage" && !p.secondary)!;
    expect(maize.crop).toMatchObject({ aeeCode: "ZCS", aeeUsage: "ZLF" });
    expect(bundle.parcels.find((p) => p.crop.label === "Prairie temporaire")!.crop).toMatchObject({ aeeCode: "ZDU", aeeComplement: "ZLU", aeeUsage: "ZEQ" });
    expect(bundle.history).toHaveLength(30);
    expect(new Set(bundle.history.map((h) => h.campaign))).toEqual(new Set([2021, 2022, 2023, 2024, 2025]));
  });

  it("unités de travail : un couple action × parcelle, intrants par couple, dose par hectare", () => {
    expect(bundle.workUnits).toHaveLength(215);
    expect(new Set(bundle.workUnits.map((u) => u.groupKey)).size).toBe(197);
    const keys = new Set(bundle.parcels.map((p) => p.key));
    for (const u of bundle.workUnits) {
      expect(keys.has(u.parcelKey), u.guid).toBe(true);
      expect(u.guid).toMatch(/^[0-9A-F]{32}$/);
    }
    const sprayed = bundle.workUnits.find((u) => u.operation.aeeCode === "SEX")!;
    expect(sprayed.inputs.length).toBeGreaterThan(0);
    for (const i of sprayed.inputs) expect(i.perHa).toBeCloseTo(i.total! / (sprayed.workedAreaM2! / 10_000), 6);
    expect(bundle.workUnits.filter((u) => u.status === "planned")).toHaveLength(30);
  });

  it("irrigation : l'eau n'est pas un article, elle devient une dose en mm", () => {
    expect(bundle.articles.some((a) => a.nature === "water")).toBe(false);
    const irrigations = bundle.workUnits.filter((u) => u.operation.aeeCode === "SEO");
    expect(irrigations).toHaveLength(58);
    for (const u of irrigations) {
      expect(u.inputs).toEqual([]);
      expect(u.waterL! / u.workedAreaM2!).toBeGreaterThan(0);
    }
  });

  it("articles : AMM des phytos, composition des fertilisants, récoltes en t ou t MS", () => {
    expect(bundle.articles.filter((a) => a.amm)).toHaveLength(32);
    for (const a of bundle.articles.filter((x) => x.amm)) expect(["phyto", "adjuvant"]).toContain(a.nature);
    expect(bundle.articles.filter((a) => a.composition).length).toBeGreaterThan(0);
    const harvests = bundle.workUnits.filter((u) => u.outputs.length);
    expect(harvests).toHaveLength(30);
    expect(new Set(harvests.flatMap((u) => u.outputs.map((o) => o.unit)))).toEqual(new Set(["ton", "ton_dry_matter"]));
  });

  it("aucun nom ni identifiant de la ferme d'origine dans le jeu de test", () => {
    expect(bundle.farm.siret).toBe("40000000000003");
    expect(bundle.people.map((p) => p.lastName)).toEqual(["Salarié 1"]);
    expect(bundle.workUnits.every((u) => u.modifiedBy === "UTILISATEUR")).toBe(true);
  });
});

describe("tables Geofolia", () => {
  it("natures de produits, unités et usages", () => {
    expect(geofoliaNature(1, 19)).toEqual({ nature: "phyto", purpose: "herbicide" });
    expect(geofoliaNature(1, 2)).toEqual({ nature: "adjuvant" });
    expect(geofoliaNature(4, 13)).toEqual({ nature: "fertilizer", organic: true });
    expect(geofoliaNature(4, 3)).toEqual({ nature: "amendment" });
    expect(geofoliaNature(8, 12)).toEqual({ nature: "water" });
    expect(geofoliaNature(99, 1)).toEqual({ nature: "other" });
    expect(geofoliaUnit("tMS")).toBe("ton_dry_matter");
    expect(geofoliaUnit("m³")).toBe("cubic_meter");
    expect(geofoliaUnit("??")).toBeNull();
    expect(geofoliaUsage("Grains")).toBe("ZLD");
    expect(geofoliaUsage("Pâturée et fauchée")).toBe("ZEQ");
  });

  it("refuse un ZIP sans Action.Json ou un JSON illisible", () => {
    expect(() => readGeofolia(zip({ "Field.Json": "{}" }), "x.zip")).toThrow(ImportFileError);
    expect(() => readGeofolia(zip({ "Field.Json": "{", "Action.Json": "{}" }), "x.zip")).toThrow(/JSON valide/);
  });

  it("refuse un système de coordonnées inconnu", () => {
    const info = { Information: { CoordinateReferenceSystem: 'PROJCRS["UTM zone 30N"]' } };
    expect(() => readGeofolia(zip({ "Field.Json": JSON.stringify({ ...info, Fields: [] }), "Action.Json": JSON.stringify(info) }), "x.zip")).toThrow(/coordonnées/);
  });
});
