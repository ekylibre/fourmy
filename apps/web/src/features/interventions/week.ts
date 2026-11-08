import type { Intervention } from "@fourmy/contracts";

/**
 * Semaine de la frise (du lundi au dimanche), en jours locaux AAAA-MM-JJ.
 * Exigence INT-UI-4 : les vues des interventions suivent la semaine du jour
 * choisi sur la frise.
 */

const pad = (n: number) => String(n).padStart(2, "0");
/** Jour local d'une date (midi : pas de piège de changement d'heure). */
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const noon = (day: string) => new Date(`${day}T12:00:00`);

export function addDays(day: string, n: number): string {
  const d = noon(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

export interface Week {
  /** Lundi. */
  start: string;
  /** Dimanche. */
  end: string;
  /** Les sept jours, du lundi au dimanche. */
  days: string[];
}

export function weekOf(day: string): Week {
  const d = noon(day);
  const offset = (d.getDay() + 6) % 7; // lundi = 0 … dimanche = 6
  const start = addDays(day, -offset);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end: days[6]!, days };
}

/** « du 22 au 28 sept. 2025 », ou sur deux mois / deux ans. */
export function weekLabel(w: Week): string {
  const s = noon(w.start);
  const e = noon(w.end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const from = s.toLocaleDateString("fr-FR", { day: "numeric", ...(sameMonth ? {} : { month: "short" }), ...(sameYear ? {} : { year: "numeric" }) });
  const to = e.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  return `du ${from} au ${to}`;
}

/**
 * Créneaux d'une intervention, jour par jour : chaque période (une période
 * sur plusieurs jours apparaît chaque jour) ; une intervention planifiée sans
 * période apparaît à sa date prévue.
 */
export function slots(i: Intervention): { day: string; startedAt: string; stoppedAt: string | null }[] {
  if (i.periods.length === 0) {
    const at = i.startedAt ?? i.stoppedAt ?? i.createdAt;
    return [{ day: localDay(new Date(at)), startedAt: at, stoppedAt: null }];
  }
  return i.periods.flatMap((p) => {
    const first = localDay(new Date(p.startedAt));
    const last = localDay(new Date(p.stoppedAt));
    const out: { day: string; startedAt: string; stoppedAt: string | null }[] = [];
    for (let day = first; day <= last; day = addDays(day, 1)) out.push({ day, startedAt: p.startedAt, stoppedAt: p.stoppedAt });
    return out;
  });
}

/** L'intervention a-t-elle un créneau dans la semaine ? */
export function inWeek(i: Intervention, w: Week): boolean {
  return slots(i).some((s) => s.day >= w.start && s.day <= w.end);
}
