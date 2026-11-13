import { tileBounds } from "./tiles.js";

/**
 * Plan de préchargement des tuiles IGN (« Ma ferme », lots F4 et F4 bis,
 * claudedocs/conception_ma_ferme.md §4.3). Fonctions pures, sans réseau.
 *
 * Deux schémas, y compté depuis le nord dans les deux : XYZ en Web Mercator
 * (grille PM du WMTS de l'IGN, bâtiments) et géographique de Cesium (relief,
 * tiles.ts : niveau 0 = 2 × 1 tuiles de 180°).
 */

export interface TileKey {
  z: number;
  x: number;
  y: number;
}
export interface LonLat {
  lon: number;
  lat: number;
}
/** Anneaux [lon, lat] ; seul l'anneau extérieur compte (les trous sont couverts). */
export type PolygonRings = number[][][];

export type IgnCoverageLayer = "ortho" | "plan" | "elevation" | "buildings";
export type TileScheme = "mercator" | "geographic";

/**
 * Niveaux préchargés par couche (décision 11) : la zone des sites, puis le
 * détail autour des parcelles. Relief : la 3D ne demande pas plus fin que 16
 * à l'IGN (au-delà, interpolé). Bâtiments : une requête WFS par tuile de
 * zoom 14 (environ 1,7 km de côté en France).
 */
export const IGN_LAYER_ZOOMS: Record<IgnCoverageLayer, { scheme: TileScheme; zone: [number, number] | null; detail: number[] }> = {
  ortho: { scheme: "mercator", zone: [8, 16], detail: [17, 18] },
  plan: { scheme: "mercator", zone: [8, 16], detail: [17] },
  elevation: { scheme: "geographic", zone: [10, 14], detail: [15, 16] },
  buildings: { scheme: "mercator", zone: [14, 14], detail: [] },
};
/** Taille moyenne retenue pour l'estimation, en octets (relief : grille 65 × 65 en float32). */
export const IGN_TILE_BYTES: Record<IgnCoverageLayer, number> = { ortho: 25_000, plan: 15_000, elevation: 16_900, buildings: 10_000 };

const MAX_LAT = 85.05112878;
const M_PER_DEG = 111_320;

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const la = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Emprise d'une tuile XYZ en degrés. */
export function mercatorTileBounds(z: number, x: number, y: number): { west: number; south: number; east: number; north: number } {
  const n = 2 ** z;
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) };
}

export function validTile(z: number, x: number, y: number, maxZoom = 19): boolean {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > maxZoom) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/** Tuile du schéma géographique de Cesium qui contient un point. */
export function lonLatToGeoTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const size = 180 / 2 ** z;
  const x = Math.floor((lon + 180) / size);
  const y = Math.floor((90 - lat) / size);
  return { x: Math.min(2 ** (z + 1) - 1, Math.max(0, x)), y: Math.min(2 ** z - 1, Math.max(0, y)) };
}

const SCHEMES: Record<TileScheme, { tile: typeof lonLatToTile; bounds: typeof mercatorTileBounds }> = {
  mercator: { tile: lonLatToTile, bounds: mercatorTileBounds },
  geographic: { tile: lonLatToGeoTile, bounds: tileBounds },
};

/** Projection locale en mètres autour d'une origine (assez juste à l'échelle d'une ferme). */
function localProjector(origin: LonLat) {
  const kx = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180);
  return (lon: number, lat: number): [number, number] => [(lon - origin.lon) * kx, (lat - origin.lat) * M_PER_DEG];
}

/** Tuiles d'un niveau qui recouvrent une emprise en degrés. */
export function tilesInBox(west: number, south: number, east: number, north: number, z: number, scheme: TileScheme = "mercator"): TileKey[] {
  const a = SCHEMES[scheme].tile(west, north, z);
  const b = SCHEMES[scheme].tile(east, south, z);
  const out: TileKey[] = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push({ z, x, y });
  return out;
}

function boxAround(c: LonLat, radiusM: number) {
  const dLat = radiusM / M_PER_DEG;
  const dLon = radiusM / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180));
  return { west: c.lon - dLon, south: c.lat - dLat, east: c.lon + dLon, north: c.lat + dLat };
}

/** Tuiles du niveau z qui touchent le cercle (centre, rayon). */
export function tilesInCircle(center: LonLat, radiusM: number, z: number, scheme: TileScheme = "mercator"): TileKey[] {
  const b = boxAround(center, radiusM);
  const project = localProjector(center);
  return tilesInBox(b.west, b.south, b.east, b.north, z, scheme).filter((t) => {
    const tb = SCHEMES[scheme].bounds(t.z, t.x, t.y);
    const [x0, y0] = project(tb.west, tb.south);
    const [x1, y1] = project(tb.east, tb.north);
    const dx = Math.max(x0, 0, -x1);
    const dy = Math.max(y0, 0, -y1);
    return dx * dx + dy * dy <= radiusM * radiusM;
  });
}

