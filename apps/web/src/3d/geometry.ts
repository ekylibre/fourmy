import { circleInside, outerRing, ringCentroid, toLocal, type Pt } from "@fourmy/domain";
import type { GeoJsonGeometry } from "@fourmy/contracts";

/** Échantillon de trace : [instant ISO, longitude, latitude, au travail ?]. */
export type Sample = [string, number, number, boolean | null];

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
