/**
 * Échéances d'entretien (docs/materiels-entretien-design.md §3.2) : calculées
 * à une date, jamais stockées. Fonctions pures, partagées par l'API, le web
 * et le mobile ; rejouables à n'importe quelle date (NFR-MAT-5).
 *
 * - Périodicité en heures et/ou en mois, au premier terme atteint.
 * - Dernière réalisation : intervention réalisée, sinon « dernière fois
 *   connue » saisie, sinon mise en service.
 * - Visite initiale (`firstHours`) : une seule fois, depuis la mise en service.
 */
import { usageAt, type UsagePoint } from "./meter.js";

export interface PlanOperationLike {
  id: string;
  everyHours?: number | null;
  everyMonths?: number | null;
  firstHours?: number | null;
  baselineAt?: string | null;
  baselineHours?: number | null;
  requiresOption?: string | null;
  archivedAt?: string | null;
  archivedReason?: string | null;
}

export interface Completion {
  operationId: string;
  at: string;
  /** Heures d'usage relevées par l'intervention, si connues. */
  usage: number | null;
}

export interface MountedOption {
  code: string;
  from: string;
  to: string | null;
}

export interface DueContext {
  completions: readonly Completion[];
  series: readonly UsagePoint[];
  options: readonly MountedOption[];
  commissionedAt: string | null;
  at: string;
  soonHours: number;
  soonMonths: number;
}

export type DueStatus = "overdue" | "soon" | "ok" | "unknown" | "on_demand" | "done" | "not_applicable";

export interface Due {
  operationId: string;
  status: DueStatus;
  last: { at: string; usage: number | null; source: "intervention" | "baseline" | "commissioning" } | null;
  nextUsage: number | null;
  nextDate: string | null;
  remainingHours: number | null;
  remainingDays: number | null;
  usageNow: number | null;
  /** Explication affichée (« sans relevé : échéance par la date seule »). */
  reason: string | null;
}

const DAY = 86_400_000;

/** Date + n mois (fin de mois tronquée : 31/01 + 1 mois = 28 ou 29/02). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes()));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString();
}

const optionMounted = (options: readonly MountedOption[], code: string, at: string) =>
  options.some((o) => o.code === code && o.from <= at && (!o.to || o.to > at));

/** Heures d'usage d'une réalisation : relevée, sinon interpolée entre deux relevés. */
function completionUsage(c: Completion, series: readonly UsagePoint[]): number | null {
  if (c.usage !== null) return c.usage;
  const u = usageAt(series, c.at);
  return u.kind === "read" || u.kind === "interpolated" ? u.usage : null;
}

export function computeDue(op: PlanOperationLike, ctx: DueContext): Due {
  const base: Due = { operationId: op.id, status: "unknown", last: null, nextUsage: null, nextDate: null, remainingHours: null, remainingDays: null, usageNow: null, reason: null };
  if (op.archivedAt && op.archivedAt <= ctx.at) return { ...base, status: "not_applicable", reason: op.archivedReason ?? "Retirée du plan." };
  if (op.requiresOption && !optionMounted(ctx.options, op.requiresOption, ctx.at)) {
    return { ...base, status: "not_applicable", reason: "Option non montée à cette date." };
  }
  const now = usageAt(ctx.series, ctx.at);
  const usageNow = now.usage;
  base.usageNow = usageNow;

  // Dernière réalisation connue à la date.
  const done = ctx.completions.filter((c) => c.operationId === op.id && c.at <= ctx.at).sort((a, b) => a.at.localeCompare(b.at));
  const lastDone = done[done.length - 1];
  let last: Due["last"] = lastDone ? { at: lastDone.at, usage: completionUsage(lastDone, ctx.series), source: "intervention" } : null;
  if (op.baselineAt && op.baselineAt <= ctx.at && (!last || op.baselineAt > last.at)) {
    last = { at: op.baselineAt, usage: op.baselineHours ?? completionUsage({ operationId: op.id, at: op.baselineAt, usage: null }, ctx.series), source: "baseline" };
  }
  base.last = last;

  const periodic = !!(op.everyHours || op.everyMonths);
  // Visite initiale ou opération ponctuelle.
  if (!periodic) {
    if (!op.firstHours) return { ...base, status: "on_demand", reason: "Selon besoin." };
    if (last) return { ...base, status: "done" };
    const firstKnown = ctx.series.find((p) => p.status === "valid");
    if (firstKnown && firstKnown.usage > op.firstHours) {
      return { ...base, status: "not_applicable", reason: "Visite antérieure au premier relevé connu." };
    }
    return finish(base, op.firstHours, null, usageNow, ctx);
  }

  if (!last && ctx.commissionedAt && ctx.commissionedAt <= ctx.at) {
    last = { at: ctx.commissionedAt, usage: 0, source: "commissioning" };
    base.last = last;
  }
  if (!last) return { ...base, status: "unknown", reason: "Dernière réalisation à renseigner." };

  const nextUsage = op.everyHours && last.usage !== null ? last.usage + op.everyHours : null;
  const nextDate = op.everyMonths ? addMonths(last.at, op.everyMonths) : null;
  const due = finish(base, nextUsage, nextDate, usageNow, ctx);
  if (op.everyHours && last.usage === null) {
    due.reason = nextDate ? "Sans relevé à la dernière réalisation : échéance par la date seule." : "Sans relevé à la dernière réalisation : saisissez les heures.";
    if (!nextDate) due.status = "unknown";
  }
  return due;
}

