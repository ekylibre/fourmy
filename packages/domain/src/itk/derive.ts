import {
  getProcedure,
  itkContent,
  itkProcedureAllowed,
  itkUnitAllowed,
  ITK_DOSE_UNITS,
  type ArticleKind,
  type ItkContent,
  type ItkDeriveStats,
  type ItkInput,
  type ItkStepInput,
} from "@fourmy/contracts";
import { laneOf } from "../itinerary.js";
import { scheduleSteps } from "./schedule.js";

/**
 * Proposition d'un ITK depuis les interventions réalisées d'une activité
 * (lot IT2, claudedocs/conception_assolement_itk.md §5 et §15.2). Fonctions
 * pures : la couche service lit les productions, les interventions et les
 * articles ; rien n'est enregistré ici.
 */

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const shift = (d: string, n: number) => new Date((dayNum(d) + n) * DAY_MS).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round(dayNum(b) - dayNum(a));

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const quantile = (values: readonly number[], q: number) => {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo);
};

/** Production d'une parcelle (toutes activités : les voisines bornent les fenêtres). */
export interface DeriveProduction {
  id: string;
  parcelId: string;
  activityId: string | null;
  campaign: number;
  areaM2: number;
  startedOn: string | null;
  stoppedOn: string | null;
}

/** Intervention réalisée, jour à Paris, surfaces travaillées résolues (à défaut, surface de la parcelle). */
export interface DeriveIntervention {
  id: string;
  procedure: string;
  day: string;
  origin: string;
  /** Périodes connues au jour près seulement (import) : durée inutilisable. */
  dayPrecision: boolean;
  /** Durée de travail (secondes), null si inconnue. */
  durationS: number | null;
  targets: { parcelId: string; workedAreaM2: number }[];
  inputs: { articleId: string; quantity: number; unit: string; per: "total" | "hectare" }[];
  equipmentIds: string[];
  personIds: string[];
  crewTemplateId: string | null;
}

export interface DeriveArticle {
  name: string;
  kind: ArticleKind;
}

export interface DeriveInput {
  activityId: string;
  campaigns: number[];
  productions: DeriveProduction[];
  interventions: DeriveIntervention[];
  articles: ReadonlyMap<string, DeriveArticle>;
  newId: () => string;
}

/** Écart (jours) au-delà duquel deux passages d'une même procédure font deux étapes, comme `groupMarks`. */
export const DERIVE_GAP_DAYS = { default: 7, harvest: 15 };
/** Au-delà de ce nombre d'étapes pour une même procédure : une seule étape à passages répétés. */
export const DERIVE_MAX_CLUSTERS = 4;
/** Débits observés retenus (ha/h) et nombre minimal de chantiers. */
export const OBSERVED_RATE = { min: 0.1, max: 50, samples: 3 };

const isSowing = (p: string) => p !== "plant_cover_sowing" && getProcedure(p).shape === "sowing";
const isHarvest = (p: string) => getProcedure(p).shape === "harvest";

/**
 * Rattache chaque intervention à une production de sa parcelle : la
 * production court du lendemain de la récolte de la précédente (date de fin,
 * sinon dernière récolte de sa campagne) jusqu'à la veille de la suivante.
 */
export function assignInterventions(productions: readonly DeriveProduction[], interventions: readonly DeriveIntervention[]): Map<string, DeriveIntervention[]> {
  const byParcel = new Map<string, DeriveProduction[]>();
  for (const p of productions) byParcel.set(p.parcelId, [...(byParcel.get(p.parcelId) ?? []), p]);
  const out = new Map<string, DeriveIntervention[]>(productions.map((p) => [p.id, []]));
  for (const [parcelId, list] of byParcel) {
    list.sort((a, b) => a.campaign - b.campaign || (a.startedOn ?? "").localeCompare(b.startedOn ?? ""));
    const onParcel = interventions.filter((i) => i.targets.some((t) => t.parcelId === parcelId));
    // Récolte de chaque production : date de fin, sinon dernière récolte de sa campagne (année civile).
    const harvest = list.map(
      (p) =>
        p.stoppedOn ??
        onParcel
          .filter((i) => isHarvest(i.procedure) && i.day >= `${p.campaign}-01-01` && i.day <= `${p.campaign}-12-31`)
          .map((i) => i.day)
          .sort()
          .at(-1) ??
        null,
    );
    const starts = list.map((p, k) => (k > 0 && harvest[k - 1] ? shift(harvest[k - 1]!, 1) : p.startedOn ? shift(p.startedOn, -60) : `${p.campaign - 1}-08-01`));
    list.forEach((p, k) => {
      const end = k + 1 < list.length ? shift(starts[k + 1]!, -1) : harvest[k] ? shift(harvest[k]!, 60) : `${p.campaign}-12-31`;
      out.set(
        p.id,
        onParcel.filter((i) => i.day >= starts[k]! && i.day <= end),
      );
    });
  }
  return out;
}

