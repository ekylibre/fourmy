import { articulationOf } from "@fourmy/equipment-3d";
import type { ToolPose } from "./tool-nodes";
import type { ProcedureShape } from "@fourmy/contracts";
import { behind, headings, type Sample } from "./geometry";

/**
 * Rejeu 3D (claudedocs/conception_rejeu_3d_outils_paysage.md §5, §6) : état
 * de l'outil attelé (posé, relevé, replié) et bande travaillée derrière lui.
 * Fonctions pures : testables sans Cesium.
 */

export type ToolState = "work" | "headland" | "transport";
export interface ReplaySession {
  kind: "work" | "transit";
  from: string;
  to: string;
}

/** Changement d'état de l'outil, à l'instant `t` (ms). */
export interface StateChange {
  t: number;
  state: ToolState;
}

/** Sans parcours calculé : un arrêt du travail plus long que ceci compte comme un transport. */
const HEADLAND_MAX_MS = 120_000;
/**
 * Un arrêt du travail qui parcourt plus que ceci est un trajet (d'une parcelle
 * à l'autre), même à l'intérieur d'un parcours de travail : rampe repliée.
 * Un demi-tour en bout de champ fait moins de 200 m (05/10/2026 : 13 à 181 m ;
 * trajets entre parcelles : 1,8 et 2 km).
 */
export const HEADLAND_MAX_M = 300;

const M_PER_DEG = 111_320;
const dist = (a: Sample, b: Sample) => Math.hypot((b[1] - a[1]) * M_PER_DEG * Math.cos((a[2] * Math.PI) / 180), (b[2] - a[2]) * M_PER_DEG);

/**
 * Suite des états de l'outil : au travail ; pas au travail mais pendant un
 * parcours de travail et sur moins de 300 m (bout de champ, relevé) ; sinon
 * en transport (replié).
 */
export function stateChanges(samples: readonly Sample[], sessions?: readonly ReplaySession[]): StateChange[] {
  const work = (sessions ?? []).filter((s) => s.kind === "work").map((s) => [Date.parse(s.from), Date.parse(s.to)] as const);
  const raw: StateChange[] = samples.map((s) => {
    const t = Date.parse(s[0]);
    if (s[3] === true) return { t, state: "work" };
    if (sessions) return { t, state: work.some(([a, b]) => t >= a && t <= b) ? "headland" : "transport" };
    return { t, state: "headland" };
  });
  // Chaque arrêt du travail : trajet s'il est long en distance (ou, sans parcours, en durée), ou en bord de trace.
  let i = 0;
  while (i < raw.length) {
    if (raw[i]!.state !== "headland") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < raw.length && raw[j + 1]!.state === "headland") j++;
    let meters = i > 0 ? dist(samples[i - 1]!, samples[i]!) : 0;
    for (let k = i; k < j; k++) meters += dist(samples[k]!, samples[k + 1]!);
    if (j + 1 < samples.length) meters += dist(samples[j]!, samples[j + 1]!);
    const end = raw[j + 1]?.t ?? raw[j]!.t;
    const long = meters > HEADLAND_MAX_M || (!sessions && (end - raw[i]!.t > HEADLAND_MAX_MS || i === 0 || j === raw.length - 1));
    if (long) for (let k = i; k <= j; k++) raw[k]!.state = "transport";
    i = j + 1;
  }
  return raw.filter((c, i) => i === 0 || c.state !== raw[i - 1]!.state);
}

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Valeur animée à l'instant `t` : la cible de l'état courant, atteinte en
 * `durationMs` depuis la cible de l'état précédent (lissage smoothstep).
 */
