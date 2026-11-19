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
