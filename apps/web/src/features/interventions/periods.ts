/**
 * Périodes de travail du formulaire, en heure locale (`YYYY-MM-DDTHH:mm`,
 * valeur d'un champ `datetime-local`) : durée, fin déduite d'une durée,
 * début déplacé en gardant la durée.
 */
export interface LocalPeriod {
  startedAt: string;
  stoppedAt: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const parse = (v: string): Date | null => {
  const d = new Date(v);
  return v.length >= 16 && !Number.isNaN(d.getTime()) ? d : null;
};
const format = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Durée en minutes ; null si une borne manque ou si la fin précède le début. */
export function durationMinutes(p: LocalPeriod): number | null {
  const a = parse(p.startedAt);
  const b = parse(p.stoppedAt);
  if (!a || !b) return null;
  const m = Math.round((b.getTime() - a.getTime()) / 60_000);
  return m >= 0 ? m : null;
}

/** Fin = début + durée (minutes). */
export function withDuration(p: LocalPeriod, minutes: number): LocalPeriod {
  const a = parse(p.startedAt);
  if (!a || !Number.isFinite(minutes) || minutes < 0) return p;
  return { ...p, stoppedAt: format(new Date(a.getTime() + Math.round(minutes) * 60_000)) };
}

/** Nouveau début ; la durée déjà saisie est gardée (la fin suit). */
export function withStart(p: LocalPeriod, startedAt: string): LocalPeriod {
  const minutes = durationMinutes(p);
  const next = { ...p, startedAt };
  return minutes === null ? next : withDuration(next, minutes);
}

/** « 2 h 30 », « 45 min », « 3 h ». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}

/** Lit « 2 », « 2,5 », « 2h30 », « 2 h 30 », « 45 min », « 1:15 » → minutes. */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m = /^(\d+(?:\.\d+)?)\s*(?:h)?$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d+)\s*(?:h|:)\s*(\d{1,2})\s*(?:min)?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)\s*min$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}
