/**
 * Grille d'évaluation du risque de perte d'efficacité des apports d'azote
 * minéral (COMIFER et RMT Bouclage, septembre 2022), lot AL, FR-FERT-29.
 * Pour un apport en surface : note du sol (pH, CEC), de la couverture par la
 * culture et du climat (pluie prévue à 3 jours, vent, température du jour),
 * puis qualité des conditions selon la forme d'engrais. La note ne change pas
 * la dose : le COMIFER ne préconise pas de majorer les doses.
 *
 * Une donnée inconnue n'est pas supposée : la note devient une fourchette
 * (le minimum et le maximum possibles), et la qualité aussi.
 */

export type MineralForm = "ammonitrate" | "urea_inhibitor" | "uan" | "urea";
export const MINERAL_FORM_LABELS: Record<MineralForm, string> = {
  ammonitrate: "ammonitrate",
  urea_inhibitor: "urée avec inhibiteur d'uréase",
  uan: "solution azotée",
  urea: "urée solide",
};

export type EfficiencyQuality = "good" | "medium" | "limit" | "avoid";
export const EFFICIENCY_QUALITY_LABELS: Record<EfficiencyQuality, string> = {
  good: "bonnes conditions d'apport, efficacité optimale",
  medium: "conditions moyennes, pertes d'efficacité possibles",
  limit: "conditions limites, risque de pertes d'efficacité significatives",
  avoid: "apport à éviter, efficacité fortement réduite",
};

/** Qualité par forme et par classe de note : < 4, [4-8], [9-13], > 13. */
const QUALITY: Record<MineralForm, [EfficiencyQuality, EfficiencyQuality, EfficiencyQuality, EfficiencyQuality]> = {
  ammonitrate: ["good", "good", "good", "medium"],
  urea_inhibitor: ["good", "good", "good", "medium"],
  uan: ["good", "medium", "limit", "avoid"],
  urea: ["good", "good", "medium", "limit"],
};
const band = (score: number) => (score < 4 ? 0 : score <= 8 ? 1 : score <= 13 ? 2 : 3);
const RANK: EfficiencyQuality[] = ["good", "medium", "limit", "avoid"];

/**
 * Forme d'un engrais minéral d'après son nom et son code Lexicon ; null pour
 * une forme hors grille (NPK, sulfate d'ammoniaque, nitrate de calcium).
 */
export function mineralFormOf(article: { name: string; lexiconRef?: string | null }, composition: { nitrateType: string | null; basis: string } | null): MineralForm | null {
  if (composition && composition.nitrateType !== "III") return null;
  const s = `${article.name} ${article.lexiconRef ?? ""}`.toLowerCase();
  if (/\d+(?:[.,]\d+)?\s*[-–/ ]\s*\d+(?:[.,]\d+)?\s*[-–/ ]\s*\d+/.test(article.name)) return null; // NPK : hors grille
  if (/ur[ée]e|urea/.test(s)) return /inhibit|nbpt|nprtp|2-npt|limus|nexen|utec|agrotain/.test(s) ? "urea_inhibitor" : "urea";
  if (/solution azot|liquid_nitrogen|\buan\b|\bn ?39\b|\bn ?30\b|\bn ?32\b/.test(s)) return "uan";
  if (/ammonitrate|nitrate d'ammonium|\bcan\b|ammonium_nitrate/.test(s)) return "ammonitrate";
  return null;
}

export interface EfficiencyInput {
  form: MineralForm;
  ph: number | null;
  cecMeq: number | null;
  /** Couverture du sol par la culture supérieure à 50 %. */
  coverOver50: boolean | null;
  /** Pluie du jour de l'apport et des deux jours suivants (mm). */
  rain3dMm: number | null;
  /** Vent maximal du jour (km/h). */
  windKmh: number | null;
  /** Température moyenne du jour (°C). */
  temperatureC: number | null;
}

export interface EfficiencyItem {
  criterion: string;
  value: string | null;
  /** Points retenus ; [min, max] si la donnée est inconnue. */
  points: number | [number, number];
}

export interface EfficiencyResult {
  form: MineralForm;
  score: [number, number];
  quality: [EfficiencyQuality, EfficiencyQuality];
  items: EfficiencyItem[];
}

const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

export function efficiencyGrid(i: EfficiencyInput): EfficiencyResult {
  const items: EfficiencyItem[] = [
    { criterion: "pH du sol", value: i.ph === null ? null : fmt(i.ph), points: i.ph === null ? [0, 3] : i.ph < 7 ? 0 : i.ph <= 7.5 ? 2 : 3 },
    { criterion: "CEC", value: i.cecMeq === null ? null : `${fmt(i.cecMeq)} meq/100 g`, points: i.cecMeq === null ? [0, 2] : i.cecMeq < 12 ? 2 : 0 },
    { criterion: "couverture du sol par la culture", value: i.coverOver50 === null ? null : i.coverOver50 ? "plus de 50 %" : "moins de 50 %", points: i.coverOver50 === null ? [-2, 0] : i.coverOver50 ? -2 : 0 },
    { criterion: "pluie prévue à 3 jours", value: i.rain3dMm === null ? null : `${fmt(i.rain3dMm)} mm`, points: i.rain3dMm === null ? [0, 4] : i.rain3dMm < 10 ? 4 : 0 },
    { criterion: "vent", value: i.windKmh === null ? null : `${fmt(i.windKmh)} km/h`, points: i.windKmh === null ? [0, 2] : i.windKmh <= 19 ? 0 : 2 },
    { criterion: "température du jour", value: i.temperatureC === null ? null : `${fmt(i.temperatureC)} °C`, points: i.temperatureC === null ? [0, 6] : i.temperatureC < 6 ? 0 : i.temperatureC <= 13 ? 3 : 6 },
  ];
  const lo = items.reduce((s, x) => s + (Array.isArray(x.points) ? x.points[0] : x.points), 0);
  const hi = items.reduce((s, x) => s + (Array.isArray(x.points) ? x.points[1] : x.points), 0);
  const q = QUALITY[i.form];
  const qualities = [q[band(lo)], q[band(hi)]].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b)) as [EfficiencyQuality, EfficiencyQuality];
  return { form: i.form, score: [lo, hi], quality: qualities, items };
}

/** Phrase de synthèse : « note 11 : conditions limites… » ou « note entre 7 et 13 : … ». */
export function efficiencyMessage(r: EfficiencyResult): string {
  const [lo, hi] = r.score;
  const note = lo === hi ? `note ${lo}` : `note entre ${lo} et ${hi}`;
  const q = r.quality[0] === r.quality[1] ? EFFICIENCY_QUALITY_LABELS[r.quality[0]] : `de « ${EFFICIENCY_QUALITY_LABELS[r.quality[0]]} » à « ${EFFICIENCY_QUALITY_LABELS[r.quality[1]]} »`;
  const unknown = r.items.filter((x) => x.value === null).map((x) => x.criterion);
  const known = r.items.filter((x) => x.value !== null).map((x) => `${x.criterion} ${x.value}`);
  return `Efficacité de l'apport (${MINERAL_FORM_LABELS[r.form]}, grille COMIFER 2022) : ${note}, ${q}.${known.length ? ` D'après : ${known.join(", ")}.` : ""}${unknown.length ? ` Inconnu : ${unknown.join(", ")}.` : ""}`;
}
