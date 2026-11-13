import {
  getProcedure,
  isIrrigation,
  type ActivityItinerary,
  type ItineraryDetail,
  type ItineraryLane,
  type ItineraryMark,
  type ItineraryStep,
  type TechnicalItinerary,
} from "@fourmy/contracts";
import { parisDay } from "./meter.js";

/**
 * Itinéraires techniques (claudedocs/conception_itineraires_techniques.md §3) :
 * couloirs, dates des cultures, rattachement des interventions aux étapes,
 * regroupement de la vue fusionnée. Fonctions pures, sans base ni réseau.
 */

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from));

/** Couloir d'une procédure ; null : hors itinéraire (entretien du matériel). */
export function laneOf(procedure: string, irrigation = false): ItineraryLane | null {
  const p = getProcedure(procedure);
  if (p.shape === "maintenance" || p.category === "equipment") return null;
  if (irrigation || isIrrigation(procedure)) return "inputs";
  if (p.shape === "fertilization" || p.shape === "treatment") return "inputs";
  // work, sowing, harvest, et procédures reprises d'Ekylibre hors catalogue (forme « travail »)
  return "works";
}

const COVER_SOWING = "plant_cover_sowing";
const isCropSowing = (procedure: string) => procedure !== COVER_SOWING && getProcedure(procedure).shape === "sowing";
const isHarvest = (procedure: string) => getProcedure(procedure).shape === "harvest";

/** Intervention prête pour l'itinéraire : date au jour (heure de Paris), libellé et détails déjà résolus. */
export interface ItineraryIntervention {
  id: string;
  procedure: string;
  status: "done" | "planned";
  /** Début, sinon fin, sinon création : ISO. */
  at: string;
  irrigation: boolean;
  label: string;
  details: ItineraryDetail[];
  parcels: { id: string; name: string }[];
}

/** Fenêtre d'une campagne, bornes en jours (fin exclue). */
export interface CampaignWindow {
  year: number;
  from: string;
  /** Premier jour après la campagne. */
  to: string;
}

const inWindow = (day: string, w: { from: string; to: string }) => day >= w.from && day < w.to;
const lastDayOf = (w: CampaignWindow) => new Date((dayNumber(w.to) - 1) * DAY_MS).toISOString().slice(0, 10);

/**
 * Dates d'une culture (E6) : du premier semis au dernier chantier de récolte
 * réalisés dans la campagne ; une borne manquante prend celle de la campagne.
 */
export function cropSpan(
  interventions: Pick<ItineraryIntervention, "procedure" | "status" | "at">[],
  campaign: CampaignWindow,
): { from: string; to: string; source: "interventions" | "campaign" } {
  const done = interventions.filter((i) => i.status === "done").map((i) => ({ ...i, day: parisDay(i.at) })).filter((i) => inWindow(i.day, campaign));
  const sowings = done.filter((i) => isCropSowing(i.procedure)).map((i) => i.day).sort();
  const harvests = done.filter((i) => isHarvest(i.procedure)).map((i) => i.day).sort();
  let from = sowings[0] ?? campaign.from;
  let to = harvests.at(-1) ?? lastDayOf(campaign);
  // Récolte avant tout semis de la campagne (culture semée la campagne précédente) : la culture part du début.
  if (to < from) from = campaign.from;
  if (to <= from) to = lastDayOf(campaign);
  return { from, to, source: sowings.length && harvests.length ? "interventions" : "campaign" };
}

export interface ParcelCampaignInput {
  window: CampaignWindow;
  /** Culture(s) de la campagne ; plusieurs productions sont réunies en une étape (« Blé + Pois »). */
  crops: { name: string; color: string | null; attributes: ItineraryDetail[] }[];
  /** Couvert d'interculture qui précède la culture de cette campagne. */
  cover: { name: string; sownOn: string; destroyedOn: string | null; attributes: ItineraryDetail[] } | null;
}

function toMark(i: ItineraryIntervention, lane: ItineraryLane, stepFrom: string): ItineraryMark {
  const day = parisDay(i.at);
  return {
    interventionIds: [i.id],
    procedure: i.procedure,
    label: i.label,
    lane,
    status: i.status,
    at: day,
    from: day,
    to: day,
    day: daysBetween(stepFrom, day),
    details: i.details,
    parcels: i.parcels,
  };
}