/** Libellés d'unité repris d'autres logiciels → codes Fourmy ; facteurs vers une unité de dose d'ITK. */
const UNIT_ALIASES: Record<string, string> = {
  kilogramme: "kilogram",
  kg: "kilogram",
  litre: "liter",
  l: "liter",
  tonne: "ton",
  t: "ton",
  quintal: "quintal",
  "mille grains": "thousand",
  milliers: "thousand",
  unité: "unity",
  unite: "unity",
  gramme: "gram",
};
const UNIT_FACTORS: Record<string, { to: string; factor: number }> = {
  gram: { to: "kilogram", factor: 0.001 },
  hectoliter: { to: "liter", factor: 100 },
  million: { to: "thousand", factor: 1000 },
};

/** Dose à l'hectare d'un intrant, dans une unité d'ITK ; null si elle ne s'y ramène pas. */
export function doseOf(input: DeriveIntervention["inputs"][number], workedHa: number, kind: ArticleKind): { dose: number; unit: ItkInput["unit"] } | null {
  let unit = input.unit.trim();
  let rate = input.per === "hectare";
  const perHa = /^(.+)_per_hectare$/i.exec(unit);
  if (perHa) {
    unit = perHa[1]!;
    rate = true;
  }
  if (/_per_square_meter$/i.test(unit)) {
    const u = unit.toLowerCase();
    return itkUnitAllowed(u, kind) && input.quantity > 0 ? { dose: input.quantity, unit: u as ItkInput["unit"] } : null;
  }
  unit = UNIT_ALIASES[unit.toLowerCase()] ?? unit.toLowerCase().replace(/\s+/g, "_");
  let quantity = input.quantity;
  const f = UNIT_FACTORS[unit];
  if (f) {
    unit = f.to;
    quantity *= f.factor;
  }
  if (!rate) {
    if (!(workedHa > 0)) return null;
    quantity /= workedHa;
  }
  const doseUnit = `${unit}_per_hectare`;
  if (!(ITK_DOSE_UNITS as readonly string[]).includes(doseUnit) || !itkUnitAllowed(doseUnit, kind) || !(quantity > 0)) return null;
  return { dose: Number(quantity.toPrecision(4)), unit: doseUnit as ItkInput["unit"] };
}

interface Occurrence {
  production: DeriveProduction;
  intervention: DeriveIntervention;
  /** `date` : culture en place depuis plus d'une campagne (prairie, luzerne) ; décalage depuis le 1er janvier de la campagne. */
  anchor: "sowing" | "harvest" | "date";
  offset: number;
  /** Surface travaillée sur la parcelle de la production (m²). */
  workedM2: number;
}

export interface DeriveOutput {
  content: ItkContent;
  stats: ItkDeriveStats;
}