export function animatedAt(changes: readonly StateChange[], t: number, durationMs: number, target: (s: ToolState) => number): number {
  if (!changes.length) return 0;
  // Dernier changement à t ou avant (recherche dichotomique).
  let lo = 0;
  let hi = changes.length - 1;
  if (t < changes[0]!.t) return target(changes[0]!.state);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (changes[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  const cur = changes[lo]!;
  const to = target(cur.state);
  if (lo === 0 || durationMs <= 0) return to;
  const from = target(changes[lo - 1]!.state);
  return from + (to - from) * smoothstep((t - cur.t) / durationMs);
}

/** Pose des nœuds articulés d'un outil à l'instant `t` : montée et bascule de `lift`, repliage des rampes. */
export function toolPose(template: string | null | undefined, changes: readonly StateChange[], t: number, durationMs: number): ToolPose | null {
  const a = articulationOf(template);
  if (!a) return null;
  const liftM = animatedAt(changes, t, durationMs, (s) => (s === "work" ? 0 : s === "headland" ? a.liftM.headland : a.liftM.transport));
  const up = animatedAt(changes, t, durationMs, (s) => (s === "work" ? 0 : 1));
  const fold = a.booms ? animatedAt(changes, t, durationMs, (s) => (s === "transport" ? 1 : 0)) : 0;
  return { liftM, pitchRad: (up * a.pitchDeg * Math.PI) / 180, fold };
}

/**
 * Durée d'un relevage, en temps de trace : 1,5 s réelle, mais au moins 0,4 s
 * à l'écran, sinon il paraît instantané en lecture accélérée (×60).
 */
export const transitionMs = (multiplier: number) => Math.max(1500, 400 * Math.abs(multiplier || 1));

// ---------------------------------------------------------------------------
// Bande travaillée
// ---------------------------------------------------------------------------

/** Couleur de la bande par forme de procédé (conception §6.2). */
export const SWATH_COLORS: Record<ProcedureShape, string> = {
  treatment: "#7B2CBF",
  fertilization: "#2A9D8F",
  sowing: "#E9C46A",
  work: "#E85D04",
  harvest: "#B5651D",
  maintenance: "#6C757D",
};

/** Forme de travail d'un outil sans intervention, d'après son gabarit. */
export function shapeOfTemplate(template: string | null | undefined): ProcedureShape {
  if (template === "mounted_sprayer" || template === "trailed_sprayer") return "treatment";
  if (template === "fertilizer_spreader") return "fertilization";
  if (template === "sower") return "sowing";
  return "work";
}

/** Outil attelé sur une période : de quoi placer et colorer la bande. */
export interface SwathTool {
  from: string;
  to: string;
  offsetM: number;
  workingWidthM?: number | null;
  shape?: ProcedureShape | null;
  template?: string | null;
}

/** Bande d'une passe : bords gauche et droit, instant de chaque paire (ms). */
export interface SwathStrip {
  color: string;
  widthM: number;
  times: number[];
  left: [number, number][];
  right: [number, number][];
}

/**
 * Bandes travaillées d'une trace : une par suite d'échantillons au travail de
 * même largeur et même outil, centrée derrière l'outil, de ±largeur/2 de part
 * et d'autre du cap. Largeur : boîtier, sinon fiche de l'outil, sinon
 * `defaultWidthM`. Au-delà de `maxPairs` paires, les points sont espacés.
 */
export function swathStrips(
  samples: readonly Sample[],
  tools: readonly SwathTool[],
  opts: { defaultWidthM?: number; extraOffsetM?: number; maxPairs?: number } = {},
): SwathStrip[] {
  const { defaultWidthM = 3, extraOffsetM = 1.5, maxPairs = 100_000 } = opts;
  const caps = headings(samples);
  const toolAt = (t: number) => tools.find((h) => t >= Date.parse(h.from) && t <= Date.parse(h.to)) ?? null;
  const strips: SwathStrip[] = [];
  let current: (SwathStrip & { key: string }) | null = null;
  const working = samples.filter((s) => s[3] === true).length;
  const stride = Math.max(1, Math.ceil(working / maxPairs));
  let seen = 0;
  samples.forEach((s, i) => {
    if (s[3] !== true) {
      current = null;
      return;
    }
    const t = Date.parse(s[0]);
    const tool = toolAt(t);
    const widthM = s[4] ?? tool?.workingWidthM ?? defaultWidthM;
    const color = SWATH_COLORS[tool?.shape ?? shapeOfTemplate(tool?.template)];
    const key = `${widthM}|${color}|${tool?.offsetM ?? 0}`;
    if (!current || current.key !== key) {
      current = { key, color, widthM, times: [], left: [], right: [] };
      strips.push(current);
      seen = 0;
    }
    // Espacement au-delà du plafond, sauf aux bouts de la passe.
    const last = samples[i + 1]?.[3] !== true;
    if (seen++ % stride !== 0 && !last) return;
    const h = caps[i]!;
    const [cLon, cLat] = behind(s[1], s[2], h, (tool?.offsetM ?? 0) + extraOffsetM);
    current.times.push(t);
    current.left.push(behind(cLon, cLat, h + 90, widthM / 2));
    current.right.push(behind(cLon, cLat, h - 90, widthM / 2));
  });
  return strips.filter((st) => st.times.length >= 2).map(({ color, widthM, times, left, right }) => ({ color, widthM, times, left, right }));
}

/** Écart toléré entre la fin d'un trajet et le début de l'attelage (et l'inverse). */
const TRANSIT_GAP_MS = 5 * 60_000;

/**
 * Période d'affichage d'un outil attelé : celle de l'intervention, étendue
 * aux trajets sur route qui la touchent (l'outil reste attelé pour aller au
 * champ et en revenir : rampe repliée en transport).
 */
export function hitchSpan(from: string, to: string, sessions: readonly ReplaySession[] | undefined): { from: string; to: string } {
  let [f, t] = [Date.parse(from), Date.parse(to)];
  const transits = (sessions ?? []).filter((s) => s.kind === "transit").map((s) => [Date.parse(s.from), Date.parse(s.to)] as const);
  for (const [a, b] of transits) {
    // Trajet qui commence avant l'attelage et finit peu avant (ou pendant) : l'aller.
    if (a < f && b >= f - TRANSIT_GAP_MS) f = a;
    // Trajet qui commence peu après (ou pendant) et finit après : le retour.
    if (b > t && a <= t + TRANSIT_GAP_MS) t = b;
  }
  return { from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}