const byDay = (a: ItineraryMark, b: ItineraryMark) => (a.at === b.at ? a.label.localeCompare(b.label, "fr") : a.at < b.at ? -1 : 1);

/**
 * Itinéraire d'une parcelle sur une ou plusieurs campagnes (E4, E5) : une
 * étape par culture, une étape secondaire par couvert ; chaque intervention
 * va à la campagne qui contient sa date, et au couvert si c'en est le semis
 * ou un travail pendant sa présence.
 */
export function buildParcelItinerary(input: { title: string; campaigns: ParcelCampaignInput[]; interventions: ItineraryIntervention[] }): TechnicalItinerary {
  const campaigns = [...input.campaigns].sort((a, b) => a.window.year - b.window.year);
  // 1. Couverts d'abord, sur toutes les campagnes : semé avant la campagne de sa
  // culture, un couvert a ses interventions dans la fenêtre précédente.
  const covers = new Map<number, ItineraryStep>();
  const taken = new Set<string>();
  for (const c of campaigns) {
    if (!c.cover) continue;
    const end = c.cover.destroyedOn ?? lastDayOf(c.window);
    const cover: ItineraryStep = {
      kind: "cover",
      campaign: c.window.year,
      name: c.cover.name,
      color: null,
      from: c.cover.sownOn,
      to: end > c.cover.sownOn ? end : lastDayOf(c.window),
      datesFrom: "cover",
      attributes: c.cover.attributes,
      marks: [],
    };
    for (const i of input.interventions) {
      const lane = laneOf(i.procedure, i.irrigation);
      if (!lane || taken.has(i.id) || !isCoverIntervention(i, cover)) continue;
      cover.marks.push(toMark(i, lane, cover.from));
      taken.add(i.id);
    }
    covers.set(c.window.year, sortMarks(cover));
  }
  // 2. Cultures : le reste, dans la campagne qui contient la date.
  const steps: ItineraryStep[] = [...covers.values()];
  for (const c of campaigns) {
    const own = input.interventions.filter((i) => inWindow(parisDay(i.at), c.window));
    const span = cropSpan(own, c.window);
    const crop: ItineraryStep = {
      kind: "crop",
      campaign: c.window.year,
      name: c.crops.length ? c.crops.map((x) => x.name).join(" + ") : "Sans culture déclarée",
      color: c.crops[0]?.color ?? null,
      from: span.from,
      to: span.to,
      datesFrom: span.source,
      attributes: c.crops.flatMap((x) => x.attributes),
      marks: [],
    };
    for (const i of own) {
      const lane = laneOf(i.procedure, i.irrigation);
      if (lane && !taken.has(i.id)) crop.marks.push(toMark(i, lane, crop.from));
    }
    // Une campagne sans culture ni intervention n'apporte rien à la frise.
    if (c.crops.length || crop.marks.length) steps.push(sortMarks(crop));
  }
  steps.sort((a, b) => (a.from === b.from ? (a.kind === "cover" ? -1 : 1) : a.from < b.from ? -1 : 1));
  return { title: input.title, steps, campaigns: campaigns.map((c) => c.window.year) };
}

function isCoverIntervention(i: ItineraryIntervention, cover: ItineraryStep): boolean {
  if (i.procedure === COVER_SOWING) {
    const day = parisDay(i.at);
    // Le semis du couvert, à quelques jours près de la date déclarée.
    return Math.abs(daysBetween(cover.from, day)) <= 15;
  }
  const day = parisDay(i.at);
  return getProcedure(i.procedure).shape === "work" && day >= cover.from && day <= cover.to;
}

const sortMarks = (s: ItineraryStep): ItineraryStep => ({ ...s, marks: s.marks.sort(byDay) });

/** Écart maximal entre deux chantiers regroupés (question 1 des besoins). */
export const ITINERARY_GROUP_GAP_DAYS = { default: 7, harvest: 15 };

/**
 * Vue fusionnée (E8) : marques de même procédure et de même statut à moins
 * de 7 jours d'écart (15 pour une récolte) réunies en une seule, placée au
 * jour médian ; les écarts s'enchaînent. Les parcelles sont dédoublonnées.
 */
