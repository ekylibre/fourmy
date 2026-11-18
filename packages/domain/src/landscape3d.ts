import { pointInPolygon, type Pt } from "./plan3d.js";
import { localFrame } from "./vegetation3d.js";

/**
 * Arbres du plan 3D d'après la BD TOPO (claudedocs/conception_rejeu_3d_outils_paysage.md §7.2) :
 * un arbre tous les 4 m le long des haies, une grille dans les bois (dense
 * sur la bordure, éclaircie au centre), des vergers et peupleraies alignés.
 * Hauteur par nature, variée au hasard (graine = identifiant de l'objet :
 * deux appels donnent les mêmes arbres). Aucun arbre dans une parcelle
 * cultivée ni dans un bâtiment. Fonctions pures.
 */

export type TreeKind = "deciduous" | "conifer" | "hedge" | "orchard";

export interface TreeInstance {
  lon: number;
  lat: number;
  heightM: number;
  /** Diamètre du houppier (m). */
  crownM: number;
  kind: TreeKind;
}

/** Objet de paysage lu dans le cache IGN (sous-ensemble de LandscapeFeature, geo-ign). */
export interface LandscapeInput {
  id: string;
  kind: string;
  nature?: string;
  geometry: { type: string; coordinates: unknown };
}

/** Règle par nature : espacement de la grille (m), hauteur (m) et sa variation, couronne, type. */
interface Rule {
  spacingM: number;
  heightM: number;
  jitter: number;
  crownRatio: number;
  kind: TreeKind | "mixed";
  /** Grille de bois : bordure dense de cette largeur, centre éclairci (une cellule sur `thin`). */
  edgeM?: number;
  thin?: number;
  /** Une cellule sur `keep` seulement (landes). */
  keep?: number;
  aligned?: boolean;
}

const HEDGE: Rule = { spacingM: 4, heightM: 6, jitter: 0.3, crownRatio: 0.6, kind: "hedge" };
const WOOD: Rule = { spacingM: 7, heightM: 15, jitter: 0.25, crownRatio: 0.45, kind: "deciduous", edgeM: 30, thin: 4 };

/** Règle d'une zone de végétation selon sa nature BD TOPO ; null : rien à dessiner (vigne : ses rangs existent déjà). */
export function vegetationRule(nature: string | undefined): Rule | null {
  const n = (nature ?? "").toLowerCase();
  if (n === "haie") return HEDGE;
  if (n.includes("vigne")) return null;
  if (n.includes("verger")) return { spacingM: 5, heightM: 4, jitter: 0.15, crownRatio: 0.9, kind: "orchard", aligned: true };
  if (n.includes("peupleraie")) return { spacingM: 7, heightM: 22, jitter: 0.1, crownRatio: 0.3, kind: "deciduous", aligned: true };
  if (n.includes("lande")) return { spacingM: 5, heightM: 2, jitter: 0.4, crownRatio: 1.2, kind: "hedge", keep: 3 };
  if (n.includes("conif")) return { ...WOOD, heightM: 18, kind: "conifer" };
  if (n.includes("mixte")) return { ...WOOD, heightM: 16, kind: "mixed" };
  if (n.includes("forêt") || n.includes("foret") || n.includes("bois")) return WOOD;
  return null;
}