function finish(base: Due, nextUsage: number | null, nextDate: string | null, usageNow: number | null, ctx: DueContext): Due {
  const remainingHours = nextUsage !== null && usageNow !== null ? Math.round((nextUsage - usageNow) * 10) / 10 : null;
  const remainingDays = nextDate ? Math.floor((Date.parse(nextDate) - Date.parse(ctx.at)) / DAY) : null;
  let status: DueStatus;
  if ((remainingHours !== null && remainingHours < 0) || (remainingDays !== null && remainingDays < 0)) status = "overdue";
  else if ((remainingHours !== null && remainingHours <= ctx.soonHours) || (remainingDays !== null && remainingDays <= ctx.soonMonths * 30)) status = "soon";
  else if (remainingHours === null && remainingDays === null) status = "unknown";
  else status = "ok";
  const reason = status === "unknown" && nextUsage !== null && usageNow === null ? "Aucun relevé de compteur." : null;
  return { ...base, status, nextUsage, nextDate, remainingHours, remainingDays, reason };
}

const RANK: Record<DueStatus, number> = { overdue: 0, soon: 1, unknown: 2, ok: 3, on_demand: 4, done: 5, not_applicable: 6 };

/**
 * Tri par urgence (FR-MAT-24) : en retard, bientôt, à renseigner, à jour ;
 * à état égal, la part de périodicité restante la plus faible d'abord.
 */
export function compareDues(a: { due: Due; op: PlanOperationLike }, b: { due: Due; op: PlanOperationLike }): number {
  const r = RANK[a.due.status] - RANK[b.due.status];
  if (r) return r;
  return urgency(a) - urgency(b);
}

function urgency({ due, op }: { due: Due; op: PlanOperationLike }): number {
  const parts: number[] = [];
  if (due.remainingHours !== null) parts.push(due.remainingHours / (op.everyHours || op.firstHours || 1));
  if (due.remainingDays !== null && op.everyMonths) parts.push(due.remainingDays / (op.everyMonths * 30));
  return parts.length ? Math.min(...parts) : Number.POSITIVE_INFINITY;
}

/** Texte court d'une échéance : « dans 38 h ou le 12/01/2027 », « en retard de 12 h ». */
export function dueLabel(due: Due): string {
  const date = due.nextDate ? new Date(due.nextDate).toLocaleDateString("fr-FR") : null;
  const h = (v: number) => `${Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} h`;
  switch (due.status) {
    case "not_applicable":
      return "Non applicable";
    case "on_demand":
      return "Selon besoin";
    case "done":
      return "Réalisée";
    case "unknown":
      return due.reason ?? "À renseigner";
    default: {
      const parts: string[] = [];
      if (due.remainingHours !== null) parts.push(due.remainingHours < 0 ? `dépassée de ${h(due.remainingHours)}` : `dans ${h(due.remainingHours)}`);
      if (date) parts.push(due.remainingDays !== null && due.remainingDays < 0 ? `prévue le ${date}` : `le ${date}`);
      return parts.join(" ou ");
    }
  }
}
