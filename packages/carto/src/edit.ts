import type { Feature, LineString, MultiPolygon, Polygon, Position } from "geojson";
import { featureCollection, feature as toFeature } from "@turf/helpers";
import { intersect } from "@turf/intersect";
import { difference } from "@turf/difference";
import { union } from "@turf/union";
import { kinks } from "@turf/kinks";
import { booleanValid } from "@turf/boolean-valid";
import { booleanIntersects } from "@turf/boolean-intersects";
import { areaM2 } from "./measure.js";

/**
 * Opérations d'édition (exigence CARTO-1) : découpe, fusion, découpe d'une
 * zone sur sa parcelle, contrôle de validité. Fonctions pures sur du GeoJSON
 * WGS84, sans carte : réutilisables par le parcellaire, les interventions et
 * plus tard le mobile. La topologie est calculée dans le plan lon/lat (sans
 * conséquence à l'échelle d'une ferme) ; les surfaces sont géodésiques.
 */

export type Area = Polygon | MultiPolygon;

/** Erreur d'édition, message pour l'utilisateur. */
export class CartoError extends Error {
  override name = "CartoError";
}

/** Morceaux plus petits que ce seuil (m²) : résidus de calcul, ignorés. */
const SLIVER_M2 = 0.01;

const asFeature = (g: Area) => toFeature(g) as Feature<Area>;

/** Éclate un polygone ou multipolygone en polygones simples. */
export function polygons(geometry: Area | null | undefined): Polygon[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry];
  return geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
}

/**
 * Problèmes d'un polygone (vide si valide) : trop peu de points, contour qui
 * se croise, surface nulle.
 */
export function validateArea(geometry: Area): string[] {
  const problems: string[] = [];
  for (const p of polygons(geometry)) {
    if (p.coordinates.some((ring) => ring.length < 4)) problems.push("Un contour a moins de trois points.");
  }
  if (problems.length) return problems;
  if (kinks(asFeature(geometry)).features.length > 0) problems.push("Le contour se croise lui-même.");
  else if (!booleanValid(asFeature(geometry))) problems.push("La géométrie est invalide.");
  if (problems.length === 0 && areaM2(geometry) < SLIVER_M2) problems.push("La surface est nulle.");
  return problems;
}

// --- Découpe -----------------------------------------------------------------

type Box = [minX: number, minY: number, maxX: number, maxY: number];

function bounds(points: Position[]): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x!);
    box[1] = Math.min(box[1], y!);
    box[2] = Math.max(box[2], x!);
    box[3] = Math.max(box[3], y!);
  }
  return box;
}

/** Point où le segment a→b (a dedans, b dehors) sort du rectangle (Liang–Barsky). */
function exitPoint(a: Position, b: Position, [x0, y0, x1, y1]: Box): Position {
  const [ax, ay] = a as [number, number];
  const dx = b[0]! - ax;
  const dy = b[1]! - ay;
  let t = 1;
  if (dx > 0) t = Math.min(t, (x1 - ax) / dx);
  if (dx < 0) t = Math.min(t, (x0 - ax) / dx);
  if (dy > 0) t = Math.min(t, (y1 - ay) / dy);
  if (dy < 0) t = Math.min(t, (y0 - ay) / dy);
  return [ax + t * dx, ay + t * dy];
}

/** Position d'un point du bord du rectangle, de 0 à 4, dans le sens trigonométrique. */
function perimeterPosition([x, y]: Position, [x0, y0, x1, y1]: Box): number {
  const w = x1 - x0;
  const h = y1 - y0;
  const eps = 1e-12 * Math.max(w, h);
  if (Math.abs(y! - y0) <= eps) return (x! - x0) / w; // bas
  if (Math.abs(x! - x1) <= eps) return 1 + (y! - y0) / h; // droite
  if (Math.abs(y! - y1) <= eps) return 2 + (x1 - x!) / w; // haut
  return 3 + (y1 - y!) / h; // gauche
}

/**
 * Polygone « d'un côté » de la ligne : la ligne prolongée jusqu'au bord d'un
 * cadre qui contient tout, refermée par le bord du cadre (sens trigonométrique).
 * Il partage exactement les sommets de la ligne : les morceaux découpés ont
 * des bords communs, sans interstice.
 */
