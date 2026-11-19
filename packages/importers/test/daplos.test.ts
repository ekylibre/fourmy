import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MultiPolygon } from "geojson";
import { analyzeFile, coverOf, daplosCropLabel, draftInterventions, ImportFileError, landKeys, overlapShare, readDaplos, readGeofolia } from "../src/index.js";

/** Jeu anonymisé tiré d'un export réel (scripts/anonymize-daplos.mjs), calé sur le jeu Geofolia. */
const fixtures = join(import.meta.dirname, "fixtures");
const fixture = new Uint8Array(readFileSync(join(fixtures, "daplos-pilote.dap")));
const bundle = readDaplos(fixture, "export.dap");
const geofolia = readGeofolia(new Uint8Array(readFileSync(join(fixtures, "geofolia-pilote.zip"))), "export.zip");

const square = (x: number, y: number, size: number): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: [[[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]],
});

describe("lecteur DAPLOS", () => {
  it("est enregistré ; exploitation (SIRET, PACAGE, adresse) et campagne", () => {
    expect(analyzeFile("export.dap", fixture).format).toBe("daplos");
    expect(bundle.producedBy).toMatch(/^DAPLOS/);
    expect(bundle.campaigns).toEqual([2026]);
    expect(bundle.farm).toEqual({
      siret: "40000000000003",
      pacage: "040000003",
      name: "GAEC PILOTE TEST",
      email: null,
      address: { line1: "LE BOURG", postalCode: "00000", city: "Commune test", country: "FR" },
    });
    expect(bundle.warnings).toEqual([]);
  });

  it("cultures : contour, surfaces épandables, libellé, précédents ; même terre que Geofolia", () => {
    expect(bundle.parcels).toHaveLength(13);
    expect(bundle.parcels.filter((p) => !p.secondary)).toHaveLength(6);
    const byKey = new Map(geofolia.parcels.map((p) => [p.key, p]));
    for (const p of bundle.parcels) {
      expect(byKey.get(p.key)?.landKey, p.key).toBe(p.landKey);
      expect(p.sourceIds["daplos.crop"]).toBe(`2026:${p.key}`);
    }
    const main = bundle.parcels.find((p) => !p.secondary && p.shape)!;
    expect(main.shape!.coordinates[0]![0]!.length).toBeGreaterThan(3);
    expect(main.areaM2).toBeGreaterThan(0);
    expect(main.crop.label).toMatch(/ — /);
    expect(bundle.parcels.some((p) => p.spreadable?.manureSpreadable)).toBe(true);
    expect(bundle.history.length).toBeGreaterThan(0);
    expect(bundle.history.every((h) => h.campaign < 2026 && h.campaign >= 2021)).toBe(true);
    // Couverts d'interculture (moutarde blanche) : les mêmes que Geofolia.
    expect(bundle.parcels.filter((p) => coverOf(bundle, p)).map((p) => p.key).sort()).toEqual(geofolia.parcels.filter((p) => coverOf(geofolia, p)).map((p) => p.key).sort());
  });

  it("interventions : GUID communs avec Geofolia, dose par hectare du fichier, eau d'irrigation", () => {
    const guids = new Set(geofolia.workUnits.map((u) => u.guid));
    expect(bundle.workUnits).toHaveLength(185);
    expect(bundle.workUnits.every((u) => guids.has(u.guid) && u.groupKey === null)).toBe(true);
    // Les doses Geofolia (quantité ÷ surface travaillée) et DAPLOS (dose du fichier) concordent.
    const g = new Map(geofolia.workUnits.map((u) => [u.guid, u]));
    const names = new Map([...bundle.articles, ...geofolia.articles].map((a) => [a.key, a.name.toLowerCase()]));
    let compared = 0;
    for (const u of bundle.workUnits) {
      for (const i of u.inputs) {
        const other = g.get(u.guid)!.inputs.find((x) => names.get(x.articleKey) === names.get(i.articleKey));
        if (!other?.perHa || !i.perHa) continue;
        expect(Math.abs(other.perHa - i.perHa) / i.perHa).toBeLessThan(0.01);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
    const irrigation = bundle.workUnits.find((u) => u.operation.aeeCode === "SEO");
    if (irrigation) expect(irrigation.waterL).toBeGreaterThan(0);
    const harvest = bundle.workUnits.find((u) => u.outputs.length)!;
    expect(harvest.outputs[0]!.unit).toBe("ton");
    expect(harvest.outputs[0]!.total).toBeGreaterThan(0);
    // Sans identifiant d'action, les couples d'un même jour et d'une même opération se regroupent.
    expect(draftInterventions(bundle).length).toBeLessThan(bundle.workUnits.length);
  });

  it("articles par nom : nature, AMM, unité la plus employée, effluents organiques", () => {
    const phyto = bundle.articles.find((a) => a.nature === "phyto" && a.amm);
    expect(phyto?.amm).toMatch(/^\d{7}$/);
    expect(bundle.articles.every((a) => a.unit !== "unity" || a.nature === "seed" || a.nature === "other")).toBe(true);
    expect(bundle.articles.filter((a) => a.organic).length).toBeGreaterThan(0);
    expect(bundle.articles.some((a) => a.nature === "water")).toBe(false);
  });

  it("libellé d'une culture", () => {
    expect(daplosCropLabel({ crop_specie_edilabel: "Avoine", crop_specie_label: "Noir(e)", crop_sowing_period_edilabel: "Hiver", crop_final_usage_edilabel: "Grain(es)" })).toBe(
      "Avoine noire d'hiver — grain",
    );
    expect(daplosCropLabel({ crop_specie_edilabel: "Maïs", crop_final_usage_edilabel: "Fourrage(r.) = Prairie" })).toBe("Maïs — fourrage");
    expect(daplosCropLabel({ crop_specie_edilabel: "Orge", crop_sowing_period_edilabel: "Printemps" })).toBe("Orge de printemps");
  });

  it("terres : recouvrement, culture principale (hors couvert, plus petit numéro)", () => {
    expect(overlapShare(square(0, 0, 1), square(0, 0, 1))).toBe(1);
    expect(overlapShare(square(0, 0, 1), square(0.5, 0, 1))).toBeCloseTo(0.5, 1);
    expect(overlapShare(square(0, 0, 1), square(2, 2, 1))).toBe(0);
    const lands = landKeys([
      { key: "12", campaign: 2026, islet: "3", shape: square(0, 0, 1), cover: true },
      { key: "40", campaign: 2026, islet: "3", shape: square(0.1, 0.1, 0.8), cover: false },
      { key: "41", campaign: 2026, islet: "3", shape: square(0, 0, 1), cover: false },
      { key: "50", campaign: 2026, islet: "4", shape: square(0, 0, 1), cover: false }, // autre îlot
      { key: "60", campaign: 2025, islet: "3", shape: square(0, 0, 1), cover: false }, // autre campagne
    ]);
    expect(Object.fromEntries(lands)).toEqual({ "12": "40", "40": "40", "41": "40", "50": "50", "60": "60" });
  });

  it("fichier illisible refusé", () => {
    expect(() => readDaplos(new Uint8Array(Buffer.from("EI40000000000003   40000000000011   0001\r\n")), "vide.dap")).toThrow(ImportFileError);
  });
});