export function groupMarks(marks: ItineraryMark[], stepFrom: string, gaps = ITINERARY_GROUP_GAP_DAYS): ItineraryMark[] {
  const buckets = new Map<string, ItineraryMark[]>();
  for (const m of marks) {
    const key = `${m.procedure}|${m.status}|${m.lane}`;
    buckets.set(key, [...(buckets.get(key) ?? []), m]);
  }
  const out: ItineraryMark[] = [];
  for (const list of buckets.values()) {
    list.sort(byDay);
    const gap = isHarvest(list[0]!.procedure) ? gaps.harvest : gaps.default;
    let group: ItineraryMark[] = [];
    const flush = () => {
      if (group.length) out.push(mergeGroup(group, stepFrom));
      group = [];
    };
    for (const m of list) {
      if (group.length && daysBetween(group.at(-1)!.to, m.from) > gap) flush();
      group.push(m);
    }
    flush();
  }
  return out.sort(byDay);
}

function mergeGroup(group: ItineraryMark[], stepFrom: string): ItineraryMark {
  if (group.length === 1) return group[0]!;
  const days = group.flatMap((m) => [m.from, m.to]).sort();
  const from = days[0]!;
  const to = days.at(-1)!;
  const at = new Date(Math.round((dayNumber(from) + dayNumber(to)) / 2) * DAY_MS).toISOString().slice(0, 10);
  const parcels = [...new Map(group.flatMap((m) => m.parcels).map((p) => [p.id, p])).values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const labels = new Set(group.map((m) => m.label));
  const base = getProcedure(group[0]!.procedure).label;
  const label = `${labels.size === 1 ? group[0]!.label : base}, ${parcels.length} parcelle${parcels.length > 1 ? "s" : ""}`;
  return {
    interventionIds: group.flatMap((m) => m.interventionIds),
    procedure: group[0]!.procedure,
    label,
    lane: group[0]!.lane,
    status: group[0]!.status,
    at,
    from,
    to,
    day: daysBetween(stepFrom, at),
    details: [
      { label: "Dates", value: from === to ? frenchDay(from) : `du ${frenchDay(from)} au ${frenchDay(to)}` },
      { label: "Parcelles", value: parcels.map((p) => p.name).join(", ") },
      { label: "Interventions", value: String(group.length) },
      ...(labels.size > 1 ? [{ label: "Variantes", value: [...labels].sort().join(" ; ") }] : []),
    ],
    parcels,
  };
}

const frenchDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Vue fusionnée d'une activité pour une campagne (E8 à E10) : une étape, des
 * dates englobant celles de ses parcelles, les chantiers regroupés.
 */
export function buildActivityItinerary(input: {
  title: string;
  window: CampaignWindow;
  crop: { name: string; color: string | null; attributes: ItineraryDetail[] };
  parcels: { id: string; name: string; areaM2: number }[];
  interventions: ItineraryIntervention[];
}): ActivityItinerary {
  // Seules les parcelles de l'activité comptent (une intervention peut en toucher d'autres).
  const ids = new Set(input.parcels.map((p) => p.id));
  const own = input.interventions
    .filter((i) => inWindow(parisDay(i.at), input.window))
    .map((i) => ({ ...i, parcels: i.parcels.filter((p) => ids.has(p.id)) }))
    .filter((i) => i.parcels.length > 0);
  const spans = input.parcels.map((p) => cropSpan(own.filter((i) => i.parcels.some((x) => x.id === p.id)), input.window));
  const measured = spans.filter((s) => s.source === "interventions");
  const from = measured.length ? measured.map((s) => s.from).sort()[0]! : input.window.from;
  const to = measured.length ? measured.map((s) => s.to).sort().at(-1)! : lastDayOf(input.window);
  const marks: ItineraryMark[] = [];
  for (const i of own) {
    const lane = laneOf(i.procedure, i.irrigation);
    if (lane) marks.push(toMark(i, lane, from));
  }
  const counts = new Map<string, number>();
  for (const i of own) if (laneOf(i.procedure, i.irrigation)) for (const p of i.parcels) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  return {
    title: input.title,
    campaigns: [input.window.year],
    steps: [
      {
        kind: "crop",
        campaign: input.window.year,
        name: input.crop.name,
        color: input.crop.color,
        from,
        to,
        datesFrom: measured.length ? "interventions" : "campaign",
        attributes: input.crop.attributes,
        marks: groupMarks(marks, from),
      },
    ],
    parcels: input.parcels.map((p) => ({ ...p, interventions: counts.get(p.id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name, "fr")),
  };
}