type Pt = [number, number];

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (m) entre un rectangle et un anneau, 0 s'ils se recouvrent. */
function rectRingDistance(rect: [Pt, Pt], ring: Pt[]): number {
  const [[x0, y0], [x1, y1]] = rect;
  const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  if (ring.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) return 0;
  if (pointInRing([(x0 + x1) / 2, (y0 + y1) / 2], ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    for (let k = 0; k < 4; k++) {
      const c = corners[k]!;
      const d = corners[(k + 1) % 4]!;
      if (segmentsCross(a, b, c, d)) return 0;
      best = Math.min(best, segmentDistance(c, a, b), segmentDistance(a, c, d));
    }
  }
  return best;
}

/** Tuiles du niveau z qui touchent les polygones élargis de `marginM`. */
export function tilesNearPolygons(polygons: PolygonRings[], marginM: number, z: number, scheme: TileScheme = "mercator"): TileKey[] {
  const seen = new Map<string, TileKey>();
  for (const poly of polygons) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lon, lat] of outer as Pt[]) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    const origin = { lon: (west + east) / 2, lat: (south + north) / 2 };
    const project = localProjector(origin);
    const ring = (outer as Pt[]).map(([lon, lat]) => project(lon, lat));
    const dLat = marginM / M_PER_DEG;
    const dLon = marginM / (M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180));
    for (const t of tilesInBox(west - dLon, south - dLat, east + dLon, north + dLat, z, scheme)) {
      const key = `${t.x}/${t.y}`;
      if (seen.has(key)) continue;
      const tb = SCHEMES[scheme].bounds(t.z, t.x, t.y);
      if (rectRingDistance([project(tb.west, tb.south), project(tb.east, tb.north)], ring) <= marginM) seen.set(key, t);
    }
  }
  return [...seen.values()];
}

export interface CoverageInput {
  sites: { location: LonLat; radiusM: number }[];
  parcels: PolygonRings[];
  layers: IgnCoverageLayer[];
  detailMarginM: number;
}

/** Plan de préchargement : union sans doublon sur tous les sites, par couche. */
export function coveragePlan(input: CoverageInput): Map<IgnCoverageLayer, TileKey[]> {
  // Les tuiles d'un niveau ne dépendent que du schéma : calculées une fois pour toutes les couches.
  const memo = new Map<string, TileKey[]>();
  const cached = (key: string, compute: () => TileKey[]) => {
    if (!memo.has(key)) memo.set(key, compute());
    return memo.get(key)!;
  };
  const zoneTiles = (z: number, scheme: TileScheme) =>
    cached(`zone/${scheme}/${z}`, () => {
      const seen = new Map<string, TileKey>();
      for (const s of input.sites) for (const t of tilesInCircle(s.location, s.radiusM, z, scheme)) seen.set(`${t.x}/${t.y}`, t);
      return [...seen.values()];
    });
  const detailTiles = (z: number, scheme: TileScheme, exclude: TileKey[]) =>
    cached(`detail/${scheme}/${z}`, () => {
      const inZone = new Set(exclude.map((t) => `${t.x}/${t.y}`));
      return tilesNearPolygons(input.parcels, input.detailMarginM, z, scheme).filter((t) => !inZone.has(`${t.x}/${t.y}`));
    });
  const plan = new Map<IgnCoverageLayer, TileKey[]>();
  for (const layer of input.layers) {
    const { scheme, zone, detail } = IGN_LAYER_ZOOMS[layer];
    const tiles: TileKey[] = [];
    if (zone) for (let z = zone[0]; z <= zone[1]; z++) tiles.push(...zoneTiles(z, scheme));
    for (const z of detail) {
      // Un niveau à la fois dans la zone et dans le détail : pas de doublon.
      const overlap = zone && z >= zone[0] && z <= zone[1] ? zoneTiles(z, scheme) : [];
      tiles.push(...detailTiles(z, scheme, overlap));
    }
    plan.set(layer, tiles);
  }
  return plan;
}

export function planTileCount(plan: Map<IgnCoverageLayer, TileKey[]>): number {
  let n = 0;
  for (const tiles of plan.values()) n += tiles.length;
  return n;
}

export function estimateBytes(plan: Map<IgnCoverageLayer, TileKey[]>): number {
  let bytes = 0;
  for (const [layer, tiles] of plan) bytes += tiles.length * IGN_TILE_BYTES[layer];
  return bytes;
}
