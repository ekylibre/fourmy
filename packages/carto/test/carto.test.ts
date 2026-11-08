import { describe, it, expect } from "vitest";
import type { LineString, Polygon } from "geojson";
import { areaM2, clipToParcel, lengthM, measure, mergeAreas, perimeterM, splitArea, validateArea, CartoError } from "../src/index.js";

const poly = (...rings: [number, number][][]): Polygon => ({ type: "Polygon", coordinates: rings });
const line = (...points: [number, number][]): LineString => ({ type: "LineString", coordinates: points });

// Parcelle d'environ 1 ha (celle des tests d'intégration de l'API).
const PARCEL = poly([[0.5, 44.8], [0.5013, 44.8], [0.5013, 44.8009], [0.5, 44.8009], [0.5, 44.8]]);
const PARCEL_POSTGIS_M2 = 10287.157182097435; // ST_Area(geography), PostGIS local

describe("mesures géodésiques (identiques à PostGIS)", () => {
  it("surface d'une parcelle : la valeur de PostGIS au mm² près", () => {
    expect(Math.abs(areaM2(PARCEL) - PARCEL_POSTGIS_M2)).toBeLessThan(1e-3);
  });

  it("un trou est déduit de la surface", () => {
    const holed = poly(
      [[0.5, 44.8], [0.502, 44.8], [0.502, 44.802], [0.5, 44.802], [0.5, 44.8]],
      [[0.5005, 44.8005], [0.5015, 44.8005], [0.5015, 44.8015], [0.5005, 44.8015], [0.5005, 44.8005]],
    );
    expect(Math.abs(areaM2(holed) - 26377.07805877924)).toBeLessThan(1e-3);
  });

  it("longueur d'une ligne : la valeur de PostGIS au mm près", () => {
    expect(Math.abs(lengthM(line([0.5, 44.8], [0.51, 44.81])) - 1364.1268823506746)).toBeLessThan(1e-3);
  });

  it("mesure adaptée au type, périmètre compris", () => {
    const m = measure(PARCEL);
    expect(m.areaM2).toBeCloseTo(PARCEL_POSTGIS_M2, 3);
    expect(m.perimeterM).toBeCloseTo(perimeterM(PARCEL), 6);
    expect(m.perimeterM!).toBeGreaterThan(400); // ~103 m × 100 m
    expect(measure(line([0.5, 44.8], [0.5013, 44.8]))).toEqual({ lengthM: expect.any(Number) });
    expect(measure({ type: "Point", coordinates: [0.5, 44.8] })).toEqual({});
  });
});

describe("découpe", () => {
  it("une ligne qui traverse la parcelle donne deux morceaux, sans perte de surface", () => {
    const pieces = splitArea(PARCEL, line([0.50065, 44.7995], [0.50065, 44.8015]));
    expect(pieces).toHaveLength(2);
    const total = pieces.reduce((t, p) => t + areaM2(p), 0);
    expect(Math.abs(total - PARCEL_POSTGIS_M2)).toBeLessThan(0.01);
    // Coupée par le milieu : deux moitiés.
    for (const p of pieces) expect(areaM2(p)).toBeCloseTo(PARCEL_POSTGIS_M2 / 2, -1);
  });

  it("les morceaux partagent leur bord : refusionnés, ils redonnent la parcelle", () => {
    const pieces = splitArea(PARCEL, line([0.4999, 44.8002], [0.5007, 44.8006], [0.5014, 44.8003]));
    const merged = mergeAreas(pieces);
    expect(Math.abs(areaM2(merged) - PARCEL_POSTGIS_M2)).toBeLessThan(0.01);
  });

  it("une ligne en zigzag qui traverse deux fois donne trois morceaux", () => {
    const zigzag = line([0.5003, 44.7995], [0.5006, 44.8014], [0.5009, 44.7995]);
    expect(splitArea(PARCEL, zigzag)).toHaveLength(3);
  });

  it("une ligne qui s'arrête dans la surface est refusée (pas de prolongement deviné)", () => {
    expect(() => splitArea(PARCEL, line([0.50065, 44.7995], [0.50065, 44.8005]))).toThrow(/hors de la surface/);
  });

  it("une ligne dehors est refusée, même si son prolongement traverserait la parcelle", () => {
    // Le prolongement de cette diagonale passe par le coin de la parcelle.
    expect(() => splitArea(PARCEL, line([0.51, 44.81], [0.511, 44.811]))).toThrow(CartoError);
    expect(() => splitArea(PARCEL, line([0.51, 44.79], [0.511, 44.79]))).toThrow(/de part en part/);
  });

  it("une ligne qui revient retraverser la surface une fois prolongée est refusée", () => {
    // Traverse d'ouest en est, remonte à l'est, revient en descendant vers le nord-ouest
    // et s'arrête au-dessus : prolongée, elle redescendrait dans la parcelle.
    const back = line([0.4995, 44.8004], [0.5014, 44.8004], [0.5014, 44.8014], [0.5007, 44.8011]);
    expect(() => splitArea(PARCEL, back)).toThrow(/hors de la surface/);
  });

  it("une ligne qui se croise, ou réduite à un point, est refusée", () => {
    expect(() => splitArea(PARCEL, line([0.5003, 44.7995], [0.501, 44.8012], [0.501, 44.7998], [0.5002, 44.8012]))).toThrow(/se croise/);
    expect(() => splitArea(PARCEL, line([0.5005, 44.8005], [0.5005, 44.8005]))).toThrow(/deux points/);
  });
});

