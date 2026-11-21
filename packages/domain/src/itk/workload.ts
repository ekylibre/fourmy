import type { ItkContent, ItkStep, ItkWorkContext, WorkRateSource } from "@fourmy/contracts";
import { scheduleSteps } from "./schedule.js";

/**
 * Temps de travaux prévus (lot IT4, claudedocs/conception_assolement_itk.md
 * §8 et §15.3) : débit de chaque étape, heures au champ et sur la route,
 * kilomètres, cumuls et pointes par semaine. Pur, calculé dans le navigateur
 * sur le brouillon d'assolement ; rien d'inconnu n'est compté pour zéro (I4).
 */

export interface ResolvedRate {
  haH: number;
  source: WorkRateSource;
  /** Matériel ou ligne du barème d'où vient le débit (affichage). */
  label: string | null;
}

/** Matériels et intervenants d'une étape : attelage type déplié, sinon ceux de l'étape. */
export function stepStaffing(step: ItkStep, ctx: Pick<ItkWorkContext, "crewTemplates">) {
  const crew = step.staffing.crewTemplateId ? ctx.crewTemplates[step.staffing.crewTemplateId] : undefined;
  return crew ?? { equipmentIds: step.staffing.equipmentIds, personIds: step.staffing.personIds };
}

const scale = (haH: number, rateWidth: number | null, ownWidth: number | null) => (rateWidth && ownWidth ? (haH * ownWidth) / rateWidth : haH);

/**
 * Débit d'une étape (décision A15), par ordre de priorité : saisi ; observé
 * sur la ferme (même procédure et même matériel, ou repris de l'historique) ;
 * barème BCMA du matériel (mis à l'échelle de sa largeur) ou de l'étape ;
 * largeur du matériel × débit par mètre de la famille du barème ; sinon null.
 */
