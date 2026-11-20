import {
  BCAE7_2026,
  BCAE7_2026_AT,
  BCAE7_ANNEX1_CODES,
  BCAE7_CATEGORIES,
  BCAE7_ANNEX2_GRASS_FALLOW,
  BCAE7_ANNEX2_GRASSLAND_SAU,
  BCAE7_ANNEX2_LEGUMES,
  BCAE7_NON_ARABLE_CODES,
  BCAE7_NOT_EXPLOITED,
  BCAE7_ROTATION_BY_DEFAULT,
  bcae7At,
  bcae7Category,
  cite,
} from "@fourmy/certification-refs";
import type { ControlFinding, ControlLevel, CropPlanDraft } from "@fourmy/contracts";
import { finding, missing } from "../../certification/report.js";
import { historyOf, type ParcelHistoryPart } from "../history.js";
import { formatHa, formatPct, type CropPlanActivity, type CropPlanHistory } from "../model.js";
import type { ResolvedPlan } from "../resolve.js";

/**
 * BCAE 7, rotation et diversification des cultures, campagne 2026
 * (conception §4.2, décision A6) : les deux critères sont calculés et le
 * constat dit lequel est respecté. Fonctions pures.
 */

export interface Bcae7Parcel {
  key: string;
  name: string;
  areaM2: number;
  /** Code culture PAC de la culture principale prévue ; null : inconnu. */
  main: string | null;
  /** Cultures secondaires prévues après la principale ; null : couvert sans code (CIPAN). */
  secondary: (string | null)[];
  history: ParcelHistoryPart[];
}

export interface Bcae7Farm {
  /** Année de récolte contrôlée. */
  year: number;
  /** Toute l'exploitation est certifiée ou en conversion AB. */
  allOrganic: boolean;
  /** Au moins une parcelle dans la plaine du Rhin (diversification à points). */
  alsaceRhinePlain: boolean;
}

type CodeClass = "cultivated" | "arable-excluded" | "not-exploited" | "non-arable" | "unknown";

const ANNEX1 = new Set(BCAE7_ANNEX1_CODES);
const NON_ARABLE = new Set(BCAE7_NON_ARABLE_CODES);
const NOT_EXPLOITED = new Set(BCAE7_NOT_EXPLOITED);
const BY_DEFAULT = new Set(BCAE7_ROTATION_BY_DEFAULT);
const GRASS_LEGUMES = new Set([...BCAE7_ANNEX2_GRASS_FALLOW, ...BCAE7_ANNEX2_LEGUMES]);
const GRASSLAND_SAU = new Set(BCAE7_ANNEX2_GRASSLAND_SAU);

export function bcae7Class(code: string | null): CodeClass {
  if (!code) return "unknown";
  const c = code.toUpperCase();
  if (NOT_EXPLOITED.has(c)) return "not-exploited";
  const cat = bcae7Category(c);
  if (ANNEX1.has(c) || cat?.annualExcluded) return "arable-excluded";
  if (cat) return "cultivated";
  if (NON_ARABLE.has(c)) return "non-arable";
  return "unknown";
}

/** Culture au sens de la BCAE 7 : la catégorie, ou le code pour les catégories « par code ». */
export function bcae7CropKey(code: string): string {
  const c = code.toUpperCase();
  const cat = bcae7Category(c);
  if (!cat) return `code:${c}`;
  return cat.perCode ? `${cat.id}:${c}` : cat.id;
}

const CATEGORY_LABELS = new Map(BCAE7_CATEGORIES.map((c) => [c.id, c.label]));

/** Libellé d'une culture au sens de la BCAE 7. */
export function bcae7Label(key: string): string {
  const [id, code] = key.split(":");
  if (id === "code") return code ?? key;
  const label = CATEGORY_LABELS.get(id ?? "") ?? key;
  return code ? `${label} (${code})` : label;
}

const ORDER: Record<ControlLevel, number> = { ok: 0, na: 0, warning: 1, missing: 2, danger: 3 };
const worst = (a: ControlLevel, b: ControlLevel): ControlLevel => (ORDER[a] >= ORDER[b] ? a : b);
const HA = 10_000;

/** Écart faible (§6) : alerte informative plutôt que réduction. */
function gapLevel(gapM2: number, baseM2: number): ControlLevel {
  const { share, ha } = BCAE7_2026.tolerance;
  return gapM2 <= ha * HA || (baseM2 > 0 && gapM2 / baseM2 <= share) ? "warning" : "danger";
}

const src = (at: string) => cite(bcae7At(at));

