import type { TrackSessionKind, TrackSettings } from "@fourmy/contracts";

/**
 * Découpage d'une trace GPS en parcours (docs/parcours-attelages-design.md
 * §4.1, FR-GPS-11). Fonction pure et déterministe : les mêmes positions, dans
 * n'importe quel ordre, donnent les mêmes parcours.
 *
 * 1. État de chaque position : `work` si `working === true` ; sinon `move` si
 *    la vitesse dépasse `movingKmh` (vitesse absente : déduite de la distance
 *    au point voisin) ; sinon `idle`.
 * 2. Coupure : un écart de plus de `stopMin` entre deux positions, ou une
 *    suite `idle` de plus de `stopMin`, ferme la session en cours.
 * 3. Entre deux coupures : un passage `move` de moins de `stopMin` entre deux
 *    suites `work` est absorbé dans le travail (demi-tours, outil relevé) ;
 *    les autres suites `move` sont des déplacements (`transit`).
 *    Un arrêt court (`idle` de `stopMin` ou moins) au milieu reste dans la
 *    session voisine : avec le travail s'il touche une suite `work`, sinon
 *    avec le déplacement. Les arrêts en tête et en queue sont retirés.
 * 4. Filtre : moins de `minDurationMin` ou de `minDistanceM` → écartée.
 * 5. `toolHint` : valeur de `tool` la plus fréquente (égalité : ordre
 *    alphabétique), null si aucune.
 */

export interface TrackPosition {
  time: string;
  lon: number;
  lat: number;
  speedKmh: number | null;
  working: boolean | null;
  tool: string | null;
}

export interface SessionSpan {
  kind: TrackSessionKind;
  startedAt: string;
  stoppedAt: string;
  /** Indices (inclus) dans le tableau des positions triées par temps. */
  fromIndex: number;
  toIndex: number;
  positionCount: number;
  distanceM: number;
  toolHint: string | null;
}

export type SegmentSettings = Pick<TrackSettings, "stopMin" | "minDurationMin" | "minDistanceM" | "movingKmh">;

type State = "work" | "move" | "idle";

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance orthodromique (haversine), en mètres. */
export function haversineM(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const cmp = (a: string | number | boolean | null, b: string | number | boolean | null) => {
  const x = a === null ? "" : String(a);
  const y = b === null ? "" : String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Tri par instant ; à instant égal, ordre fixé par le contenu de la position
 * pour que le résultat ne dépende pas de l'ordre d'arrivée.
 */
export function sortPositions<P extends TrackPosition>(positions: readonly P[]): P[] {
  return positions
    .map((p) => ({ p, t: Date.parse(p.time) }))
    .sort(
      (a, b) =>
        a.t - b.t ||
        a.p.lon - b.p.lon ||
        a.p.lat - b.p.lat ||
        cmp(a.p.speedKmh, b.p.speedKmh) ||
        cmp(a.p.working, b.p.working) ||
        cmp(a.p.tool, b.p.tool),
    )
    .map((x) => x.p);
}

interface Run {
  state: State;
  from: number;
  to: number;
}

/** Positions triées → parcours (travail et déplacements). */
export function segmentSessions(positions: readonly TrackPosition[], settings: SegmentSettings): SessionSpan[] {
  const pts = sortPositions(positions);
  const n = pts.length;
  if (n === 0) return [];
  const t = pts.map((p) => Date.parse(p.time));
  const step = pts.map((p, i) => (i + 1 < n ? haversineM(p, pts[i + 1]!) : 0)); // vers le suivant
  const stopMs = settings.stopMin * 60_000;

  // 1. État de chaque position.
  const impliedKmh = (i: number) => {
    const j = i + 1 < n ? i : i - 1; // dernier point : segment précédent
    if (j < 0) return 0;
    const dt = t[j + 1]! - t[j]!;
    return dt > 0 ? (step[j]! / dt) * 3_600 : 0;
  };
  const state: State[] = pts.map((p, i) => {
    if (p.working === true) return "work";
    const kmh = p.speedKmh ?? impliedKmh(i);
    return kmh > settings.movingKmh ? "move" : "idle";
  });

  // 2. Coupures : écarts de temps, puis longues suites idle.
  const out: SessionSpan[] = [];
  let segStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || t[i]! - t[i - 1]! > stopMs) {
      for (const [a, b] of splitOnLongIdle(segStart, i - 1, state, t, stopMs)) {
        for (const run of runsOf(a, b, state, t, stopMs)) out.push(toSpan(run, pts, step));
      }
      segStart = i;
    }
  }

  // 4. Filtre.
  const minMs = settings.minDurationMin * 60_000;
  return out.filter((s) => Date.parse(s.stoppedAt) - Date.parse(s.startedAt) >= minMs && s.distanceM >= settings.minDistanceM);
}