/** Proposition d'ITK (contenu validé) et statistiques de ce qui a été retenu. */
export function deriveItinerary(input: DeriveInput): DeriveOutput {
  const campaigns = new Set(input.campaigns);
  const assigned = assignInterventions(input.productions, input.interventions);
  const retained: { p: DeriveProduction; sowingOn: string | null; harvestOn: string | null; perennial: boolean }[] = [];
  let excluded = 0;
  for (const p of input.productions) {
    if (p.activityId !== input.activityId || !campaigns.has(p.campaign)) continue;
    const own = assigned.get(p.id) ?? [];
    const sowingOn = p.startedOn ?? own.filter((i) => isSowing(i.procedure)).map((i) => i.day).sort()[0] ?? null;
    const harvestOn = p.stoppedOn ?? own.filter((i) => isHarvest(i.procedure)).map((i) => i.day).sort().at(-1) ?? null;
    // Semée avant le début de la campagne précédente : culture en place depuis plus d'une campagne.
    const perennial = !!p.startedOn && p.startedOn < `${p.campaign - 1}-07-01`;
    if (!sowingOn && !harvestOn && !perennial) excluded++;
    else retained.push({ p, sowingOn, harvestOn, perennial });
  }

  const occurrences: Occurrence[] = [];
  for (const r of retained) {
    for (const i of assigned.get(r.p.id) ?? []) {
      if (!laneOf(i.procedure) || !itkProcedureAllowed(i.procedure)) continue; // entretien du matériel, procédure inconnue : hors itinéraire
      // Récolte avant le semis : celle de la culture précédente, restée dans la fenêtre.
      if (isHarvest(i.procedure) && r.sowingOn && i.day < r.sowingOn) continue;
      const worked = i.targets.filter((t) => t.parcelId === r.p.parcelId).reduce((s, t) => s + t.workedAreaM2, 0);
      const workedM2 = Math.min(worked || r.p.areaM2, r.p.areaM2 || worked);
      if (r.perennial) {
        // Prairie, luzerne en place : dates fixes de l'année de récolte (ou de celle d'avant).
        const offset = between(`${r.p.campaign}-01-01`, i.day);
        if (offset >= -365 && offset <= 364) occurrences.push({ production: r.p, intervention: i, anchor: "date", offset, workedM2 });
        continue;
      }
      const harvestSide = r.harvestOn && (isHarvest(i.procedure) || i.day > r.harvestOn);
      const anchor: "sowing" | "harvest" = harvestSide || !r.sowingOn ? "harvest" : "sowing";
      const offset = between(anchor === "sowing" ? r.sowingOn! : r.harvestOn!, i.day);
      // Hors des bornes d'une ancre (dates de production incohérentes) : ignorée plutôt qu'une étape absurde.
      if (anchor === "sowing" ? offset < -366 || offset > 730 : Math.abs(offset) > 366) continue;
      occurrences.push({ production: r.p, intervention: i, anchor, offset, workedM2 });
    }
  }

  const totalM2 = retained.reduce((s, r) => s + r.p.areaM2, 0);
  let unconvertedInputs = 0;
  let toComplete = 0;

  /** Une étape à partir d'occurrences (un groupe, ou toute une procédure répétée). */
  const toStep = (occ: Occurrence[], repeated: boolean): ItkStepInput => {
    const first = occ[0]!;
    const procedure = first.intervention.procedure;
    const byProduction = new Map<string, Occurrence[]>();
    for (const o of occ) byProduction.set(o.production.id, [...(byProduction.get(o.production.id) ?? []), o]);
    const firstOffsets = [...byProduction.values()].map((l) => Math.min(...l.map((o) => o.offset)));
    const offsets = occ.map((o) => o.offset);
    const offset = Math.round(median(repeated ? firstOffsets : offsets));
    const spread = repeated ? 0 : Math.round((quantile(offsets, 0.75) - quantile(offsets, 0.25)) / 2);
    let repeat: ItkStepInput["repeat"];
    if (repeated) {
      const counts = [...byProduction.values()].map((l) => l.length);
      const gaps = [...byProduction.values()].flatMap((l) => {
        const s = l.map((o) => o.offset).sort((a, b) => a - b);
        return s.slice(1).map((v, k) => v - s[k]!);
      });
      const count = Math.max(1, Math.min(20, Math.round(median(counts))));
      if (count > 1) repeat = { count, everyDays: Math.max(1, Math.min(365, Math.round(gaps.length ? median(gaps) : 7))) };
    }
    const worked = [...byProduction.values()].reduce((s, l) => s + Math.max(...l.map((o) => o.workedM2)), 0);
    const share = totalM2 > 0 ? Math.min(1, Math.max(0.05, Math.round((worked / totalM2) * 20) / 20)) : 1;
    const interventions = occ.map((o) => o.intervention);
    const n = interventions.length;

    // Intrants employés dans au moins la moitié des passages : dose médiane à l'hectare.
    const doses = new Map<string, { unit: ItkInput["unit"]; dose: number }[]>();
    const usedBy = new Map<string, number>();
    for (const o of occ) {
      const workedHa = (o.intervention.targets.reduce((s, t) => s + t.workedAreaM2, 0) || o.workedM2) / 10_000;
      for (const x of o.intervention.inputs) {
        const article = input.articles.get(x.articleId);
        if (!article) continue;
        usedBy.set(x.articleId, (usedBy.get(x.articleId) ?? 0) + 1);
        const d = doseOf(x, workedHa, article.kind);
        if (!d) unconvertedInputs++;
        else doses.set(x.articleId, [...(doses.get(x.articleId) ?? []), d]);
      }
    }
    const allowed = getProcedure(procedure).inputKinds;
    const inputs: ItkInput[] = [];
    for (const [articleId, list] of doses) {
      const article = input.articles.get(articleId)!;
      if ((usedBy.get(articleId) ?? 0) * 2 < n || !allowed.includes(article.kind)) continue;
      const units = new Map<string, number>();
      for (const d of list) units.set(d.unit, (units.get(d.unit) ?? 0) + 1);
      const unit = [...units].sort((a, b) => b[1] - a[1])[0]![0] as ItkInput["unit"];
      inputs.push({ articleId, kind: article.kind, label: article.name.slice(0, 120), dose: Number(median(list.filter((d) => d.unit === unit).map((d) => d.dose)).toPrecision(4)), unit });
    }

    // Matériels, intervenants et attelage type présents dans au moins la moitié des passages.
    const frequent = (ids: string[][]) => {
      const c = new Map<string, number>();
      for (const l of ids) for (const id of new Set(l)) c.set(id, (c.get(id) ?? 0) + 1);
      return [...c].filter(([, k]) => k * 2 >= n).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    };
    const equipmentIds = frequent(interventions.map((i) => i.equipmentIds)).slice(0, 20);
    const personIds = frequent(interventions.map((i) => i.personIds)).slice(0, 20);
    const crewTemplateId = frequent(interventions.map((i) => (i.crewTemplateId ? [i.crewTemplateId] : [])))[0];
    if (!equipmentIds.length && !personIds.length && !crewTemplateId) toComplete++;

    // Débit observé : chantiers à l'heure près, hors imports, avec matériel.
    const rates = interventions
      .filter((i) => !i.dayPrecision && i.origin !== "import" && i.equipmentIds.length > 0 && (i.durationS ?? 0) > 0)
      .map((i) => i.targets.reduce((s, t) => s + t.workedAreaM2, 0) / 10_000 / (i.durationS! / 3600))
      .filter((r) => r >= OBSERVED_RATE.min && r <= OBSERVED_RATE.max);
    const days = occ.map((o) => o.intervention.day).sort();
    const productionsCount = byProduction.size;
    // Ancre : J±n, ou date fixe reconstituée sur une année non bissextile.
    const fixed = shift("2027-01-01", offset);
    const anchor =
      first.anchor === "date" ? { kind: "date" as const, monthDay: fixed.slice(5), yearOffset: (fixed < "2027-01-01" ? -1 : 0) as -1 | 0 } : { kind: first.anchor, offsetDays: offset };
    return {
      id: input.newId(),
      procedure,
      anchor,
      ...(spread > 0 ? { windowDays: Math.min(90, spread) } : {}),
      ...(repeat ? { repeat } : {}),
      share,
      optional: productionsCount * 2 < retained.length,
      inputs,
      staffing: crewTemplateId
        ? { crewTemplateId, equipmentIds: [], personIds: [] }
        : { equipmentIds, personIds, ...(!equipmentIds.length && !personIds.length ? { people: 1 } : {}) },
      evidence: {
        parcels: productionsCount,
        ofParcels: retained.length,
        campaigns: [...new Set(occ.map((o) => o.production.campaign))].sort(),
        from: days[0],
        to: days.at(-1),
        ...(repeated ? { note: `${n} passages en tout` } : {}),
        ...(rates.length >= OBSERVED_RATE.samples ? { observedRateHaH: Number(median(rates).toFixed(2)), observedSamples: rates.length } : {}),
      },
    };
  };

  // Regroupement par procédure et ancre, par écart entre passages.
  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const key = `${o.intervention.procedure}|${o.anchor}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const steps: ItkStepInput[] = [];
  for (const occ of groups.values()) {
    occ.sort((a, b) => a.offset - b.offset);
    const gap = isHarvest(occ[0]!.intervention.procedure) ? DERIVE_GAP_DAYS.harvest : DERIVE_GAP_DAYS.default;
    const clusters: Occurrence[][] = [];
    for (const o of occ) {
      const last = clusters.at(-1);
      if (last && o.offset - last.at(-1)!.offset <= gap) last.push(o);
      else clusters.push([o]);
    }
    if (clusters.length > DERIVE_MAX_CLUSTERS) steps.push(toStep(occ, true));
    else for (const c of clusters) steps.push(toStep(c, false));
  }

  // Ordre du temps, sur les dates d'une production retenue datée aux deux bouts (sinon : semis puis récolte).
  const ref = retained.find((r) => r.sowingOn && r.harvestOn && !r.perennial);
  const content = itkContent.parse({ schema: 1, steps });
  if (ref) {
    const order = scheduleSteps(content, { sowingOn: ref.sowingOn, harvestOn: ref.harvestOn, year: ref.p.campaign }).map((s) => s.step.id);
    content.steps.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  } else {
    const rank = (s: (typeof content.steps)[number]) =>
      s.anchor.kind === "date"
        ? between("2027-01-01", `${2027 + s.anchor.yearOffset}-${s.anchor.monthDay}`)
        : (s.anchor.kind === "sowing" ? 0 : 1) * 10_000 + s.anchor.offsetDays;
    content.steps.sort((a, b) => rank(a) - rank(b));
  }
  return {
    content,
    stats: { productions: retained.length, excluded, interventions: occurrences.length, unconvertedInputs, toComplete },
  };
}