interface Totals {
  sauM2: number;
  arableM2: number;
  cultivated: Bcae7Parcel[];
  arable: Bcae7Parcel[];
  unknown: Bcae7Parcel[];
}

function totals(parcels: Bcae7Parcel[]): Totals {
  const t: Totals = { sauM2: 0, arableM2: 0, cultivated: [], arable: [], unknown: [] };
  for (const p of parcels) {
    t.sauM2 += p.areaM2;
    const cls = bcae7Class(p.main);
    if (cls === "unknown") t.unknown.push(p);
    if (cls === "cultivated" || cls === "arable-excluded" || cls === "not-exploited") {
      t.arableM2 += p.areaM2;
      t.arable.push(p);
    }
    if (cls === "cultivated") t.cultivated.push(p);
  }
  return t;
}

function exemption(t: Totals, farm: Bcae7Farm): string | null {
  const { exemptArableMaxHa, exemptGrassLegumeShare } = BCAE7_2026;
  if (farm.allOrganic) return "toute l'exploitation est certifiée ou en conversion en agriculture biologique";
  // Parcelles sans code connu : comptées comme terres arables (le cas le plus défavorable).
  const unknownM2 = t.unknown.reduce((s, p) => s + p.areaM2, 0);
  if (t.arableM2 + unknownM2 <= exemptArableMaxHa * HA) return `terres arables de ${formatHa(t.arableM2 + unknownM2)} au plus, ${exemptArableMaxHa} ha ou moins`;
  if (t.unknown.length) return null; // sans les codes de toutes les parcelles, pas d'exemption sur les parts d'herbe
  const sum = (set: Set<string>, ps: Bcae7Parcel[]) => ps.filter((p) => p.main && set.has(p.main.toUpperCase())).reduce((s, p) => s + p.areaM2, 0);
  const grass = sum(GRASS_LEGUMES, t.arable);
  if (t.arableM2 > 0 && grass / t.arableM2 > exemptGrassLegumeShare) {
    return `${formatPct(grass / t.arableM2)} des terres arables en herbe, légumineuses ou jachère`;
  }
  return null;
}

function grasslandExemption(parcels: Bcae7Parcel[], sauM2: number): string | null {
  const g = parcels.filter((p) => p.main && GRASSLAND_SAU.has(p.main.toUpperCase())).reduce((s, p) => s + p.areaM2, 0);
  return sauM2 > 0 && g / sauM2 > BCAE7_2026.exemptPermanentGrasslandShare
    ? `${formatPct(g / sauM2)} de la surface en prairies permanentes, prairies temporaires ou riz`
    : null;
}

const rotatesByNature = (code: string) => BY_DEFAULT.has(code.toUpperCase()) || !!bcae7Category(code)?.rotationByNature;
const secondaryDiffers = (p: Bcae7Parcel) => p.secondary.some((s) => s === null || bcae7CropKey(s) !== bcae7CropKey(p.main!));

/** §3 A : au moins 35 % des terres arables cultivées changent de culture ou portent une culture secondaire. */
function bcae7Annual(t: Totals, farm: Bcae7Farm): ControlFinding {
  const source = src(BCAE7_2026_AT.annual);
  const base = t.cultivated.reduce((s, p) => s + p.areaM2, 0);
  if (base === 0) return finding({ ruleId: "pac.bcae7.annual", level: "na", message: "Rotation annuelle : pas de terres arables cultivées.", source });
  let rotated = 0;
  let unknown = 0;
  const unknownParcels: Bcae7Parcel[] = [];
  const sameCrop: Bcae7Parcel[] = [];
  for (const p of t.cultivated) {
    if (rotatesByNature(p.main!) || secondaryDiffers(p)) {
      rotated += p.areaM2;
      continue;
    }
    for (const part of p.history) {
      const prev = part.years[farm.year - 1];
      if (!prev || prev.main === null) {
        unknown += p.areaM2 * part.share;
        if (!unknownParcels.includes(p)) unknownParcels.push(p);
      } else if (bcae7CropKey(prev.main) !== bcae7CropKey(p.main!)) rotated += p.areaM2 * part.share;
      else if (!sameCrop.includes(p)) sameCrop.push(p);
    }
  }
  const min = BCAE7_2026.annualMinShare;
  const share = rotated / base;
  const head = `Rotation annuelle : ${formatPct(share)} des terres arables cultivées (${formatHa(rotated)} sur ${formatHa(base)}) changent de culture ou portent une culture secondaire, ${formatPct(min)} attendus.`;
  const common = { ruleId: "pac.bcae7.annual", value: Math.round(share * 1000) / 10, threshold: min * 100, unit: "%", source };
  if (share >= min) return finding({ ...common, level: "ok", message: head });
  const keys = unknownParcels.map((p) => p.key);
  if ((rotated + unknown) / base >= min) {
    return finding({
      ...common,
      level: "missing",
      message: `${head} Culture de ${farm.year - 1} inconnue sur ${formatHa(unknown)}.`,
      refs: { parcelIds: keys },
      missing: unknownParcels.map((p) => missing(`culture principale ${farm.year - 1} (code PAC) de ${p.name}`, "parcel", p.key)),
    });
  }
  const gap = min * base - rotated - unknown;
  return finding({
    ...common,
    level: gapLevel(gap, base),
    message: `${head} Il manque ${formatHa(gap)} : changer de culture ou implanter une culture secondaire à l'automne ${farm.year}.`,
    refs: { parcelIds: sameCrop.map((p) => p.key) },
  });
}