/** Durée d'une suite [from, to] : jusqu'à la position suivante si elle suit sans coupure. */
const runMs = (from: number, to: number, t: readonly number[], end: number) => t[Math.min(to + 1, end)]! - t[from]!;

/** Découpe [from, to] aux suites idle de plus de stopMs, retire les idle de bord. */
function splitOnLongIdle(from: number, to: number, state: readonly State[], t: readonly number[], stopMs: number): [number, number][] {
  const parts: [number, number][] = [];
  let start = from;
  let i = from;
  while (i <= to) {
    if (state[i] !== "idle") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 <= to && state[j + 1] === "idle") j++;
    if (runMs(i, j, t, to) > stopMs) {
      if (i - 1 >= start) parts.push([start, i - 1]);
      start = j + 1;
    }
    i = j + 1;
  }
  if (start <= to) parts.push([start, to]);
  // Arrêts en tête et en queue : hors session.
  return parts
    .map(([a, b]): [number, number] => {
      while (a <= b && state[a] === "idle") a++;
      while (b >= a && state[b] === "idle") b--;
      return [a, b];
    })
    .filter(([a, b]) => a <= b);
}

/** Suites work / move d'un tronçon sans coupure (§4.1, étape 3). */
function runsOf(from: number, to: number, state: readonly State[], t: readonly number[], stopMs: number): Run[] {
  let runs: Run[] = [];
  for (let i = from; i <= to; i++) {
    const last = runs[runs.length - 1];
    if (last && last.state === state[i]) last.to = i;
    else runs.push({ state: state[i]!, from: i, to: i });
  }
  // Arrêts courts : rattachés au travail voisin, sinon au déplacement.
  runs = runs.map((r, k) => {
    if (r.state !== "idle") return r;
    const near = [runs[k - 1]?.state, runs[k + 1]?.state];
    return { ...r, state: near.includes("work") ? "work" : "move" };
  });
  runs = merge(runs);
  // Passages move courts entre deux suites work : absorbés.
  runs = runs.map((r, k) =>
    r.state === "move" && runs[k - 1]?.state === "work" && runs[k + 1]?.state === "work" && runMs(r.from, r.to, t, to) < stopMs
      ? { ...r, state: "work" as const }
      : r,
  );
  return merge(runs);
}

function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.state === r.state) last.to = r.to;
    else out.push({ ...r });
  }
  return out;
}

function toSpan(run: Run, pts: readonly TrackPosition[], step: readonly number[]): SessionSpan {
  let distanceM = 0;
  for (let i = run.from; i < run.to; i++) distanceM += step[i]!;
  const tools = new Map<string, number>();
  for (let i = run.from; i <= run.to; i++) {
    const tool = pts[i]!.tool;
    if (tool) tools.set(tool, (tools.get(tool) ?? 0) + 1);
  }
  const toolHint = [...tools].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0] ?? null;
  return {
    kind: run.state === "work" ? "work" : "transit",
    startedAt: pts[run.from]!.time,
    stoppedAt: pts[run.to]!.time,
    fromIndex: run.from,
    toIndex: run.to,
    positionCount: run.to - run.from + 1,
    distanceM: Math.round(distanceM * 10) / 10,
    toolHint,
  };
}

/* ------------------------------------------------------------------------ */

/** JSON aux clés triées (récursif), base du hash des réglages. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * `settings_hash` (design §2.4) : SHA-256 hexadécimal du JSON aux clés
 * triées. Implémentation pure (le domaine tourne aussi dans le navigateur et
 * sur le mobile, sans `node:crypto`) ; identique à
 * `createHash("sha256").update(json, "utf8").digest("hex")`.
 */
export function settingsHash(settings: TrackSettings | Record<string, unknown>): string {
  return sha256Hex(canonicalJson(settings));
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4) d'une chaîne encodée en UTF-8, en hexadécimal. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, r: number) => (x >>> r) | (x << (32 - r));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
