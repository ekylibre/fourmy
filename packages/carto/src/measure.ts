import type { Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
// Module CommonJS : import par défaut (les exports nommés ne sont pas détectés sous Node ESM).
import geographiclib from "geographiclib-geodesic";

/**
 * Mesures géodésiques sur l'ellipsoïde WGS84 (GeographicLib, Karney 2013) :
 * le même algorithme que PostGIS `ST_Area(geography)` et `ST_Length`. Mesuré
 * sur les 206 parcelles des fermes locales : écart < 1 mm² avec la surface
 * enregistrée, quand le calcul sphérique (turf) s'écarte jusqu'à 230 m².
 */
const WGS84 = geographiclib.Geodesic.WGS84;

function ringArea(ring: Position[]): number {
  const poly = WGS84.Polygon(false);
  const points = closed(ring) ? ring.slice(0, -1) : ring;
  for (const [lon, lat] of points) poly.AddPoint(lat!, lon!);
  return Math.abs(poly.Compute(false, true).area ?? 0);
}

function closed(ring: Position[]): boolean {
  const a = ring[0];
  const b = ring[ring.length - 1];
  return ring.length > 1 && a![0] === b![0] && a![1] === b![1];
}

function polygonArea(rings: Position[][]): number {
  return rings.reduce((total, ring, i) => total + (i === 0 ? ringArea(ring) : -ringArea(ring)), 0);
}

/** Surface en m² d'un polygone ou multipolygone (trous déduits). */
export function areaM2(geometry: Polygon | MultiPolygon): number {
  if (geometry.type === "Polygon") return polygonArea(geometry.coordinates);
  return geometry.coordinates.reduce((t, p) => t + polygonArea(p), 0);
}

/** Longueur en m d'une suite de points (géodésique, segment par segment). */
export function pathLengthM(points: Position[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lon1, lat1] = points[i - 1]!;
    const [lon2, lat2] = points[i]!;
    total += WGS84.Inverse(lat1!, lon1!, lat2!, lon2!).s12 ?? 0;
  }
  return total;
}

/** Longueur en m d'une ligne ou multiligne. */
export function lengthM(geometry: LineString | MultiLineString): number {
  if (geometry.type === "LineString") return pathLengthM(geometry.coordinates);
  return geometry.coordinates.reduce((t, l) => t + pathLengthM(l), 0);
}

/** Périmètre en m (contours extérieurs et trous). */
export function perimeterM(geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((t, rings) => t + rings.reduce((s, ring) => s + pathLengthM(ring), 0), 0);
}

export interface Measure {
  areaM2?: number;
  perimeterM?: number;
  lengthM?: number;
}

/** Mesure adaptée au type de géométrie (outil « mesurer »). */
export function measure(geometry: Geometry): Measure {
  switch (geometry.type) {
    case "Polygon":
    case "MultiPolygon":
      return { areaM2: areaM2(geometry), perimeterM: perimeterM(geometry) };
    case "LineString":
    case "MultiLineString":
      return { lengthM: lengthM(geometry) };
    default:
      return {};
  }
}