/** §3 B : sur n-3 à n, au moins deux cultures principales différentes par parcelle, ou une culture secondaire chaque année. */
function bcae7Multiannual(t: Totals, farm: Bcae7Farm): ControlFinding {
  const source = src(BCAE7_2026_AT.multiannual);
  const base = t.cultivated.reduce((s, p) => s + p.areaM2, 0);
  if (base === 0) return finding({ ruleId: "pac.bcae7.multiannual", level: "na", message: "Rotation pluriannuelle : pas de terres arables cultivées.", source });
  const years = Array.from({ length: BCAE7_2026.multiannualYears - 1 }, (_, i) => farm.year - BCAE7_2026.multiannualYears + 1 + i);
  const failing: { p: Bcae7Parcel; m2: number }[] = [];
  const unknown: Bcae7Parcel[] = [];
  for (const p of t.cultivated) {
    if (rotatesByNature(p.main!)) continue;
    let failM2 = 0;
    let isUnknown = false;
    for (const part of p.history) {
      const keys = new Set([bcae7CropKey(p.main!)]);
      let excluded = false;
      let anyUnknown = false;
      let secondaryEveryYear = p.secondary.length > 0;
      for (const y of years) {
        const c = part.years[y];
        if (!c || c.main === null) {
          anyUnknown = true;
          secondaryEveryYear = false;
          continue;
        }
        const cls = bcae7Class(c.main);
        if (cls === "arable-excluded" || cls === "not-exploited") excluded = true;
        keys.add(bcae7CropKey(c.main));
        if (!c.secondary) secondaryEveryYear = false;
      }
      if (keys.size >= BCAE7_2026.multiannualMinCategories || excluded || secondaryEveryYear) continue;
      if (anyUnknown) isUnknown = true;
      else failM2 += p.areaM2 * part.share;
    }
    if (failM2 > 0) failing.push({ p, m2: failM2 });
    else if (isUnknown) unknown.push(p);
  }
  const period = `${years[0]} à ${farm.year}`;
  const failM2 = failing.reduce((s, f) => s + f.m2, 0);
  const common = { ruleId: "pac.bcae7.multiannual", source };
  if (failing.length) {
    return finding({
      ...common,
      level: gapLevel(failM2, base),
      message: `Rotation pluriannuelle (${period}) : même culture principale chaque année sur ${failing.map((f) => f.p.name).join(", ")} (${formatHa(failM2)}).`,
      value: Math.round(failM2 / 100) / 100,
      unit: "ha",
      refs: { parcelIds: failing.map((f) => f.p.key) },
      missing: unknown.map((p) => missing(`cultures principales ${period} de ${p.name}`, "parcel", p.key)),
    });
  }
  if (unknown.length) {
    return finding({
      ...common,
      level: "missing",
      message: `Rotation pluriannuelle (${period}) : historique incomplet pour ${unknown.map((p) => p.name).join(", ")}.`,
      refs: { parcelIds: unknown.map((p) => p.key) },
      missing: unknown.map((p) => missing(`cultures principales ${period} de ${p.name}`, "parcel", p.key)),
    });
  }
  return finding({ ...common, level: "ok", message: `Rotation pluriannuelle (${period}) : au moins deux cultures principales sur chaque parcelle cultivée.` });
}