describe("fusion", () => {
  const west = poly([[0.5, 44.8], [0.5006, 44.8], [0.5006, 44.8009], [0.5, 44.8009], [0.5, 44.8]]);
  const east = poly([[0.5006, 44.8], [0.5013, 44.8], [0.5013, 44.8009], [0.5006, 44.8009], [0.5006, 44.8]]);

  it("deux parcelles voisines deviennent un seul polygone", () => {
    expect(Math.abs(areaM2(mergeAreas([west, east])) - PARCEL_POSTGIS_M2)).toBeLessThan(0.01);
  });

  it("des parcelles séparées, ou une seule, sont refusées", () => {
    const far = poly([[0.51, 44.8], [0.511, 44.8], [0.511, 44.801], [0.51, 44.801], [0.51, 44.8]]);
    expect(() => mergeAreas([west, far])).toThrow(/ne se touchent pas/);
    expect(() => mergeAreas([west])).toThrow(/au moins deux/);
  });
});

describe("zone de travail sur sa parcelle", () => {
  it("une zone qui déborde est ramenée à la parcelle", () => {
    const zone = poly([[0.4995, 44.7995], [0.5006, 44.7995], [0.5006, 44.8015], [0.4995, 44.8015], [0.4995, 44.7995]]);
    const inside = clipToParcel(zone, PARCEL)!;
    const westHalf = poly([[0.5, 44.8], [0.5006, 44.8], [0.5006, 44.8009], [0.5, 44.8009], [0.5, 44.8]]);
    expect(areaM2(inside)).toBeCloseTo(areaM2(westHalf), 3);
  });

  it("une zone entièrement dehors donne null", () => {
    const zone = poly([[0.51, 44.8], [0.511, 44.8], [0.511, 44.801], [0.51, 44.801], [0.51, 44.8]]);
    expect(clipToParcel(zone, PARCEL)).toBeNull();
  });
});

describe("validité", () => {
  it("une parcelle normale est valide", () => {
    expect(validateArea(PARCEL)).toEqual([]);
  });
  it("un contour en nœud papillon, trop court ou plat est signalé", () => {
    expect(validateArea(poly([[0.5, 44.8], [0.501, 44.801], [0.501, 44.8], [0.5, 44.801], [0.5, 44.8]]))).toEqual(["Le contour se croise lui-même."]);
    expect(validateArea(poly([[0.5, 44.8], [0.501, 44.801], [0.5, 44.8]]))).toEqual(["Un contour a moins de trois points."]);
    // Points alignés sur un méridien (les géodésiques y sont des droites) : surface nulle.
    expect(validateArea(poly([[0.5, 44.8], [0.5, 44.801], [0.5, 44.802], [0.5, 44.8]]))).not.toEqual([]);
  });
});