function sidePolygon(line: Position[], frame: Box, rays: [Position, Position][]): Polygon {
  const [[, start], [, end]] = rays as [[Position, Position], [Position, Position]];
  const corners: Position[] = [
    [frame[2], frame[1]], // 1 : bas droite
    [frame[2], frame[3]], // 2 : haut droite
    [frame[0], frame[3]], // 3 : haut gauche
    [frame[0], frame[1]], // 4 (= 0) : bas gauche
  ];
  const tEnd = perimeterPosition(end, frame);
  let tStart = perimeterPosition(start, frame);
  if (tStart <= tEnd) tStart += 4;
  const walk: Position[] = [];
  for (let k = Math.floor(tEnd) + 1; k < tStart; k++) walk.push(corners[(k - 1) % 4]!);
  return { type: "Polygon", coordinates: [[start, ...line, end, ...walk, start]] };
}

/** Prolongements de la ligne, de chaque extrémité jusqu'au bord du cadre. */
function extensions(line: Position[], frame: Box): [Position, Position][] {
  const far = 4 * Math.hypot(frame[2] - frame[0], frame[3] - frame[1]);
  const ray = (from: Position, to: Position): [Position, Position] => {
    const dx = to[0]! - from[0]!;
    const dy = to[1]! - from[1]!;
    const n = Math.hypot(dx, dy);
    return [to, exitPoint(to, [to[0]! + (dx / n) * far, to[1]! + (dy / n) * far], frame)];
  };
  return [ray(line[1]!, line[0]!), ray(line[line.length - 2]!, line[line.length - 1]!)];
}

/** Ligne débarrassée des points consécutifs confondus. */
function cleanLine(points: Position[]): Position[] {
  return points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
}

/**
 * Découpe une surface par une ligne. La ligne commence et finit hors de la
 * surface, la traverse (au moins deux morceaux) et ne se croise pas
 * elle-même ; une ligne qui entre et sort plusieurs fois donne plusieurs
 * morceaux.
 */
export function splitArea(geometry: Area, line: LineString): Polygon[] {
  const points = cleanLine(line.coordinates);
  if (points.length < 2) throw new CartoError("Tracez une ligne d'au moins deux points.");
  if (kinks(toFeature(line)).features.length > 0) throw new CartoError("La ligne de découpe se croise elle-même.");
  const all = [...polygons(geometry).flatMap((p) => p.coordinates.flat()), ...points];
  const [x0, y0, x1, y1] = bounds(all);
  const margin = Math.max(x1 - x0, y1 - y0, 1e-9);
  const frame: Box = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
  const target = asFeature(geometry);
  const rays = extensions(points, frame);
  // Les extrémités hors de la surface, et leurs prolongements sans la retraverser :
  // la découpe suit exactement la ligne tracée, rien d'autre.
  if (rays.some((r) => booleanIntersects(toFeature({ type: "LineString", coordinates: r }), target))) {
    throw new CartoError("Commencez et finissez la ligne hors de la surface à découper.");
  }
  const side = sidePolygon(points, frame, rays);

  const left = intersect(featureCollection([target, toFeature(side) as Feature<Polygon>]));
  const right = difference(featureCollection([target, toFeature(side) as Feature<Polygon>]));
  const pieces = [...polygons(left?.geometry), ...polygons(right?.geometry)].filter((p) => areaM2(p) >= SLIVER_M2);
  if (pieces.length < 2) throw new CartoError("La ligne doit traverser la surface de part en part.");
  return pieces;
}

// --- Fusion, découpe sur une parcelle -----------------------------------------

/**
 * Fusionne des surfaces qui se touchent ou se chevauchent en un seul polygone.
 * Des surfaces séparées sont refusées (pas de multipolygone implicite).
 */
export function mergeAreas(geometries: Area[]): Polygon {
  if (geometries.length < 2) throw new CartoError("Choisissez au moins deux surfaces à fusionner.");
  const merged = union(featureCollection(geometries.map(asFeature)));
  const parts = polygons(merged?.geometry).filter((p) => areaM2(p) >= SLIVER_M2);
  if (parts.length !== 1) throw new CartoError("Ces surfaces ne se touchent pas : impossible de les fusionner.");
  return parts[0]!;
}

/**
 * Partie d'une zone dessinée qui tombe dans sa parcelle (zone de travail
 * partielle) ; `null` si elle est entièrement dehors.
 */
export function clipToParcel(zone: Area, parcel: Area): Area | null {
  const inside = intersect(featureCollection([asFeature(zone), asFeature(parcel)]));
  if (!inside || areaM2(inside.geometry) < SLIVER_M2) return null;
  return inside.geometry;
}
