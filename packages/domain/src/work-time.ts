/**
 * Temps de travaux d'une personne (docs/equipe-personnes-design.md §5) :
 * union des plages de ses interventions réalisées. Une heure passée sur deux
 * interventions qui se chevauchent compte une fois, partagée à parts égales
 * entre elles ; la somme des parts est donc égale au total, et toute
 * répartition (activité, procédure) retombe sur le total.
 */

/** Une plage de travail d'une intervention (millisecondes epoch, [from, to[). */
export interface WorkEntry {
  interventionId: string;
  from: number;
  to: number;
}

export interface WorkTime {
  totalS: number;
  /** Part de chaque intervention, en secondes (somme = totalS). */
  byIntervention: Map<string, number>;
}

/** Union des plages et part de chaque intervention, sur [from, to[ si donné. */
export function workTime(entries: readonly WorkEntry[], window?: { from: number; to: number }): WorkTime {
  const clipped = entries
    .map((e) => (window ? { ...e, from: Math.max(e.from, window.from), to: Math.min(e.to, window.to) } : e))
    .filter((e) => e.to > e.from);
  // Bornes triées ; à chaque segment élémentaire, les plages ouvertes se partagent sa durée.
  const events: { t: number; open: boolean; id: string }[] = [];
  for (const e of clipped) {
    events.push({ t: e.from, open: true, id: e.interventionId });
    events.push({ t: e.to, open: false, id: e.interventionId });
  }
  events.sort((a, b) => a.t - b.t || Number(a.open) - Number(b.open));
  const open = new Map<string, number>(); // intervention → plages ouvertes
  let openCount = 0;
  let last = 0;
  let totalMs = 0;
  const share = new Map<string, number>();
  for (const ev of events) {
    if (openCount > 0 && ev.t > last) {
      const d = ev.t - last;
      totalMs += d;
      // Une intervention qui a deux plages ouvertes en même temps ne compte qu'une fois.
      const ids = [...open.keys()];
      for (const id of ids) share.set(id, (share.get(id) ?? 0) + d / ids.length);
    }
    last = ev.t;
    if (ev.open) {
      open.set(ev.id, (open.get(ev.id) ?? 0) + 1);
      openCount++;
    } else {
      const n = (open.get(ev.id) ?? 1) - 1;
      if (n > 0) open.set(ev.id, n);
      else open.delete(ev.id);
      openCount--;
    }
  }
  return { totalS: totalMs / 1000, byIntervention: new Map([...share].map(([k, v]) => [k, v / 1000])) };
}

/** Durée travaillée par tranche ([from, to[, millisecondes), chacune calculée sur ses bornes. */
export function workTimeBuckets(entries: readonly WorkEntry[], buckets: readonly { key: string; from: number; to: number }[]): Record<string, number> {
  return Object.fromEntries(buckets.map((b) => [b.key, workTime(entries, b).totalS]));
}

// ---------------------------------------------------------------------------
// Fenêtres de la frise (heure de Paris)
// ---------------------------------------------------------------------------

/** Décalage de Paris (ms) à un instant donné : +1 h l'hiver, +2 h l'été. */
function parisOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** Minuit à Paris du jour AAAA-MM-JJ, en millisecondes epoch. */
export function parisMidnight(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // Deux passes : le décalage peut changer entre minuit UTC et minuit Paris.
  const first = guess - parisOffsetMs(guess);
  return guess - parisOffsetMs(first);
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export interface WorkWindow {
  from: number;
  to: number;
  /** Bornes en jours (AAAA-MM-JJ), fin exclue. */
  fromDay: string;
  toDay: string;
}

const windowOf = (fromDay: string, toDay: string): WorkWindow => ({ from: parisMidnight(fromDay), to: parisMidnight(toDay), fromDay, toDay });

/** Semaine du lundi au dimanche qui contient `day`. */
export function weekOf(day: string): WorkWindow {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // lundi = 0
  return windowOf(ymd(y, m, d - dow), ymd(y, m, d - dow + 7));
}

/** Mois civil qui contient `day`. */
export function monthOf(day: string): WorkWindow {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return windowOf(ymd(y, m, 1), ymd(y, m + 1, 1));
}

/** Les `n` mois civils jusqu'au mois de `day` inclus, du plus ancien au plus récent. */
export function lastMonths(day: string, n: number): (WorkWindow & { month: string })[] {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const w = windowOf(ymd(y, m - (n - 1 - i), 1), ymd(y, m - (n - 1 - i) + 1, 1));
    return { ...w, month: w.fromDay.slice(0, 7) };
  });
}

/** Fenêtre d'une campagne (dates de début et de fin incluses). */
export function campaignWindow(startsOn: string, stopsOn: string): WorkWindow {
  const [y, m, d] = stopsOn.split("-").map(Number) as [number, number, number];
  return windowOf(startsOn, ymd(y, m, d + 1));
}
