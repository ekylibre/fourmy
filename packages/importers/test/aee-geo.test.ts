import { describe, it, expect } from "vitest";
import { PROCEDURE_LABELS, PROCEDURES, treatmentPurpose } from "@fourmy/contracts";
import {
  aeeUnit,
  eventStatus,
  gmlCoordinates,
  harvestProcedure,
  INPUT_NATURES,
  inputNature,
  lambert93,
  OPERATIONS,
  operationTarget,
  toMultiPolygon,
  wgs84,
  wktToGeoJson,
} from "../src/index.js";

describe("codes AgroEDI → Fourmy", () => {
  const known = new Set(PROCEDURES.map((p) => p.code));

  it("chaque procédure cible existe au catalogue", () => {
    for (const [code, target] of Object.entries(OPERATIONS)) expect(known.has(target.procedure), `${code} → ${target.procedure}`).toBe(true);
    for (const p of ["grains_harvest", "harvesting"]) expect(known.has(p), p).toBe(true);
    // Replis hors catalogue, mais libellés en français (procédures d'Ekylibre).
    for (const p of ["technical_task", "generic_tillage"]) expect(PROCEDURE_LABELS[p], p).toBeTruthy();
  });

  it("chaque motif de traitement existe dans les contrats", () => {
    for (const [code, n] of Object.entries(INPUT_NATURES)) {
      if (n.purpose) expect(treatmentPurpose.safeParse(n.purpose).success, `${code} → ${n.purpose}`).toBe(true);
    }
  });

  it("les codes de la ferme pilote ont une cible, lue dans la bonne table", () => {
    // Table 14 : ZKE est un semis de précision (en table 5, un amendement).
    expect(operationTarget("ZKE")).toEqual({ procedure: "sowing", sowing: "precision" });
    expect(inputNature("ZKE")).toEqual({ nature: "amendment" });
    expect(operationTarget("SEX").procedure).toBe("spraying");
    expect(operationTarget("SEO")).toEqual({ procedure: "plant_watering", irrigation: true });
    expect(operationTarget("SEU").sowing).toBe("direct");
    expect(operationTarget("SFK").procedure).toBe("crop_residues_grinding");
    expect(operationTarget("ZTC").procedure).toBe("technical_task");
    expect(operationTarget("XXX", "ZF8").procedure).toBe("generic_tillage");
    expect(operationTarget(null).procedure).toBe("technical_task");
    expect(harvestProcedure("ZLD")).toBe("grains_harvest");
    expect(harvestProcedure("ZLF")).toBe("harvesting");
  });

  it("états, natures d'intrant et unités", () => {
    expect(eventStatus("ZK1")).toBe("planned");
    expect(eventStatus("ZK2")).toBe("done");
    expect(inputNature("ZIU")).toEqual({ nature: "phyto", purpose: "herbicide" });
    expect(inputNature("ZJB")).toEqual({ nature: "fertilizer", organic: true });
    expect(inputNature("ZJE").nature).toBe("water");
    expect(inputNature("XXX").nature).toBe("other");
    expect(aeeUnit("ZHK")).toEqual({ unit: "ton_per_hectare", perHa: true });
    expect(aeeUnit("ZKM ")).toEqual({ unit: "unity_per_hectare", perHa: true });
    expect(aeeUnit("LTR")).toEqual({ unit: "liter", perHa: false });
    expect(aeeUnit("QQQ")).toBeNull();
  });
});

describe("géométries", () => {
  // Références : ST_Transform(…, 2154 → 4326) de PostGIS.
  it("Lambert 93 → WGS 84, au millimètre près", () => {
    const [lon, lat] = lambert93([652381.0, 6862047.0]);
    expect(lon).toBeCloseTo(2.350999076769483, 7);
    expect(lat).toBeCloseTo(48.856699081718865, 7);
    const [lon2, lat2] = lambert93([843000.25, 6519000.75]);
    expect(lon2).toBeCloseTo(4.839713944681179, 7);
    expect(lat2).toBeCloseTo(45.75561528405604, 7);
  });

  it("WKT Geofolia : polygone (anneau refermé), multipolygone avec trou, point", () => {
    const poly = wktToGeoJson("POLYGON ((652381.0 6862047.0, 652300.0 6862100.0, 652320.0 6862000.0))", lambert93);
    expect(poly.type).toBe("Polygon");
    const ring = (poly as { coordinates: number[][][] }).coordinates[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[3]).toEqual(ring[0]);

    const multi = wktToGeoJson("SRID=4326;MULTIPOLYGON (((0 0, 0 10, 10 10, 10 0, 0 0), (2 2, 2 3, 3 3, 2 2)), ((20 20, 20 21, 21 21, 20 20)))", wgs84);
    expect(multi.type).toBe("MultiPolygon");
    expect((multi as { coordinates: number[][][][] }).coordinates.map((p) => p.length)).toEqual([2, 1]);

    expect(wktToGeoJson("POINT Z (1 2 3)", wgs84)).toEqual({ type: "Point", coordinates: [1, 2] });
    expect(toMultiPolygon(poly).type).toBe("MultiPolygon");
  });

  it("GML 2 TelePAC (« x,y x,y »)", () => {
    const ring = gmlCoordinates(" 843000.25,6519000.75 843010.5,6519020.25 ", lambert93);
    expect(ring).toHaveLength(2);
    expect(ring[0]![0]).toBeCloseTo(4.839713944681179, 7);
  });

  it("refuse une géométrie invalide", () => {
    expect(() => wktToGeoJson("LINESTRING (0 0, 1 1)", wgs84)).toThrow(/non prise en charge/);
    expect(() => wktToGeoJson("POLYGON ((0 0, a b, 1 1))", wgs84)).toThrow(/invalides/);
    expect(() => wktToGeoJson("POLYGON ((0 0, 1 1)", wgs84)).toThrow();
    expect(() => toMultiPolygon({ type: "Point", coordinates: [0, 0] })).toThrow(/polygone/);
  });
});
