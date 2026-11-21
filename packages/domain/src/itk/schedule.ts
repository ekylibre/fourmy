import type { ItkAnchor, ItkContent, ItkStep } from "@fourmy/contracts";

/**
 * Dates des étapes d'un ITK (claudedocs/conception_assolement_itk.md §6) :
 * J±n du semis ou de la récolte, ou date fixe de l'année de récolte (ou de
 * celle d'avant), puis passages répétés. Une ancre absente donne une date
 * « à préciser » (null), jamais une date inventée (I4).
 */

const DAY_MS = 86_400_000;

/** AAAA-MM-JJ + n jours (calcul en UTC, sans heure). */
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function itkDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export interface ItkDates {
  /** Semis prévu (AAAA-MM-JJ) ; null : inconnu. */
  sowingOn: string | null;
  /** Récolte prévue ; null : inconnue. */
  harvestOn: string | null;
  /** Année de récolte (campagne, décision A5). */
  year: number;
}

/** Date d'une ancre ; null si l'ancre manque. */
export function anchorDate(anchor: ItkAnchor, dates: ItkDates): string | null {
  switch (anchor.kind) {
    case "sowing":
      return dates.sowingOn ? addDays(dates.sowingOn, anchor.offsetDays) : null;
    case "harvest":
      return dates.harvestOn ? addDays(dates.harvestOn, anchor.offsetDays) : null;
    case "date": {
      const y = dates.year + anchor.yearOffset;
      // 29 février d'une année non bissextile : 28.
      const md = anchor.monthDay === "02-29" && !isLeap(y) ? "02-28" : anchor.monthDay;
      return `${y}-${md}`;
    }
  }
}

export interface ScheduledOccurrence {
  /** Rang du passage (0 pour le premier). */
  occurrence: number;
  /** AAAA-MM-JJ ; null : à préciser. */
  on: string | null;
}

export interface ScheduledStep {
  step: ItkStep;
  occurrences: ScheduledOccurrence[];
  /** Ancre absente : l'étape n'entre ni dans le calendrier ni dans les pointes. */
  undated: boolean;
}

/** Dates de chaque étape et de chaque passage, dans l'ordre du temps (étapes à préciser à la fin). */
export function scheduleSteps(content: Pick<ItkContent, "steps">, dates: ItkDates): ScheduledStep[] {
  const scheduled = content.steps.map((step) => {
    const first = anchorDate(step.anchor, dates);
    const count = step.repeat?.count ?? 1;
    const every = step.repeat?.everyDays ?? 0;
    const occurrences = Array.from({ length: count }, (_, k) => ({ occurrence: k, on: first ? addDays(first, k * every) : null }));
    return { step, occurrences, undated: first === null };
  });
  return scheduled
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const da = a.s.occurrences[0]?.on;
      const db = b.s.occurrences[0]?.on;
      if (da && db && da !== db) return da < db ? -1 : 1;
      if (!da !== !db) return da ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ s }) => s);
}

/** Libellé court d'une ancre : « semis J-30 », « récolte J+3 », « 15/02 », « 20/09 (an -1) ». */
export function anchorLabel(anchor: ItkAnchor): string {
  const signed = (n: number) => (n === 0 ? "J0" : n > 0 ? `J+${n}` : `J${n}`);
  switch (anchor.kind) {
    case "sowing":
      return `semis ${signed(anchor.offsetDays)}`;
    case "harvest":
      return `récolte ${signed(anchor.offsetDays)}`;
    case "date": {
      const [m, d] = anchor.monthDay.split("-");
      return `${d}/${m}${anchor.yearOffset === -1 ? " (année précédente)" : ""}`;
    }
  }
}
