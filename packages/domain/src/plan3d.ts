/**
 * Plan 3D (ADR-10) : dimensions et placement automatique des cuves dans
 * l'emprise de leur bâtiment. Fonctions pures, repère local en mètres
 * (x vers l'est, y vers le nord, origine = point de référence du bâtiment).
 */

export type Pt = [number, number];

/** Rapport hauteur / diamètre d'une cuve de cave courante. */
const ASPECT = 1.6;
const MIN_RADIUS = 0.25;

/**
 * Cylindre d'une capacité donnée. Si la hauteur dépasse `maxHeightM` (sous le
 * toit), la cuve s'élargit pour garder sa capacité.
 */
export function tankDimensions(capacityL: number, maxHeightM?: number): { radius: number; height: number } {
  const v = Math.max(capacityL, 1) / 1000; // m³
  let radius = Math.cbrt(v / (2 * ASPECT * Math.PI));
  let height = 2 * ASPECT * radius;
  if (maxHeightM !== undefined && maxHeightM > 0.5 && height > maxHeightM) {
    height = maxHeightM;
    radius = Math.sqrt(v / (Math.PI * height));
  }
  radius = Math.max(radius, MIN_RADIUS);
  return { radius: round(radius), height: round(height) };
}

const round = (n: number) => Math.round(n * 100) / 100;

const M_PER_DEG_LAT = 111_320;

/** Projection locale équirectangulaire (précise à l'échelle d'une ferme). */
export function toLocal([lon, lat]: Pt, [lon0, lat0]: Pt): Pt {
  return [(lon - lon0) * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * M_PER_DEG_LAT];
}

export function fromLocal([x, y]: Pt, [lon0, lat0]: Pt): Pt {
  return [lon0 + x / (M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)), lat0 + y / M_PER_DEG_LAT];
}

export function pointInPolygon([x, y]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToRing(p: Pt, ring: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!));
  return d;
}

/** Disque entièrement dans l'emprise, avec une marge aux murs. */
export function circleInside(c: Pt, radius: number, ring: Pt[], wallMargin = 0.3): boolean {
  return pointInPolygon(c, ring) && distanceToRing(c, ring) >= radius + wallMargin;
}

/** Angle du plus long côté : les rangées de cuves suivent l'axe du bâtiment. */
function mainAxis(ring: Pt[]): number {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len > best) {
      best = len;
      angle = Math.atan2(by - ay, bx - ax);
    }
  }
  return angle;
}

const rotate = ([x, y]: Pt, a: number): Pt => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

export interface TankToPlace {
  id: string;
  radius: number;
}

/**
 * Place des cuves en rangées le long de l'axe principal du bâtiment, sans
 * chevauchement (écart `gap`), chacune entièrement dans l'emprise. Les plus
 * grosses d'abord. Celles qui ne tiennent pas sont renvoyées dans `unplaced`
 * (signalées à l'utilisateur, jamais forcées hors du bâtiment).
 */
export function autoPlaceTanks(
  footprint: Pt[],
  tanks: TankToPlace[],
  { gap = 0.6, wallMargin = 0.3 } = {},
): { placed: { id: string; x: number; y: number }[]; unplaced: string[] } {
  const ring = footprint.length > 1 && footprint[0]![0] === footprint.at(-1)![0] && footprint[0]![1] === footprint.at(-1)![1]
    ? footprint.slice(0, -1)
    : footprint;
  const placed: { id: string; x: number; y: number; r: number }[] = [];
  const unplaced: string[] = [];
  if (ring.length < 3) return { placed: [], unplaced: tanks.map((t) => t.id) };

  const a = mainAxis(ring);
  const local = ring.map((p) => rotate(p, -a)); // axe principal → x
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = 0.25;

  for (const t of [...tanks].sort((p, q) => q.radius - p.radius)) {
    let spot: Pt | null = null;
    for (let y = minY + wallMargin + t.radius; y <= maxY - wallMargin - t.radius + 1e-9 && !spot; y += step) {
      for (let x = minX + wallMargin + t.radius; x <= maxX - wallMargin - t.radius + 1e-9; x += step) {
        // +2 cm : la marge aux murs reste garantie après l'arrondi au centimètre.
        if (!circleInside([x, y], t.radius, local, wallMargin + 0.02)) continue;
        if (placed.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + t.radius + gap)) continue;
        spot = [x, y];
        break;
      }
    }
    if (spot) placed.push({ id: t.id, x: spot[0], y: spot[1], r: t.radius });
    else unplaced.push(t.id);
  }
  return {
    placed: placed.map(({ id, x, y }) => {
      const [gx, gy] = rotate([x, y], a);
      return { id, x: round(gx), y: round(gy) };
    }),
    unplaced,
  };
}

/**
 * Point de référence d'un bâtiment (moyenne des sommets, anneau fermé ou non).
 * Origine du repère local des placements de cuves : l'API et l'interface
 * doivent utiliser **la même** fonction, sinon un placement manuel se décale.
 */
export function ringCentroid(ring: Pt[]): Pt {
  const closed = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** Anneau extérieur d'un Polygon / MultiPolygon GeoJSON (premier polygone). */
export function outerRing(g: { type: string; coordinates?: unknown } | null | undefined): Pt[] | null {
  if (!g) return null;
  if (g.type === "Polygon") return ((g.coordinates as Pt[][]) ?? [])[0] ?? null;
  if (g.type === "MultiPolygon") return ((g.coordinates as Pt[][][]) ?? [])[0]?.[0] ?? null;
  return null;
}
