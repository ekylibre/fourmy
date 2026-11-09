import type { InterventionCrew, Staffing, WorkPeriod } from "@fourmy/contracts";

/**
 * Attelages d'une intervention (docs/parcours-attelages-design.md §2.1, §4.2 ;
 * FR-ATT-1 à 5). Fonctions pures : le domaine refuse avec un message lisible
 * ce que le trigger de garde (migration 0022) refuserait, plus la règle
 * FR-ATT-3 (même matériel ou même intervenant dans deux attelages qui se
 * chevauchent). Les règles existantes (formes, doses, météo) travaillent sur
 * la forme aplatie donnée par {@link flattenCrews} et ne changent pas.
 */

type Tool = InterventionCrew["tools"][number];
type Doer = InterventionCrew["doers"][number];

/** Attelage tel qu'écrit ou lu (le libellé lu peut être `null`). */
export type CrewLike = Pick<InterventionCrew, "tools" | "periods"> & {
  id?: string;
  label?: string | null;
  templateId?: string | null;
  doers?: readonly Doer[];
};

/** Moyens d'une intervention : mode, attelages et forme libre de premier niveau. */
export interface StaffingBody {
  staffing?: Staffing;
  crews?: readonly CrewLike[];
  tools?: readonly Tool[];
  doers?: readonly Doer[];
  periods?: readonly WorkPeriod[];
}

/** Forme libre : matériels, intervenants et périodes indépendants. */
export interface FreeStaffing {
  tools: Tool[];
  doers: Doer[];
  periods: WorkPeriod[];
}

/** Noms des matériels et des personnes, pour des messages lisibles (facultatif). */
export interface CrewNames {
  equipment?: (id: string) => string | undefined;
  person?: (id: string) => string | undefined;
}

const ms = (iso: string) => Date.parse(iso);

/** Deux périodes se chevauchent (se toucher, 10 h-10 h, n'est pas se chevaucher). */
function overlaps(a: WorkPeriod, b: WorkPeriod): boolean {
  return ms(a.startedAt) < ms(b.stoppedAt) && ms(b.startedAt) < ms(a.stoppedAt);
}

/** « Attelage 2 », ou son libellé. */
function crewName(crew: CrewLike, idx: number): string {
  const label = crew.label?.trim();
  return label ? `« ${label} »` : `Attelage ${idx + 1}`;
}

const sortPeriods = (periods: readonly WorkPeriod[]) => [...periods].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));

/**
 * Réunion de périodes, triée : celles qui se chevauchent sont fusionnées.
 * Deux périodes qui se touchent (8 h-10 h, 10 h-12 h) restent distinctes,
 * comme en mode libre où elles sont valides : l'aller-retour libre →
 * attelages → libre ne modifie donc pas les périodes.
 */
export function mergePeriods(periods: readonly WorkPeriod[]): WorkPeriod[] {
  const out: WorkPeriod[] = [];
  for (const p of sortPeriods(periods)) {
    const last = out.at(-1);
    if (last && ms(p.startedAt) < ms(last.stoppedAt)) {
      if (ms(p.stoppedAt) > ms(last.stoppedAt)) out[out.length - 1] = { startedAt: last.startedAt, stoppedAt: p.stoppedAt };
    } else {
      out.push({ startedAt: p.startedAt, stoppedAt: p.stoppedAt });
    }
  }
  return out;
}

/**
 * Règles des attelages (FR-ATT-1 à 3). Renvoie la liste des problèmes (vide =
 * valide). En mode `crews` : au moins un attelage ; chacun a au moins un
 * matériel et une période ; ses périodes ne se chevauchent pas (deux attelages,
 * eux, le peuvent) ; rien au premier niveau ; un même matériel ou intervenant
 * ne figure pas dans deux attelages dont les périodes se chevauchent. En mode
 * `free` : aucun attelage. Les périodes du mode libre relèvent de
 * `validateIntervention`.
 */
