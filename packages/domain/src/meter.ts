/**
 * Compteurs des matériels (docs/materiels-entretien-design.md §3.1) :
 * contrôle d'un relevé, échelle continue des heures d'usage, heures d'usage
 * à une date. Fonctions pures, partagées par l'API, le web et le mobile.
 *
 * - Un relevé `fix` corrige une saisie fausse : les relevés antérieurs plus
 *   élevés que lui sont écartés (« remplacés »).
 * - Un relevé `replacement` signale un compteur neuf : sa valeur est le point
 *   de départ du nouveau compteur, l'échelle d'usage continue.
 */

export type MeterCorrection = "fix" | "replacement";

export interface MeterReadingLike {
  id: string;
  readAt: string;
  value: number;
  correction?: MeterCorrection | null;
  correctionReason?: string | null;
}

export interface UsagePoint<R extends MeterReadingLike = MeterReadingLike> {
  reading: R;
  /** Heures d'usage cumulées depuis le premier relevé (échelle continue). */
  usage: number;
  /** `superseded` : écarté par une correction postérieure. */
  status: "valid" | "superseded";
}

const time = (r: MeterReadingLike) => Date.parse(r.readAt);
const byTime = <R extends MeterReadingLike>(a: R, b: R) => time(a) - time(b) || a.id.localeCompare(b.id);

/** Relevés → échelle d'usage continue (ordre chronologique). */
export function usageSeries<R extends MeterReadingLike>(readings: readonly R[]): UsagePoint<R>[] {
  const sorted = [...readings].sort(byTime);
  const status = new Map<string, UsagePoint["status"]>();
  // Par segment de compteur : pile des relevés valides.
  let stack: R[] = [];
  for (const r of sorted) {
    if (r.correction === "replacement") {
      stack = [r];
    } else if (r.correction === "fix") {
      while (stack.length > 1 && stack[stack.length - 1]!.value > r.value) status.set(stack.pop()!.id, "superseded");
      if (stack.length === 1 && stack[0]!.value > r.value && stack[0]!.correction !== "replacement") {
        status.set(stack.pop()!.id, "superseded");
      }
      stack.push(r);
    } else {
      stack.push(r);
    }
    status.set(r.id, status.get(r.id) ?? "valid");
  }
  const out: UsagePoint<R>[] = [];
  let offset = 0; // usage au départ du segment courant
  let segmentStart: number | null = null;
  let last: UsagePoint<R> | null = null;
  for (const r of sorted) {
    if (status.get(r.id) === "superseded") {
      out.push({ reading: r, usage: last?.usage ?? 0, status: "superseded" });
      continue;
    }
    if (segmentStart === null) segmentStart = r.value;
    if (r.correction === "replacement" && last) {
      offset = last.usage;
      segmentStart = r.value;
    } else if (!last) {
      offset = r.value;
      segmentStart = r.value;
    }
    const point: UsagePoint<R> = { reading: r, usage: offset + (r.value - segmentStart), status: "valid" };
    out.push(point);
    last = point;
  }
  return out;
}

export type ReadingCheck =
  | { ok: true; warning?: { code: "too_fast"; neighbour: MeterReadingLike; hours: number } }
  | { ok: false; code: "below_previous" | "above_next" | "reason_required"; neighbour?: MeterReadingLike };

/**
 * Contrôle d'un nouveau relevé (FR-MAT-12) : il doit rester entre le relevé
 * valide précédent et le suivant, même saisi après coup. Une correction
 * motivée passe toujours. Un compteur qui avance plus vite que l'horloge est
 * signalé (faute de frappe probable), sans être refusé.
 */
export function checkReading(existing: readonly MeterReadingLike[], next: MeterReadingLike): ReadingCheck {
  if (next.correction && !next.correctionReason?.trim()) return { ok: false, code: "reason_required" };
  if (next.correction) return { ok: true };
  const valid = usageSeries(existing.filter((r) => r.id !== next.id))
    .filter((p) => p.status === "valid")
    .map((p) => p.reading);
  const t = time(next);
  const before = valid.filter((r) => time(r) <= t);
  const prev = before[before.length - 1];
  const after = valid.find((r) => time(r) > t);
  if (prev && next.value < prev.value) return { ok: false, code: "below_previous", neighbour: prev };
  if (after && after.correction !== "replacement" && next.value > after.value) return { ok: false, code: "above_next", neighbour: after };
  if (prev) {
    const elapsedH = (t - time(prev)) / 3_600_000;
    const hours = next.value - prev.value;
    if (hours > elapsedH + 1) return { ok: true, warning: { code: "too_fast", neighbour: prev, hours } };
  }
  return { ok: true };
}

export interface UsageAt<R extends MeterReadingLike = MeterReadingLike> {
  usage: number | null;
  /**
   * `read` : relevé à cet instant ; `interpolated` : entre deux relevés ;
   * `after` : dernier relevé ; `estimated` : dernier relevé + heures estimées
   * depuis (Traccar).
   */
  kind: "read" | "interpolated" | "after" | "estimated" | "unknown";
  since?: R;
  /** Heures estimées ajoutées au dernier relevé. */
  estimatedHours?: number;
}