/** §5 : au moins deux (10 à 30 ha) ou trois cultures (plus de 30 ha), culture principale ≤ 75 %, deux principales ≤ 95 %. */
function bcae7Diversification(t: Totals, farm: Bcae7Farm): ControlFinding {
  const common = { ruleId: "pac.bcae7.diversification", source: src(BCAE7_2026_AT.diversification) };
  if (farm.alsaceRhinePlain) {
    return finding({
      ...common,
      source: src(BCAE7_2026_AT.alsace),
      level: "warning",
      message: `Plaine du Rhin : la diversification se mesure au barème à points (annexe 5, au moins ${BCAE7_2026.alsaceMinPoints} points), que Fourmy ne calcule pas encore. À vérifier.`,
    });
  }
  const ta = t.arableM2;
  const missingCodes = t.unknown.map((p) => missing(`code PAC de la culture prévue sur ${p.name}`, "parcel", p.key));
  // Terres arables connues sous le seuil : les parcelles sans code décident (exemption ou non).
  if (ta <= BCAE7_2026.diversification.smallFarm.fromHa * HA) {
    return finding({ ...common, level: "missing", message: `Diversification : ${formatHa(ta)} de terres arables connues ; cultures à préciser pour conclure.`, missing: missingCodes });
  }
  const crops = new Map<string, number>();
  for (const p of t.arable) {
    if (bcae7Class(p.main) === "not-exploited") continue;
    const k = bcae7CropKey(p.main!);
    crops.set(k, (crops.get(k) ?? 0) + p.areaM2);
  }
  const sorted = [...crops].sort((a, b) => b[1] - a[1]);
  const large = ta > BCAE7_2026.diversification.largeFarm.fromHa * HA;
  const rule = large ? BCAE7_2026.diversification.largeFarm : BCAE7_2026.diversification.smallFarm;
  const [first, second] = sorted;
  const mainShare = first && ta > 0 ? first[1] / ta : 0;
  const listing = sorted
    .slice(0, 4)
    .map(([k, m2]) => `${bcae7Label(k)} ${formatPct(ta > 0 ? m2 / ta : 0)}`)
    .join(", ");
  const head = `Diversification : ${sorted.length} culture(s) sur ${formatHa(ta)} de terres arables (${listing}${sorted.length > 4 ? "…" : ""}).`;
  if (sorted.length < rule.minCrops) {
    return finding({ ...common, level: "danger", message: `${head} Au moins ${rule.minCrops} cultures attendues.`, value: sorted.length, threshold: rule.minCrops, missing: missingCodes });
  }
  let excess = first ? Math.max(0, first[1] - rule.mainMaxShare * ta) : 0;
  if ("twoMainMaxShare" in rule && first && second) excess += Math.max(0, first[1] + second[1] - rule.twoMainMaxShare * ta);
  if (excess > 0) {
    const limits = "twoMainMaxShare" in rule ? `culture principale ≤ ${formatPct(rule.mainMaxShare)}, deux principales ≤ ${formatPct(rule.twoMainMaxShare)}` : `culture principale ≤ ${formatPct(rule.mainMaxShare)}`;
    return finding({
      ...common,
      level: excess <= rule.toleranceHa * HA ? "warning" : "danger",
      message: `${head} Dépassement de ${formatHa(excess)} (${limits}).`,
      value: Math.round(mainShare * 1000) / 10,
      threshold: rule.mainMaxShare * 100,
      unit: "%",
      missing: missingCodes,
    });
  }
  return finding({ ...common, level: "ok", message: head, missing: missingCodes });
}

/**
 * Verdict de la BCAE 7 : exemption, sinon le meilleur des deux critères
 * (rotation : annuel et pluriannuel ; diversification). Le critère non
 * retenu reste affiché, sans compter.
 */
/** Les trois critères bruts, avant le verdict (le critère non retenu y garde son niveau). */
export function bcae7Criteria(parcels: Bcae7Parcel[], farm: Bcae7Farm) {
  const t = totals(parcels);
  return {
    totals: { sauM2: t.sauM2, arableM2: t.arableM2, cultivatedM2: t.cultivated.reduce((s, p) => s + p.areaM2, 0) },
    exemption: exemption(t, farm) ?? grasslandExemption(parcels, t.sauM2),
    annual: bcae7Annual(t, farm),
    multiannual: bcae7Multiannual(t, farm),
    diversification: bcae7Diversification(t, farm),
  };
}

