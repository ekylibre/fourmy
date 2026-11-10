import { MIN_PARCEL_PIXELS, STALE_AFTER_DAYS, USABLE_VALID_RATIO, type ParcelIndexStatus } from "@fourmy/contracts";

/**
 * Télédétection (docs/teledetection-design.md) : règles et séries, sans base
 * ni réseau. Les dates sont des jours ISO (AAAA-MM-JJ), comptés en UTC.
 */

const DAY_MS = 86_400_000;
export const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const isoDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => isoDay(dayNumber(iso) + days);
/** Même jour, `years` ans plus tôt (le 29 février devient le 28). */
export const minusYears = (iso: string, years: number) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y - years, m, 0)).getUTCDate();
  return `${y - years}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
};

/** Code EPSG de la zone UTM nord d'un point (WGS84). France métropolitaine : 32630 à 32632. */
export function utmEpsg(lon: number, lat: number): number {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < 0 || lat > 84) throw new Error("Point hors de l'hémisphère nord couvert par l'UTM");
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1);
  return 32600 + zone;
}

/** Part des pixels de la parcelle valides (0..1). */
export const validRatio = (validPx: number, parcelPx: number) => (parcelPx > 0 ? Math.min(1, validPx / parcelPx) : 0);
export const isUsable = (validPx: number, parcelPx: number) => parcelPx >= MIN_PARCEL_PIXELS && validRatio(validPx, parcelPx) >= USABLE_VALID_RATIO;

/** État affiché d'une parcelle à une date, d'après sa dernière valeur exploitable. */
export function parcelIndexStatus(parcelPx: number, lastUsableOn: string | null, at: string): { status: ParcelIndexStatus; ageDays: number | null } {
  if (parcelPx < MIN_PARCEL_PIXELS) return { status: "too_small", ageDays: null };
  if (!lastUsableOn) return { status: "none", ageDays: null };
  const ageDays = dayNumber(at) - dayNumber(lastUsableOn);
  return { status: ageDays > STALE_AFTER_DAYS ? "stale" : "ok", ageDays };
}

/**
 * Lissage de Whittaker (différences d'ordre 2) sur une grille régulière :
 * minimise Σ wᵢ(yᵢ − zᵢ)² + λ Σ (Δ²z)². Les jours sans mesure ont un poids
 * nul et sont interpolés. Résolution par Cholesky en bande (largeur 2), O(n).
 */
export function whittaker(y: number[], w: number[], lambda: number): number[] {
  const n = y.length;
  if (n !== w.length) throw new Error("y et w de longueurs différentes");
  if (n === 0) return [];
  if (n < 3) return y.map((v, i) => (w[i]! > 0 ? v : NaN));
  // Matrice A = W + λ DᵀD, symétrique pentadiagonale : diagonales a0, a1, a2.
  const a0 = new Float64Array(n);
  const a1 = new Float64Array(n);
  const a2 = new Float64Array(n);
  for (let k = 0; k < n - 2; k++) {
    // Ligne de D : [1, −2, 1] sur k, k+1, k+2.
    const c = [1, -2, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = i; j < 3; j++) {
        const v = lambda * c[i]! * c[j]!;
        const d = j - i;
        if (d === 0) a0[k + i]! += v;
        else if (d === 1) a1[k + i]! += v;
        else a2[k + i]! += v;
      }
    }
  }
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a0[i]! += w[i]!;
    b[i] = w[i]! * y[i]!;
  }
  // Cholesky LDLᵀ en bande.
  const d = new Float64Array(n);
  const l1 = new Float64Array(n);
  const l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let di = a0[i]!;
    if (i >= 1) di -= l1[i - 1]! * l1[i - 1]! * d[i - 1]!;
    if (i >= 2) di -= l2[i - 2]! * l2[i - 2]! * d[i - 2]!;
    if (!(di > 0)) throw new Error("Système de lissage singulier");
    d[i] = di;
    if (i + 1 < n) {
      let v = a1[i]!;
      if (i >= 1) v -= l1[i - 1]! * l2[i - 1]! * d[i - 1]!;
      l1[i] = v / di;
    }
    if (i + 2 < n) l2[i] = a2[i]! / di;
  }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = b[i]!;
    if (i >= 1) v -= l1[i - 1]! * z[i - 1]!;
    if (i >= 2) v -= l2[i - 2]! * z[i - 2]!;
    z[i] = v;
  }
  for (let i = 0; i < n; i++) z[i]! /= d[i]!;
  for (let i = n - 1; i >= 0; i--) {
    let v = z[i]!;
    if (i + 1 < n) v -= l1[i]! * z[i + 1]!;
    if (i + 2 < n) v -= l2[i]! * z[i + 2]!;
    z[i] = v;
  }
  return Array.from(z);
}

export interface SeriesPoint {
  date: string;
  value: number;
}

/**
 * Courbe lissée journalière entre la première et la dernière mesure, dans la
 * fenêtre. Moins de 3 mesures : pas de courbe (on n'extrapole pas).
 * λ = 50 : suit une levée de maïs en 3 semaines sans épouser le bruit d'un passage.
 */
export function smoothDaily(points: SeriesPoint[], opts: { from: string; to: string; lambda?: number }): SeriesPoint[] {
  const inWindow = points
    .filter((p) => Number.isFinite(p.value) && p.date >= opts.from && p.date <= opts.to)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(inWindow.map((p) => p.date)).size < 3) return [];
  const start = dayNumber(inWindow[0]!.date);
  const end = dayNumber(inWindow[inWindow.length - 1]!.date);
  const n = end - start + 1;
  const y = new Array<number>(n).fill(0);
  const w = new Array<number>(n).fill(0);
  for (const p of inWindow) {
    const i = dayNumber(p.date) - start;
    // Deux mesures le même jour (recouvrement d'orbites) : moyenne.
    y[i] = w[i] ? (y[i]! * w[i]! + p.value) / (w[i]! + 1) : p.value;
    w[i] = w[i]! + 1;
  }
  const z = whittaker(y, w, opts.lambda ?? 50);
  return z.map((value, i) => ({ date: isoDay(start + i), value: Math.round(value * 1000) / 1000 }));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Référence des années précédentes : la fenêtre [from, to] décalée de 1 à
 * `maxYears` ans, lissée année par année, puis médiane jour par jour. Une
 * année ne compte que si sa courbe couvre la date.
 */
export function referenceCurve(
  points: SeriesPoint[],
  opts: { from: string; to: string; maxYears?: number; lambda?: number },
): { curve: { date: string; median: number; years: number }[]; years: number[] } {
  const byDate = new Map<string, number[]>();
  const years: number[] = [];
  for (let k = 1; k <= (opts.maxYears ?? 5); k++) {
    const from = minusYears(opts.from, k);
    const to = minusYears(opts.to, k);
    const smoothed = smoothDaily(points, { from, to, lambda: opts.lambda });
    if (smoothed.length === 0) continue;
    years.push(Number(to.slice(0, 4)));
    const shift = dayNumber(opts.from) - dayNumber(from);
    for (const p of smoothed) {
      const date = isoDay(dayNumber(p.date) + shift);
      if (date > opts.to) continue;
      const list = byDate.get(date) ?? [];
      list.push(p.value);
      byDate.set(date, list);
    }
  }
  const curve = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, median: Math.round(median(values) * 1000) / 1000, years: values.length }));
  return { curve, years: years.sort() };
}

/** Taille (px) d'une image d'emprise à ~10 m, plafonnée à `max` côté le plus long. */
export function imageSize(bbox: [number, number, number, number], metersPerPixel = 10, max = 2500): { width: number; height: number } {
  const [west, south, east, north] = bbox;
  const lat = ((south + north) / 2) * (Math.PI / 180);
  const wm = (east - west) * 111_320 * Math.cos(lat);
  const hm = (north - south) * 110_574;
  let width = Math.max(1, Math.round(wm / metersPerPixel));
  let height = Math.max(1, Math.round(hm / metersPerPixel));
  const scale = Math.max(width, height) / max;
  if (scale > 1) {
    width = Math.max(1, Math.round(width / scale));
    height = Math.max(1, Math.round(height / scale));
  }
  return { width, height };
}

export interface CoverLossEvent {
  from: string;
  to: string;
  high: number;
  low: number;
  confirmed: boolean;
}

/**
 * Chutes du couvert d'une parcelle (lot Z) : une mesure exploitable ≥ `high`,
 * puis, au plus `maxDays` jours après, une mesure ≤ `low`. La chute est
 * **confirmée** si la mesure suivante (dans `confirmDays`) reste sous
 * `low + 0,1` ; si elle remonte, c'était un creux (ombre, nuage résiduel) et
 * la chute est écartée ; sans mesure suivante, elle reste à confirmer.
 * Ensuite, il faut repasser au-dessus de `high` pour une nouvelle chute.
 */
export function coverLossEvents(
  points: SeriesPoint[],
  opts: { high: number; low: number; maxDays: number; confirmDays: number },
): CoverLossEvent[] {
  const pts = points.filter((p) => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const events: CoverLossEvent[] = [];
  let lastHigh: SeriesPoint | null = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.value >= opts.high) {
      lastHigh = p;
      continue;
    }
    if (!lastHigh || p.value > opts.low) continue;
    if (dayNumber(p.date) - dayNumber(lastHigh.date) > opts.maxDays) {
      lastHigh = null;
      continue;
    }
    const next = pts[i + 1];
    const followed = next && dayNumber(next.date) - dayNumber(p.date) <= opts.confirmDays ? next : undefined;
    if (followed && followed.value > opts.low + 0.1) continue; // simple creux : on garde le haut précédent
    events.push({ from: lastHigh.date, to: p.date, high: lastHigh.value, low: p.value, confirmed: followed !== undefined });
    lastHigh = null;
  }
  return events;
}

/** Une intervention saisie entre `from − beforeDays` et `to + afterDays` explique la chute. */
export const explainsCoverLoss = (e: { from: string; to: string }, interventionDays: string[], opts: { beforeDays: number; afterDays: number }) =>
  interventionDays.some((d) => d >= addDays(e.from, -opts.beforeDays) && d <= addDays(e.to, opts.afterDays));