export function crewRules(body: StaffingBody, names: CrewNames = {}): string[] {
  const errors: string[] = [];
  const crews = body.crews ?? [];
  if ((body.staffing ?? "free") === "free") {
    if (crews.length > 0) errors.push("En mode libre, l'intervention n'a pas d'attelage.");
    return errors;
  }

  if (crews.length === 0) errors.push("Au moins un attelage.");
  if ((body.tools?.length ?? 0) > 0 || (body.doers?.length ?? 0) > 0 || (body.periods?.length ?? 0) > 0) {
    errors.push("En mode attelages, matériels, intervenants et périodes se saisissent dans chaque attelage.");
  }

  crews.forEach((crew, idx) => {
    const name = crewName(crew, idx);
    if (crew.tools.length === 0) errors.push(`${name} : au moins un matériel.`);
    if (crew.periods.length === 0) errors.push(`${name} : au moins une période de travail.`);
    const sorted = sortPeriods(crew.periods);
    sorted.forEach((p, n) => {
      if (ms(p.stoppedAt) <= ms(p.startedAt)) errors.push(`${name}, période n° ${n + 1} : la fin doit suivre le début.`);
      const next = sorted[n + 1];
      if (next && ms(next.startedAt) < ms(p.stoppedAt)) errors.push(`${name} : deux périodes de travail se chevauchent.`);
    });
  });

  // FR-ATT-3 : un matériel ou une personne ne travaille pas dans deux attelages à la fois.
  for (let i = 0; i < crews.length; i++) {
    for (let j = i + 1; j < crews.length; j++) {
      const a = crews[i]!;
      const b = crews[j]!;
      if (!a.periods.some((p) => b.periods.some((q) => overlaps(p, q)))) continue;
      const where = `dans ${crewName(a, i)} et ${crewName(b, j)} sur des périodes qui se chevauchent`;
      const bTools = new Set(b.tools.map((t) => t.equipmentId));
      for (const id of new Set(a.tools.map((t) => t.equipmentId))) {
        if (!bTools.has(id)) continue;
        const n = names.equipment?.(id);
        errors.push(n ? `Le matériel « ${n} » figure ${where}.` : `Un même matériel figure ${where}.`);
      }
      const bDoers = new Set((b.doers ?? []).map((d) => d.personId));
      for (const id of new Set((a.doers ?? []).map((d) => d.personId))) {
        if (!bDoers.has(id)) continue;
        const n = names.person?.(id);
        errors.push(n ? `${n} figure ${where}.` : `Un même intervenant figure ${where}.`);
      }
    }
  }

  return [...new Set(errors)];
}

/** Dernière fin de période d'un attelage (ms), pour départager les relevés de compteur. */
const lastStop = (crew: CrewLike) => Math.max(-Infinity, ...crew.periods.map((p) => ms(p.stoppedAt)));

/**
 * Forme aplatie des attelages (lecture par les anciens clients, règles
 * existantes) : matériels et intervenants dédoublonnés dans l'ordre des
 * attelages, périodes fusionnées ({@link mergePeriods}). Un matériel présent
 * dans plusieurs attelages garde le relevé de compteur de l'attelage qui
 * finit le plus tard (le relevé de fin de chantier).
 */
export function flattenCrews(crews: readonly CrewLike[]): FreeStaffing {
  const tools = new Map<string, Tool>();
  for (const crew of crews) for (const t of crew.tools) if (!tools.has(t.equipmentId)) tools.set(t.equipmentId, { ...t });
  const byStop = [...crews].sort((a, b) => lastStop(a) - lastStop(b));
  for (const crew of byStop) for (const t of crew.tools) if (t.meter) tools.set(t.equipmentId, { ...tools.get(t.equipmentId)!, meter: t.meter });

  const doers = new Map<string, Doer>();
  for (const crew of crews) for (const d of crew.doers ?? []) if (!doers.has(d.personId)) doers.set(d.personId, { ...d });

  return { tools: [...tools.values()], doers: [...doers.values()], periods: mergePeriods(crews.flatMap((c) => c.periods)) };
}