/** Heures de fonctionnement estimées d'un jour (AAAA-MM-JJ, heure de Paris). */
export interface UsageDay {
  day: string;
  hours: number;
}

export const parisDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));

/**
 * Heures d'usage à une date : interpolation linéaire entre deux relevés
 * valides ; après le dernier relevé, + heures estimées des jours suivants
 * (recalage automatique : un nouveau relevé réel repart de sa valeur).
 */
export function usageAt<R extends MeterReadingLike>(series: readonly UsagePoint<R>[], at: string, usageDays: readonly UsageDay[] = []): UsageAt<R> {
  const valid = series.filter((p) => p.status === "valid");
  const t = Date.parse(at);
  let prev: UsagePoint<R> | undefined;
  for (const p of valid) {
    const pt = time(p.reading);
    if (pt === t) return { usage: p.usage, kind: "read", since: p.reading };
    if (pt > t) {
      if (!prev) return { usage: null, kind: "unknown" };
      const t0 = time(prev.reading);
      const ratio = (t - t0) / (pt - t0);
      return { usage: Math.round((prev.usage + ratio * (p.usage - prev.usage)) * 10) / 10, kind: "interpolated", since: prev.reading };
    }
    prev = p;
  }
  if (!prev) return { usage: null, kind: "unknown" };
  const from = parisDay(prev.reading.readAt);
  const to = parisDay(at);
  const extra = usageDays.filter((d) => d.day > from && d.day <= to).reduce((s, d) => s + d.hours, 0);
  if (extra > 0) return { usage: Math.round((prev.usage + extra) * 10) / 10, kind: "estimated", since: prev.reading, estimatedHours: Math.round(extra * 10) / 10 };
  return { usage: prev.usage, kind: "after", since: prev.reading };
}

export interface PositionLike {
  time: string;
  speedKmh: number | null;
  working: boolean | null;
}

/**
 * Durée de fonctionnement par jour, déduite des positions d'un boîtier sans
 * compteur (FR-MAT-13) : somme des écarts entre positions consécutives quand
 * le matériel roule (> 1 km/h) ou travaille ; chaque écart plafonné (5 min)
 * pour ne pas compter un trou de transmission.
 */
export function operatingHoursByDay(positions: readonly PositionLike[], opts: { maxGapMin?: number; minSpeedKmh?: number } = {}): UsageDay[] {
  const maxGap = (opts.maxGapMin ?? 5) * 60_000;
  const minSpeed = opts.minSpeedKmh ?? 1;
  const sorted = [...positions].sort((a, b) => a.time.localeCompare(b.time));
  const byDay = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const active = (p: PositionLike) => p.working === true || (p.speedKmh ?? 0) > minSpeed;
    if (!active(a) && !active(b)) continue;
    const gap = Math.min(Date.parse(b.time) - Date.parse(a.time), maxGap);
    if (gap <= 0) continue;
    const day = parisDay(a.time);
    byDay.set(day, (byDay.get(day) ?? 0) + gap / 3_600_000);
  }
  return [...byDay].map(([day, hours]) => ({ day, hours: Math.min(24, Math.round(hours * 100) / 100) })).sort((x, y) => x.day.localeCompare(y.day));
}

/**
 * Écart entre un relevé réel et l'estimation à son instant (FR-MAT-14) :
 * signalé au-delà de 10 h ou de 10 % des heures estimées depuis le relevé
 * précédent.
 */
export function estimateGap<R extends MeterReadingLike>(
  series: readonly UsagePoint<R>[],
  usageDays: readonly UsageDay[],
  reading: { id: string; readAt: string; usage: number },
): { estimated: number; estimatedHours: number; gap: number; flagged: boolean } | null {
  const before = series.filter((p) => p.reading.id !== reading.id && p.status === "valid" && p.reading.readAt < reading.readAt);
  const est = usageAt(before, reading.readAt, usageDays);
  if (est.kind !== "estimated" || est.usage === null) return null;
  const gap = Math.round((reading.usage - est.usage) * 10) / 10;
  return { estimated: est.usage, estimatedHours: est.estimatedHours ?? 0, gap, flagged: Math.abs(gap) > Math.max(10, 0.1 * (est.estimatedHours ?? 0)) };
}

/** Message lisible d'un refus de relevé. */
export function readingCheckMessage(check: ReadingCheck, format: (v: number) => string = (v) => `${v} h`): string | null {
  if (check.ok) return null;
  const n = check.neighbour;
  const when = n ? new Date(n.readAt).toLocaleDateString("fr-FR") : "";
  switch (check.code) {
    case "reason_required":
      return "Une correction de compteur doit être motivée.";
    case "below_previous":
      return `Valeur inférieure au relevé du ${when} (${format(n!.value)}). S'il s'agit d'une erreur ou d'un compteur remplacé, saisissez une correction motivée.`;
    case "above_next":
      return `Valeur supérieure au relevé suivant du ${when} (${format(n!.value)}).`;
  }
}