export function bcae7Findings(parcels: Bcae7Parcel[], farm: Bcae7Farm): ControlFinding[] {
  const { exemption: exempt, annual, multiannual: multi, diversification: divers, totals: t } = bcae7Criteria(parcels, farm);
  if (exempt) {
    return [finding({ ruleId: "pac.bcae7", level: "na", message: `BCAE 7 : exploitation exemptée (${exempt}).`, source: src(BCAE7_2026_AT.exemptions) })];
  }
  const rotationLevel = worst(annual.level, multi.level);
  const viaRotation = !farm.alsaceRhinePlain;
  const best: "rotation" | "diversification" = viaRotation && ORDER[rotationLevel] <= ORDER[divers.level] ? "rotation" : "diversification";
  let level = best === "rotation" ? rotationLevel : divers.level;
  const underSau = t.sauM2 < BCAE7_2026.noControlUnderSauHa * HA;

  let message: string;
  if (level === "na") {
    message = "BCAE 7 : pas de terres arables cultivées à vérifier.";
  } else if (level === "ok") {
    message = rotationLevel === "ok" && divers.level === "ok" && viaRotation ? "BCAE 7 respectée par la rotation et par la diversification." : `BCAE 7 respectée par la ${best}.`;
  } else if (level === "missing") {
    message = `BCAE 7 : données manquantes pour conclure (meilleur critère : ${best}).`;
  } else if (level === "warning") {
    message = `BCAE 7 : écart faible (${best}), alerte sans réduction des aides.`;
  } else {
    message = viaRotation ? "BCAE 7 non respectée : ni la rotation ni la diversification." : "BCAE 7 non respectée (diversification).";
  }
  // Pas de faux vert : des parcelles sans code culture peuvent changer le résultat.
  const unknownParcels = parcels.filter((p) => bcae7Class(p.main) === "unknown");
  if (unknownParcels.length && (level === "ok" || level === "na")) {
    level = "missing";
    message = `BCAE 7 : ${unknownParcels.length} parcelle(s) sans culture prévue ou sans code PAC (${unknownParcels.map((p) => p.name).join(", ")}) : à préciser pour conclure.`;
  }
  if (underSau && level === "danger") {
    level = "warning";
    message += ` SAU de ${formatHa(t.sauM2)} : pas de contrôle sous ${BCAE7_2026.noControlUnderSauHa} ha en ${farm.year}.`;
  }

  // Le critère non retenu ne compte pas quand l'autre est respecté.
  const asInfo = (f: ControlFinding, other: string): ControlFinding => ({ ...f, level: "na", message: `${f.message} (Critère non retenu : la BCAE 7 est respectée par la ${other}.)` });
  let details = [annual, multi, divers];
  if (level === "ok") {
    details = best === "rotation" ? [annual, multi, divers.level === "ok" ? divers : asInfo(divers, "rotation")] : [rotationLevel === "ok" ? annual : asInfo(annual, "diversification"), rotationLevel === "ok" ? multi : asInfo(multi, "diversification"), divers];
  }
  if (!viaRotation) details = [divers];
  return [finding({ ruleId: "pac.bcae7", level, message, source: src(BCAE7_2026_AT.sanctions) }), ...details];
}

/** Codes culture d'une parcelle du brouillon pour la BCAE 7 (culture principale, cultures secondaires). */
export function bcae7Parcels(
  plan: ResolvedPlan,
  draft: CropPlanDraft,
  activities: ReadonlyMap<string, CropPlanActivity>,
  history: CropPlanHistory,
): Bcae7Parcel[] {
  const pivot = `${draft.year}-06-01`; // culture principale : en place du 1er mars au 15 juillet
  const secondaryFrom = `${draft.year}-11-15`;
  const secondaryTo = `${draft.year + 1}-02-15`;
  return plan.parcels.map((p) => {
    const mains = draft.assignments.filter((a) => a.key === p.key && a.role === "main");
    const main = mains.find((a) => (!a.startedOn || a.startedOn <= pivot) && (!a.stoppedOn || a.stoppedOn >= pivot)) ?? mains[0];
    const fallow = draft.fallow.find((f) => f.key === p.key);
    const code = main ? (activities.get(main.activityId)?.capCode ?? null) : fallow ? (fallow.capCode ?? "JAC") : null;
    const secondary: (string | null)[] = [
      ...draft.assignments.filter((a) => a.key === p.key && a.role === "secondary").map((a) => activities.get(a.activityId)?.capCode ?? null),
      // Couvert : implanté au plus tard le 15 novembre, en place jusqu'au 15 février (§3 A).
      ...draft.covers
        .filter((c) => c.key === p.key && c.kind === "sown" && (!c.sownOn || c.sownOn <= secondaryFrom) && (!c.destroyedOn || c.destroyedOn >= secondaryTo))
        .map(() => null),
    ];
    return { key: p.key, name: p.name, areaM2: p.areaM2, main: code, secondary, history: historyOf(p, history) };
  });
}