/** Durée du chantier (premier début → dernière fin) et temps de travail (somme des périodes), en secondes (FR-ATT-5). */
export function crewDurations(body: StaffingBody): { spanS: number | null; workDurationS: number | null } {
  const periods = body.staffing === "crews" ? (body.crews ?? []).flatMap((c) => c.periods) : [...(body.periods ?? [])];
  if (periods.length === 0) return { spanS: null, workDurationS: null };
  const start = Math.min(...periods.map((p) => ms(p.startedAt)));
  const stop = Math.max(...periods.map((p) => ms(p.stoppedAt)));
  const work = periods.reduce((s, p) => s + Math.max(0, ms(p.stoppedAt) - ms(p.startedAt)), 0);
  return { spanS: (stop - start) / 1000, workDurationS: work / 1000 };
}

/**
 * Libre → attelages (FR-ATT-4) : un seul attelage avec tous les matériels,
 * intervenants et périodes ; l'utilisateur le découpe ensuite. Sans matériel,
 * l'attelage est incomplet et {@link crewRules} le signalera.
 */
export function toCrews(body: Pick<StaffingBody, "tools" | "doers" | "periods">): {
  staffing: "crews";
  crews: InterventionCrew[];
  tools: [];
  doers: [];
  periods: [];
} {
  const crew: InterventionCrew = {
    tools: (body.tools ?? []).map((t) => ({ ...t })),
    doers: (body.doers ?? []).map((d) => ({ ...d })),
    periods: sortPeriods(body.periods ?? []).map((p) => ({ ...p })),
  };
  return { staffing: "crews", crews: [crew], tools: [], doers: [], periods: [] };
}

const idSet = (ids: readonly string[]) => [...new Set(ids)].sort().join(",");
const periodsKey = (periods: readonly WorkPeriod[]) =>
  sortPeriods(periods)
    .map((p) => `${ms(p.startedAt)}-${ms(p.stoppedAt)}`)
    .join(",");

function hours(s: number): string {
  const min = Math.round(s / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * Attelages → libre (FR-ATT-4) : réunion des matériels, intervenants et
 * périodes ({@link flattenCrews}). `losses` dit ce qui est perdu, pour la
 * fenêtre de confirmation (vide : rien de perdu) :
 * - qui travaillait avec quoi (compositions différentes entre attelages) ;
 * - quand travaillait chaque attelage (périodes propres à chaque attelage) ;
 * - le temps de travail, quand des attelages simultanés sont fusionnés ;
 * - les noms des attelages et leur rattachement à un attelage type.
 */
export function toFree(body: Pick<StaffingBody, "crews">): {
  body: { staffing: "free"; crews: [] } & FreeStaffing;
  losses: string[];
} {
  const crews = body.crews ?? [];
  const flat = flattenCrews(crews);
  const losses: string[] = [];

  const compositions = new Set(crews.map((c) => `${idSet(c.tools.map((t) => t.equipmentId))}|${idSet((c.doers ?? []).map((d) => d.personId))}`));
  if (compositions.size > 1) {
    losses.push(`Les ${crews.length} attelages sont réunis : on ne saura plus quel intervenant travaillait avec quel matériel.`);
    if (new Set(crews.map((c) => periodsKey(c.periods))).size > 1) {
      losses.push("Les périodes propres à chaque attelage sont remplacées par celles de l'intervention.");
    }
  }

  const before = crewDurations({ staffing: "crews", crews }).workDurationS ?? 0;
  const after = crewDurations({ staffing: "free", periods: flat.periods }).workDurationS ?? 0;
  if (Math.round(before / 60) !== Math.round(after / 60)) {
    losses.push(`Le temps de travail passe de ${hours(before)} à ${hours(after)} : les périodes simultanées sont fusionnées.`);
  }

  if (crews.some((c) => c.label?.trim() || c.templateId)) losses.push("Les noms des attelages et les attelages types d'origine ne sont pas conservés.");

  return { body: { staffing: "free", crews: [], ...flat }, losses };
}
