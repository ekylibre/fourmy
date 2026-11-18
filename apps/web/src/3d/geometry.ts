import { circleInside, outerRing, ringCentroid, toLocal, type Pt } from "@fourmy/domain";
import type { GeoJsonGeometry } from "@fourmy/contracts";

/** Échantillon de trace : [instant ISO, longitude, latitude, au travail ?, largeur de travail (m) ?]. */
export type Sample = [string, number, number, boolean | null, (number | null)?];

/**
 * Découpe une trace en tronçons de même état (travail / transport). Chaque
 * tronçon reprend le dernier point du précédent : la ligne reste continue.
 */
export function splitRuns(samples: Sample[]): { working: boolean; coords: Pt[] }[] {
  const runs: { working: boolean; coords: Pt[] }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const [, lon, lat, w] = samples[i]!;
    const working = w === true;
    const last = runs.at(-1);
    if (!last || last.working !== working) {
      const prev = samples[i - 1];
      runs.push({ working, coords: prev ? [[prev[1], prev[2]], [lon, lat]] : [[lon, lat]] });
    } else {
      last.coords.push([lon, lat]);
    }
  }
  return runs.filter((r) => r.coords.length >= 2);
}

/**
 * Trace redécoupée tous les `stepM` mètres au plus (instant interpolé) : la
 * trace simplifiée par l'API garde les seuls bouts d'une passe droite, et une
 * ligne tendue entre eux passerait sous le relief.
 */
export function densify(samples: Sample[], stepM = 8): Sample[] {
  const out: Sample[] = [];
  samples.forEach((s, i) => {
    const prev = samples[i - 1];
    if (prev) {
      const k = Math.cos((s[2] * Math.PI) / 180);
      const d = Math.hypot((s[1] - prev[1]) * M_PER_DEG * k, (s[2] - prev[2]) * M_PER_DEG);
      const n = Math.floor(d / stepM);
      const [t0, t1] = [Date.parse(prev[0]), Date.parse(s[0])];
      for (let j = 1; j <= n && d > 0; j++) {
        const f = (j * stepM) / d;
        if (f >= 1) break;
        // État et largeur du point d'arrivée (une passe démarre au premier point au travail).
        out.push([new Date(t0 + (t1 - t0) * f).toISOString(), prev[1] + (s[1] - prev[1]) * f, prev[2] + (s[2] - prev[2]) * f, s[3], s[4] ?? null]);
      }
    }
    out.push(s);
  });
  return out;
}

/** Tronçons de même état en indices [from, to] ; chacun part du dernier point du précédent. */
export function runIndexes(samples: Sample[]): { working: boolean; from: number; to: number }[] {
  const runs: { working: boolean; from: number; to: number }[] = [];
  samples.forEach((s, i) => {
    const working = s[3] === true;
    const last = runs.at(-1);
    if (last && last.working === working) last.to = i;
    else runs.push({ working, from: Math.max(0, i - 1), to: i });
  });
  return runs.filter((r) => r.to > r.from);
}

/**
 * Placement manuel d'une cuve : position cliquée → coordonnées locales dans
 * le repère du bâtiment (même origine que l'API), ou raison du refus.
 */
export function placementFromClick(
  click: Pt,
  footprint: GeoJsonGeometry,
  radius: number,
): { x: number; y: number } | { error: string } {
  const ring = outerRing(footprint);
  if (!ring) return { error: "Bâtiment sans emprise." };
  const origin = ringCentroid(ring);
  const local = ring.map((p) => toLocal(p, origin));
  const [x, y] = toLocal(click, origin);
  if (!circleInside([x, y], radius, local, 0.3)) {
    return { error: "La cuve doit tenir entièrement dans le bâtiment (à 30 cm des murs)." };
  }
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

/** Point de vue initial : face au nord, incliné, à une distance adaptée à l'emprise. */
export function initialView(extent: { west: number; south: number; east: number; north: number }) {
  const lat = (extent.south + extent.north) / 2;
  const width = (extent.east - extent.west) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const height = (extent.north - extent.south) * 111_320;
  const size = Math.max(width, height, 200);
  const altitude = size * 0.9;
  const pitchDeg = -40;
  const back = altitude / Math.tan((-pitchDeg * Math.PI) / 180) / 111_320; // recul vers le sud, en degrés
  return { lon: (extent.west + extent.east) / 2, lat: lat - back, altitude, pitchDeg };
}

// ---------------------------------------------------------------------------
// Avatar 3D (lot M) : cap le long d'une trace, outil attelé derrière.
// ---------------------------------------------------------------------------

const M_PER_DEG = 111_320;

/** Cap (degrés, 0 = nord, sens horaire) de a vers b, à petite distance. */
export function bearing(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dx = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180);
  const dy = bLat - aLat;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Cap à chaque échantillon d'une trace : vers le point suivant ; à l'arrêt
 * (moins de `minMoveM`), le dernier cap connu, pour que l'engin ne pivote
 * pas sur place.
 */
export function headings(samples: readonly Sample[], minMoveM = 1.5): number[] {
  const out: number[] = [];
  let last: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const [, lon, lat] = samples[i]!;
    const next = samples[i + 1];
    if (next) {
      const dx = (next[1] - lon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
      const dy = (next[2] - lat) * M_PER_DEG;
      if (Math.hypot(dx, dy) >= minMoveM) last = bearing(lon, lat, next[1], next[2]);
    }
    out.push(last ?? 0);
  }
  // Début à l'arrêt : le premier cap connu.
  const first = out.findIndex((_, i) => {
    const n = samples[i + 1];
    return n && Math.hypot((n[1] - samples[i]![1]) * M_PER_DEG, (n[2] - samples[i]![2]) * M_PER_DEG) >= minMoveM;
  });
  if (first > 0) for (let i = 0; i < first; i++) out[i] = out[first]!;
  return out;
}

/** Point situé à `distanceM` derrière (lon, lat) dans la direction opposée au cap. */
export function behind(lon: number, lat: number, headingDeg: number, distanceM: number): [number, number] {
  const h = (headingDeg * Math.PI) / 180;
  const dLat = (-Math.cos(h) * distanceM) / M_PER_DEG;
  const dLon = (-Math.sin(h) * distanceM) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

/**
 * Cap Cesium d'un modèle : un modèle glTF regarde l'est au cap 0 et le cap
 * Cesium tourne dans le sens horaire ; un cap boussole (0 = nord) se décale
 * donc de -90°.
 */
export const cesiumHeading = (compassDeg: number) => ((compassDeg - 90) * Math.PI) / 180;
