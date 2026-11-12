import type { TrackReplay } from "@fourmy/contracts";

/**
 * Routage tracteur (OSRM auto-hébergé, docker/osrm) : recalage des
 * déplacements sur la route pour le rejeu. Les positions arrivent toutes les
 * 5 minutes : entre deux points, la ligne droite traverse champs et maisons ;
 * le service « match » d'OSRM retrouve les routes empruntées.
 *
 * Sans `FOURMY_OSRM_URL`, ou si le service ne répond pas, la trace reste
 * telle que reçue : le recalage n'est qu'un embellissement du rejeu.
 */
export const OSRM_URL = process.env.FOURMY_OSRM_URL?.replace(/\/$/, "") || null;

type Sample = TrackReplay["samples"][number];
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Rayon de recherche autour d'un point GPS (m) : la précision d'un boîtier. */
const RADIUS_M = 30;
/** Points par requête : sous la limite `--max-matching-size` du service. */
const CHUNK = 400;
const R = 6_371_008.8;

const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: readonly [number, number], b: readonly [number, number]) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Matching = { geometry: { coordinates: [number, number][] }; legs: { distance: number }[] };
type MatchResponse = {
  code: string;
  matchings?: Matching[];
  tracepoints?: ({ matchings_index: number; waypoint_index: number } | null)[];
};

/**
 * Géométrie recalée d'une suite de points d'un déplacement, avec un instant
 * par sommet : les points GPS retenus servent d'ancres (leur instant, leur
 * distance cumulée le long des tronçons OSRM) et les sommets entre deux ancres
 * reçoivent un instant proportionnel à la distance parcourue.
 */
export function timeMatching(m: Matching, anchorTimes: number[]): [number, number, number][] {
  const g = m.geometry.coordinates;
  if (g.length < 2 || anchorTimes.length < 2) return [];
  // Distances cumulées : des ancres (tronçons OSRM) et des sommets (géométrie).
  const anchorD = [0];
  for (const leg of m.legs) anchorD.push(anchorD.at(-1)! + leg.distance);
  const vertexD = [0];
  for (let i = 1; i < g.length; i++) vertexD.push(vertexD[i - 1]! + distanceM(g[i - 1]!, g[i]!));
  const scale = anchorD.at(-1)! > 0 ? vertexD.at(-1)! / anchorD.at(-1)! : 1;
  const out: [number, number, number][] = [];
  let k = 0;
  for (let i = 0; i < g.length; i++) {
    const d = vertexD[i]!;
    while (k < anchorD.length - 2 && anchorD[k + 1]! * scale < d) k++;
    const d0 = anchorD[k]! * scale;
    const d1 = anchorD[k + 1]! * scale;
    const t0 = anchorTimes[k]!;
    const t1 = anchorTimes[k + 1]!;
    const t = d1 > d0 ? t0 + ((Math.min(Math.max(d, d0), d1) - d0) / (d1 - d0)) * (t1 - t0) : t0;
    // Instants strictement croissants : un sommet sans durée propre est sauté.
    if (!out.length || t > out.at(-1)![0]) out.push([t, g[i]![0], g[i]![1]]);
  }
  return out;
}

/** Recalage d'une suite de points (déplacement) ; null si OSRM ne trouve rien. */
async function matchRun(run: Sample[], base: string, fetchFn: Fetch): Promise<Sample[] | null> {
  const coords = run.map((s) => `${s[1].toFixed(6)},${s[2].toFixed(6)}`).join(";");
  const secs = run.map((s) => Math.round(Date.parse(s[0]) / 1000));
  // OSRM veut des instants croissants : deux points de la même seconde gardent le premier.
  for (let i = 1; i < secs.length; i++) if (secs[i]! < secs[i - 1]!) secs[i] = secs[i - 1]!;
  const url =
    `${base}/match/v1/driving/${coords}?geometries=geojson&overview=full&tidy=true&gaps=ignore` +
    `&timestamps=${secs.join(";")}&radiuses=${run.map(() => RADIUS_M).join(";")}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const body = (await res.json()) as MatchResponse;
  if (body.code !== "Ok" || !body.matchings?.length || !body.tracepoints) return null;
  const out: Sample[] = [];
  const covered: [number, number][] = [];
  body.matchings.forEach((m, mi) => {
    const anchors = body.tracepoints!.map((tp, i) => (tp && tp.matchings_index === mi ? { w: tp.waypoint_index, t: Date.parse(run[i]![0]) } : null)).filter((a) => a !== null);
    anchors.sort((a, b) => a.w - b.w);
    // `tidy` fusionne des points proches : une ancre par waypoint suffit.
    const times = anchors.filter((a, i) => i === 0 || a.w !== anchors[i - 1]!.w).map((a) => a.t);
    if (times.length !== m.legs.length + 1) return;
    const timed = timeMatching(m, times);
    if (timed.length < 2) return;
    covered.push([timed[0]![0], timed.at(-1)![0]]);
    for (const [t, lon, lat] of timed) out.push([new Date(t).toISOString(), lon, lat, false]);
  });
  if (!out.length) return null;
  // Points que le recalage n'a pas couverts (hors route, trou de signal) : gardés tels quels.
  for (const s of run) {
    const t = Date.parse(s[0]);
    if (!covered.some(([a, b]) => t >= a && t <= b)) out.push(s);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * Trace du rejeu avec ses déplacements recalés sur la route. Les plages au
 * travail (dans les parcelles) ne sont pas touchées.
 */
export async function snapTransit(samples: Sample[], base = OSRM_URL, fetchFn: Fetch = fetch): Promise<{ samples: Sample[]; runs: number; snapped: number }> {
  if (!base) return { samples, runs: 0, snapped: 0 };
  const out: Sample[] = [];
  let runs = 0;
  let snapped = 0;
  let i = 0;
  while (i < samples.length) {
    if (samples[i]![3] === true) {
      out.push(samples[i]!);
      i++;
      continue;
    }
    let j = i;
    while (j < samples.length && samples[j]![3] !== true) j++;
    const run = samples.slice(i, j);
    i = j;
    if (run.length < 2) {
      out.push(...run);
      continue;
    }
    runs++;
    let ok = true;
    const parts: Sample[] = [];
    for (let c = 0; c < run.length; c += CHUNK - 1) {
      const chunk = run.slice(c, c + CHUNK);
      if (chunk.length < 2) break;
      const m = await matchRun(chunk, base, fetchFn).catch(() => null);
      if (!m) {
        ok = false;
        break;
      }
      // Morceaux bout à bout : le point commun n'est gardé qu'une fois.
      parts.push(...m.filter((s) => !parts.length || s[0] > parts.at(-1)![0]));
    }
    if (ok && parts.length >= 2) {
      snapped++;
      out.push(...parts);
    } else out.push(...run);
  }
  return { samples: out, runs, snapped };
}