export function resolveWorkRate(step: ItkStep, ctx: Pick<ItkWorkContext, "crewTemplates" | "equipments" | "observed" | "machineryRates" | "familyPerMeter">): ResolvedRate | null {
  if (step.workRateHaH) return { haH: step.workRateHaH, source: "input", label: null };
  const { equipmentIds } = stepStaffing(step, ctx);
  const equipments = equipmentIds.map((id) => ctx.equipments.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e);
  // L'outil d'abord : le tracteur qui le porte n'a pas de débit propre.
  const tools = [...equipments.filter((e) => !e.carrier), ...equipments.filter((e) => e.carrier)];
  for (const e of tools) {
    const o = ctx.observed.find((x) => x.procedure === step.procedure && x.equipmentId === e.id);
    if (o) return { haH: o.haH, source: "observed", label: e.name };
  }
  if (step.evidence?.observedRateHaH) return { haH: step.evidence.observedRateHaH, source: "observed", label: null };
  for (const e of tools) {
    const r = e.machineryRateId ? ctx.machineryRates[e.machineryRateId] : undefined;
    if (r?.haH) return { haH: scale(r.haH, r.widthM, e.widthM), source: "bcma", label: r.label };
  }
  const own = step.staffing.machineryRateId ? ctx.machineryRates[step.staffing.machineryRateId] : undefined;
  if (own?.haH) return { haH: own.haH, source: "bcma", label: own.label };
  const perM = ctx.familyPerMeter[step.procedure];
  const wide = tools.find((e) => e.widthM);
  if (perM && wide) return { haH: wide.widthM! * perM, source: "width", label: wide.name };
  return null;
}

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Semaine ISO d'un jour (« 2027-W07 ») et son lundi. */
export function isoWeek(day: string): { week: string; monday: string } {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() || 7; // lundi = 1 … dimanche = 7
  const monday = new Date(d.getTime() - (dow - 1) * DAY_MS).toISOString().slice(0, 10);
  // Le jeudi de la semaine donne l'année ISO.
  const thursday = new Date(d.getTime() + (4 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return { week: `${year}-W${String(week).padStart(2, "0")}`, monday };
}

/** Une culture de l'assolement avec son itinéraire. */
export interface WorkloadItem {
  /** Affectation du brouillon. */
  id: string;
  /** Parcelle du brouillon (clé `p:` ou `n:`) et parcelle de base pour le trajet. */
  parcelKey: string;
  routeKey: string | null;
  areaM2: number;
  activityId: string;
  itineraryId: string;
  sowingOn: string | null;
  harvestOn: string | null;
  year: number;
}

export interface WorkloadLine {
  id: string | null;
  name: string;
  hours: number;
}

export interface WorkloadResult {
  fieldH: number;
  routeH: number;
  km: number;
  /** Matériels, intervenants (null : main-d'œuvre non nommée), procédures, activités. */
  byEquipment: WorkloadLine[];
  byPerson: WorkloadLine[];
  byProcedure: WorkloadLine[];
  byActivity: WorkloadLine[];
  /** Heures de main-d'œuvre par semaine ISO, comparées à la capacité des personnes de la ferme. */
  weeks: { week: string; monday: string; hours: number; capacity: number; over: boolean }[];
  /** Débits par source (étapes × cultures). */
  rateSources: Partial<Record<WorkRateSource, number>>;
  unknown: { rates: number; routes: number; dates: number };
}

const add = (m: Map<string, WorkloadLine>, id: string | null, name: string, h: number) => {
  const k = id ?? `~${name}`;
  const line = m.get(k) ?? { id, name, hours: 0 };
  line.hours += h;
  m.set(k, line);
};
const sorted = (m: Map<string, WorkloadLine>) => [...m.values()].map((l) => ({ ...l, hours: Math.round(l.hours * 10) / 10 })).sort((a, b) => b.hours - a.hours);

/**
 * Cumuls de l'assolement (FR-AS-23) : par passage daté, heures au champ
 * (surface × part / débit), journées de chantier (heures / journée de
 * travail), un aller-retour par journée ; heures réparties sur la plage de
 * l'étape pour les pointes.
 */
export function workload(items: readonly WorkloadItem[], ctx: ItkWorkContext, names: { activities: ReadonlyMap<string, string>; procedures: (code: string) => string }): WorkloadResult {
  const equipments = new Map<string, WorkloadLine>();
  const people = new Map<string, WorkloadLine>();
  const procedures = new Map<string, WorkloadLine>();
  const activities = new Map<string, WorkloadLine>();
  const daily = new Map<number, number>();
  const rateSources: WorkloadResult["rateSources"] = {};
  const unknown = { rates: 0, routes: 0, dates: 0 };
  let fieldH = 0;
  let routeH = 0;
  let km = 0;
  const equipmentName = new Map(ctx.equipments.map((e) => [e.id, e.name]));
  const personName = new Map(ctx.people.map((p) => [p.id, p.name]));

  for (const item of items) {
    const itk = ctx.itineraries[item.itineraryId];
    if (!itk) continue;
    const route = item.routeKey ? ctx.routes[item.routeKey] : undefined;
    for (const { step, occurrences } of scheduleSteps(itk.content as ItkContent, { sowingOn: item.sowingOn, harvestOn: item.harvestOn, year: item.year })) {
      const rate = resolveWorkRate(step, ctx);
      if (rate) rateSources[rate.source] = (rateSources[rate.source] ?? 0) + 1;
      else unknown.rates++;
      const staff = stepStaffing(step, ctx);
      for (const { on } of occurrences) {
        if (!on) {
          unknown.dates++;
          continue;
        }
        if (!rate) continue;
        const ha = (item.areaM2 * step.share) / 10_000;
        const field = ha / rate.haH;
        const days = Math.max(1, Math.ceil(field / ctx.settings.workdayHours));
        let road = 0;
        if (route) {
          road = (2 * days * route.durationS) / 3600;
          km += (2 * days * route.distanceM) / 1000;
        } else unknown.routes++;
        fieldH += field;
        routeH += road;
        const total = field + road;
        for (const id of staff.equipmentIds) add(equipments, id, equipmentName.get(id) ?? "Matériel", total);
        const crew = staff.personIds.length ? staff.personIds : [];
        for (const id of crew) add(people, id, personName.get(id) ?? "Intervenant", total);
        const unnamed = crew.length ? 0 : (step.staffing.people ?? 1);
        if (unnamed) add(people, null, "Main-d'œuvre non nommée", total * unnamed);
        add(procedures, step.procedure, names.procedures(step.procedure), total);
        add(activities, item.activityId, names.activities.get(item.activityId) ?? "Activité", total);
        // Pointes : heures de main-d'œuvre étalées sur la plage de l'étape.
        const labour = total * (crew.length || unnamed);
        const w = step.windowDays ?? 0;
        const start = dayNum(on) - w;
        for (let d = 0; d <= 2 * w; d++) daily.set(start + d, (daily.get(start + d) ?? 0) + labour / (2 * w + 1));
      }
    }
  }

  const capacity = Math.max(1, ctx.people.length) * ctx.settings.weeklyHoursPerPerson;
  const weekly = new Map<string, { week: string; monday: string; hours: number }>();
  for (const [d, h] of daily) {
    const { week, monday } = isoWeek(dayStr(d));
    const w = weekly.get(week) ?? { week, monday, hours: 0 };
    w.hours += h;
    weekly.set(week, w);
  }
  return {
    fieldH: Math.round(fieldH * 10) / 10,
    routeH: Math.round(routeH * 10) / 10,
    km: Math.round(km),
    byEquipment: sorted(equipments),
    byPerson: sorted(people),
    byProcedure: sorted(procedures),
    byActivity: sorted(activities),
    weeks: [...weekly.values()]
      .sort((a, b) => a.monday.localeCompare(b.monday))
      .map((w) => ({ ...w, hours: Math.round(w.hours * 10) / 10, capacity, over: w.hours > capacity })),
    rateSources,
    unknown,
  };
}

/** Heures par hectare d'un ITK (éditeur) : étape par étape, débit et sa source. */
export function itkPerHectare(content: Pick<ItkContent, "steps">, ctx: Parameters<typeof resolveWorkRate>[1]) {
  return content.steps.map((step) => {
    const rate = resolveWorkRate(step, ctx);
    const passes = step.repeat?.count ?? 1;
    return { stepId: step.id, rate, hoursPerHa: rate ? (step.share * passes) / rate.haH : null };
  });
}
