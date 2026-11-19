import type { MultiPolygon, Point, Polygon, Position } from "geojson";
import proj4 from "proj4";

/**
 * Géométries des fichiers importés → GeoJSON WGS 84. Geofolia (WKT) et
 * TelePAC (GML 2, `gml:coordinates`) sont en Lambert 93 en métropole ; le
 * lecteur DAPLOS reprojette lui-même. Coordonnées arrondies à 1e-8 degré
 * (environ 1 mm), comme le lecteur DAPLOS.
 */

const LAMBERT_93 = "EPSG:2154";
proj4.defs(
  LAMBERT_93,
  "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);
const toWgs84 = proj4(LAMBERT_93, "EPSG:4326");

export type Projection = (xy: Position) => Position;

const round = (v: number) => Math.round(v * 1e8) / 1e8;

/** Lambert 93 (x, y en mètres) → WGS 84 (longitude, latitude). */
export const lambert93: Projection = ([x, y]) => {
  const [lon, lat] = toWgs84.forward([x!, y!]);
  return [round(lon!), round(lat!)];
};

/** Coordonnées déjà en WGS 84 : arrondies seulement. */
export const wgs84: Projection = ([x, y]) => [round(x!), round(y!)];

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryError";
  }
}

/** « x y, x y » (WKT) → positions projetées. */
function wktPositions(text: string, project: Projection): Position[] {
  return text
    .split(",")
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .map((xy) => {
      if (xy.length < 2 || xy.some((v) => !Number.isFinite(v))) throw new GeometryError(`Coordonnées WKT invalides : « ${text.slice(0, 40)} ».`);
      return project(xy.slice(0, 2));
    });
}

/** Contenu entre parenthèses de premier niveau : « (a), (b) » → [« a », « b »]. */
function groups(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) out.push(body.slice(start, i));
      if (depth < 0) throw new GeometryError("WKT mal parenthésé.");
    }
  }
  if (depth !== 0) throw new GeometryError("WKT mal parenthésé.");
  return out;
}

/**
 * WKT (`POINT`, `POLYGON`, `MULTIPOLYGON`, avec ou sans `SRID=…;` et Z) →
 * GeoJSON projeté. Les anneaux sont refermés s'ils ne le sont pas.
 */
export function wktToGeoJson(wkt: string, project: Projection): Point | Polygon | MultiPolygon {
  const text = wkt.trim().replace(/^SRID=\d+;/i, "");
  const m = text.match(/^(POINT|POLYGON|MULTIPOLYGON)\s*(?:Z|M|ZM)?\s*\(([\s\S]*)\)\s*$/i);
  if (!m) throw new GeometryError(`Géométrie WKT non prise en charge : « ${text.slice(0, 30)} ».`);
  const kind = m[1]!.toUpperCase();
  const body = m[2]!;
  const ring = (r: string) => closeRing(wktPositions(r, project));
  if (kind === "POINT") return { type: "Point", coordinates: wktPositions(body, project)[0]! };
  if (kind === "POLYGON") return { type: "Polygon", coordinates: groups(`(${body})`).flatMap((p) => groups(p)).map(ring) };
  return { type: "MultiPolygon", coordinates: groups(body).map((polygon) => groups(polygon).map(ring)) };
}

/** GML 2 `gml:coordinates` (« x,y x,y … ») → positions projetées. */
export function gmlCoordinates(text: string, project: Projection): Position[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const xy = pair.split(",").map(Number);
      if (xy.length < 2 || xy.some((v) => !Number.isFinite(v))) throw new GeometryError(`Coordonnées GML invalides : « ${pair} ».`);
      return project(xy.slice(0, 2));
    });
}

/** Anneau fermé (dernier point = premier). */
export function closeRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const [first, last] = [ring[0]!, ring[ring.length - 1]!];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Polygone ou multipolygone → multipolygone (forme des parcelles Fourmy). */
export function toMultiPolygon(g: Point | Polygon | MultiPolygon): MultiPolygon {
  if (g.type === "MultiPolygon") return g;
  if (g.type === "Polygon") return { type: "MultiPolygon", coordinates: [g.coordinates] };
  throw new GeometryError("Une parcelle doit être un polygone, pas un point.");
}

/** Point dans un polygone (règle pair-impair, trous compris). */
function inPolygon([x, y]: Position, rings: Position[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi! > y! !== yj! > y! && x! < ((xj! - xi!) * (y! - yi!)) / (yj! - yi!) + xi!) inside = !inside;
    }
  }
  return inside;
}

const inMulti = (p: Position, m: MultiPolygon) => m.coordinates.some((poly) => inPolygon(p, poly));

/**
 * Part de `a` recouverte par `b` (0 à 1), estimée sur une grille de points
 * de `a` : assez précis pour dire si deux cultures occupent la même terre,
 * sans bibliothèque géométrique.
 */
export function overlapShare(a: MultiPolygon, b: MultiPolygon, steps = 30): number {
  const pts = a.coordinates.flat(2);
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let inA = 0;
  let inBoth = 0;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const p: Position = [minX + ((i + 0.5) * (maxX - minX)) / steps, minY + ((j + 0.5) * (maxY - minY)) / steps];
      if (!inMulti(p, a)) continue;
      inA++;
      if (inMulti(p, b)) inBoth++;
    }
  }
  return inA ? inBoth / inA : 0;
}