/** Hachage FNV-1a d'une chaîne (32 bits). */
function hashString(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Hasard d'une cellule de grille (objet, rangée, colonne). */
function cellRandom(fid: number, row: number, col: number): () => number {
  return mulberry32((Math.imul(fid ^ Math.imul(row, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(col, 0xc2b2ae35)) >>> 0);
}

/** Hasard reproductible dans [0 ; 1[ (mulberry32 sur un hachage FNV de la graine). */
export function seeded(seed: string): () => number {
  return mulberry32(hashString(seed));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lines = (g: LandscapeInput["geometry"]): Pt[][] =>
  g.type === "LineString" ? [g.coordinates as Pt[]] : g.type === "MultiLineString" ? (g.coordinates as Pt[][]) : g.type === "Polygon" ? (g.coordinates as Pt[][]) : g.type === "MultiPolygon" ? (g.coordinates as Pt[][][]).flat() : [];

const polygons = (g: LandscapeInput["geometry"]): Pt[][][] => (g.type === "Polygon" ? [g.coordinates as Pt[][]] : g.type === "MultiPolygon" ? (g.coordinates as Pt[][][]) : []);

/** Un point dans un polygone (anneau extérieur, hors trous). */
export function inPolygon(p: Pt, rings: Pt[][]): boolean {
  if (!rings[0] || !pointInPolygon(p, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInPolygon(p, hole));
}

/** Distance (m, repère local) d'un point au bord d'un polygone. */
function edgeDistance(p: Pt, rings: Pt[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i]!, ring[i + 1]!];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
  }
  return best;
}

export interface TreeOptions {
  /** Polygones [lon, lat] où ne pas planter : parcelles cultivées, bâtiments. */
  exclude?: Pt[][][];
  /** Emprise retenue (les objets d'une tuile débordent) : [ouest, sud, est, nord]. */
  bbox?: [number, number, number, number];
  /** Plafond d'arbres ; au-delà, les plus loin du centre sont retirés. */
  limit?: number;
  center?: Pt;
}

/** Arbres de tous les objets de paysage (haies et zones de végétation). */
export function landscapeTrees(features: readonly LandscapeInput[], opts: TreeOptions = {}): { trees: TreeInstance[]; truncated: boolean } {
  const [west, south, east, north] = opts.bbox ?? [-180, -90, 180, 90];
  // Centre du repère local : celui demandé, sinon de l'emprise, sinon le premier point des objets.
  const first = (c: unknown): Pt | null => (Array.isArray(c) && typeof c[0] === "number" ? (c as Pt) : Array.isArray(c) && c.length ? first(c[0]) : null);
  const center: Pt = opts.center ?? (opts.bbox ? [(west + east) / 2, (south + north) / 2] : (features.map((f) => first(f.geometry.coordinates)).find(Boolean) ?? [0, 0]));
  const frame = localFrame(center[0], center[1]);
  // Exclusions avec leur emprise : le test du polygone ne se fait que dans la boîte.
  const exclude = (opts.exclude ?? []).map((rings) => {
    const local = rings.map((r) => r.map(([lon, lat]) => frame.toLocal(lon, lat)));
    const xs = local[0]?.map((q) => q[0]) ?? [0];
    const ys = local[0]?.map((q) => q[1]) ?? [0];
    return { rings: local, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const };
  });
  const [ax0, ay0] = frame.toLocal(west, south);
  const [ax1, ay1] = frame.toLocal(east, north);
  const area = [ax0, ay0, ax1, ay1] as const;
  const blocked = (p: Pt) => exclude.some(({ rings, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inPolygon(p, rings));
  const out: (TreeInstance & { dist: number })[] = [];
  const add = (x: number, y: number, rule: Rule, rand: () => number) => {
    const [lon, lat] = frame.toLonLat(x, y);
    if (lon < west || lon > east || lat < south || lat > north) return;
    if (blocked([x, y])) return;
    const heightM = rule.heightM * (1 + (rand() * 2 - 1) * rule.jitter);
    const kind: TreeKind = rule.kind === "mixed" ? (rand() < 0.5 ? "conifer" : "deciduous") : rule.kind;
    out.push({ lon, lat, heightM: Math.round(heightM * 10) / 10, crownM: Math.round(heightM * rule.crownRatio * 10) / 10, kind, dist: Math.hypot(x, y) });
  };

  for (const f of features) {
    const rand = seeded(f.id);
    const rule = f.kind === "hedge" ? HEDGE : f.kind === "vegetation" ? vegetationRule(f.nature) : null;
    if (!rule) continue;
    if (rule === HEDGE) {
      // Le long des lignes (haie linéaire, ou contour d'une surface de haie).
      for (const line of lines(f.geometry)) {
        const pts = line.map(([lon, lat]) => frame.toLocal(lon, lat));
        let carry = rand() * rule.spacingM;
        for (let i = 0; i + 1 < pts.length; i++) {
          const [a, b] = [pts[i]!, pts[i + 1]!];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let d = carry; d < len; d += rule.spacingM) {
            const t = d / len;
            const jitter = (rand() - 0.5) * 1;
            const [nx, ny] = len ? [-(b[1] - a[1]) / len, (b[0] - a[0]) / len] : [0, 0];
            add(a[0] + (b[0] - a[0]) * t + nx * jitter, a[1] + (b[1] - a[1]) * t + ny * jitter, rule, rand);
          }
          carry = (carry - len) % rule.spacingM;
          if (carry < 0) carry += rule.spacingM;
        }
      }
      continue;
    }
    // Zone : grille dans le polygone (décalée d'une rangée sur deux, sauf alignée).
    for (const poly of polygons(f.geometry)) {
      const rings = poly.map((r) => r.map(([lon, lat]) => frame.toLocal(lon, lat)));
      const xs = rings[0]!.map((p) => p[0]);
      const ys = rings[0]!.map((p) => p[1]);
      const s = rule.spacingM;
      // Grille bornée à l'emprise demandée : une forêt déborde souvent largement de la zone.
      const [x0, y0] = [Math.max(Math.min(...xs), area[0]), Math.max(Math.min(...ys), area[1])];
      const [x1, y1] = [Math.min(Math.max(...xs), area[2]), Math.min(Math.max(...ys), area[3])];
      if (x0 >= x1 || y0 >= y1) continue;
      // Origine de la grille fixée sur le polygone (et non sur l'emprise) : les mêmes arbres quelle que soit la zone.
      const gx = Math.min(...xs);
      const gy = Math.min(...ys);
      const fid = hashString(f.id);
      for (let row = Math.max(0, Math.floor((y0 - gy) / s)), y = gy + s / 2 + row * s; y < y1; y += s, row++) {
        const start = gx + (rule.aligned || row % 2 === 0 ? s / 2 : s);
        for (let col = Math.max(0, Math.floor((x0 - start) / s)), x = start + col * s; x < x1; x += s, col++) {
          // Hasard propre à la cellule : le même arbre quelle que soit l'emprise demandée.
          const r = cellRandom(fid, row, col);
          const cell = (row * 7919 + col) >>> 0;
          const jx = rule.aligned ? 0 : (r() - 0.5) * s * 0.6;
          const jy = rule.aligned ? 0 : (r() - 0.5) * s * 0.6;
          const p: Pt = [x + jx, y + jy];
          if (rule.keep && cell % rule.keep !== 0) continue;
          if (rule.edgeM && rule.thin && cell % rule.thin !== 0 && edgeDistance(p, rings) > rule.edgeM) continue;
          if (!inPolygon(p, rings)) continue;
          add(p[0], p[1], rule, r);
        }
      }
    }
  }
  const limit = opts.limit ?? 60_000;
  const truncated = out.length > limit;
  if (truncated) {
    // Les arbres les plus proches du centre de l'emprise (là où regarde la caméra).
    out.sort((a, b) => a.dist - b.dist);
    out.length = limit;
  }
  return { trees: out.map(({ dist: _d, ...t }) => t), truncated };
}

/** Hauteur d'un pylône sans hauteur connue, d'après la tension de sa ligne (m). */
export function pylonHeightM(voltageKv: number | null | undefined): number {
  if (!voltageKv) return 25;
  if (voltageKv >= 400) return 55;
  if (voltageKv >= 225) return 45;
  if (voltageKv >= 63) return 30;
  return 12;
}

/** Arbre BD TOPO plus bas que ceci dans le MNH : absent (arraché, ou haie basse). */
export const CANOPY_MIN_TREE_M = 1.5;

/**
 * Hauteurs réelles du LiDAR HD (conception §8) : chaque arbre de la BD TOPO
 * prend la hauteur du MNH à son pied (couronne à proportion), ou disparaît
 * en deçà de 1,5 m ; sans donnée LiDAR, il garde sa hauteur par nature. Les
 * cimes isolées (déjà filtrées par l'appelant) deviennent des feuillus, sauf
 * à moins de `minDistM` d'un arbre existant.
 */
export function refineWithCanopy(
  trees: readonly TreeInstance[],
  heightAt: (lon: number, lat: number) => number | null,
  peaks: readonly { lon: number; lat: number; heightM: number }[],
  opts: { minDistM?: number; maxHeightM?: number } = {},
): { trees: TreeInstance[]; removed: number; added: number } {
  const { minDistM = 4, maxHeightM = 45 } = opts;
  const out: TreeInstance[] = [];
  let removed = 0;
  for (const t of trees) {
    const h = heightAt(t.lon, t.lat);
    if (h === null) {
      out.push(t);
      continue;
    }
    if (h < CANOPY_MIN_TREE_M) {
      removed++;
      continue;
    }
    const heightM = Math.round(Math.min(h, maxHeightM) * 10) / 10;
    out.push({ ...t, heightM, crownM: Math.round((t.crownM / t.heightM) * heightM * 10) / 10 });
  }
  // Grille de voisinage (cases de `minDistM`) pour écarter les cimes déjà représentées.
  if (!out.length && !peaks.length) return { trees: out, removed, added: 0 };
  const lat0 = (out[0] ?? peaks[0])!.lat;
  const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 111_320;
  const cell = (lon: number, lat: number) => [Math.floor((lon * mx) / minDistM), Math.floor((lat * my) / minDistM)] as const;
  const grid = new Map<string, TreeInstance[]>();
  const put = (t: TreeInstance) => {
    const [cx, cy] = cell(t.lon, t.lat);
    const k = `${cx}:${cy}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(t);
  };
  out.forEach(put);
  let added = 0;
  for (const p of peaks) {
    const [cx, cy] = cell(p.lon, p.lat);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) {
      for (let dy = -1; dy <= 1 && !near; dy++) {
        near = (grid.get(`${cx + dx}:${cy + dy}`) ?? []).some((t) => Math.hypot((t.lon - p.lon) * mx, (t.lat - p.lat) * my) < minDistM);
      }
    }
    if (near) continue;
    const heightM = Math.round(Math.min(p.heightM, maxHeightM) * 10) / 10;
    const tree: TreeInstance = { lon: p.lon, lat: p.lat, heightM, crownM: Math.round(heightM * 0.6 * 10) / 10, kind: "deciduous" };
    out.push(tree);
    put(tree);
    added++;
  }
  return { trees: out, removed, added };
}
