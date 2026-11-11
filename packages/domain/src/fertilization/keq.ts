import { naProKeq, type CropGroup, type KeqCell, type ProCropColumn } from "@fourmy/fertilization-refs";
import { isMaizeOrSorghum, isStrawCereal } from "./crops.js";

/**
 * Équivalent engrais minéral des produits organiques (lot AO) : annexe 5 du
 * référentiel GREN Nouvelle-Aquitaine. Xa = Npro × Q × Keq, soit l'azote total
 * apporté × Keq.
 * - Apport après l'ouverture du bilan : Keq bilan (= Keq cycle), compté dans Xa.
 * - Apport avant l'ouverture : Keq Ri (dans l'APL qui estime Ri) et Keq bilan
 *   (dans Xa) ; Keq cycle = Keq Ri + Keq bilan.
 * - Précédent : Keq cycle (APL).
 * L'annexe ne date pas ses périodes ; Fourmy retient : « fin d'été » jusqu'au
 * 15/09, « automne » ensuite jusqu'à l'ouverture, « printemps » (ou « après
 * ouverture » pour le colza) après l'ouverture.
 */

export function keqColumnOf(crop: CropGroup): ProCropColumn {
  if (isStrawCereal(crop)) return "straw_cereals";
  if (crop === "rapeseed_winter") return "rapeseed";
  if (isMaizeOrSorghum(crop) || crop === "tobacco") return "maize_sorghum_tobacco";
  if (crop === "grassland") return "grassland";
  return "other_crops";
}

export interface KeqApplication {
  date: string;
  product: string;
  /** Ligne de l'annexe 5 (clé), choisie dans la fiche du fertilisant. */
  proKey: string | null;
  /** Azote total apporté (kg N/ha) : Npro × Q. */
  nTotalKgHa: number;
}

export interface KeqResult {
  date: string;
  product: string;
  nTotalKgHa: number;
  /** Part comptée dans Xa (Keq bilan), dans l'APL (Keq Ri) ou pour le précédent (Keq cycle). */
  xa: number;
  ri: number;
  keq: { bilan: number | null; ri: number | null; cycle: number | null };
  period: string;
  missing: string | null;
  notRecommended: boolean;
}

const cell = (c: KeqCell | undefined): number | null | "missing" => (c === undefined ? null : typeof c === "number" ? c : c === "ng" ? 0 : "missing");
const md = (d: string) => d.slice(5, 10);

export function keqOf(a: KeqApplication, crop: CropGroup, openingOn: string | null, use: "campaign" | "previous"): KeqResult {
  const column = keqColumnOf(crop);
  const before = openingOn !== null && a.date < openingOn;
  const raw = use === "previous" ? (md(a.date) >= "07-01" && md(a.date) <= "09-15" ? "late_summer" : md(a.date) >= "09-16" || md(a.date) < "02-01" ? "autumn" : "spring")
    : !before ? (column === "rapeseed" ? "after_opening" : "spring")
    : md(a.date) >= "07-01" && md(a.date) <= "09-15" ? "late_summer" : "autumn";
  // Prairies et autres cultures : l'annexe n'a que « automne » et « printemps ».
  const period = (column === "grassland" || column === "other_crops") && raw === "late_summer" ? "autumn" : raw;
  const label = { late_summer: "apport de fin d'été", autumn: "apport d'automne", spring: "apport de printemps", after_opening: "apport après ouverture du bilan" }[period]!;
  const base = { date: a.date, product: a.product, nTotalKgHa: a.nTotalKgHa, period: label, xa: 0, ri: 0, keq: { bilan: null, ri: null, cycle: null }, notRecommended: false };
  if (!a.proKey) return { ...base, missing: "ligne de l'annexe 5 à choisir dans la fiche du fertilisant (Stocks → Fertilisants)" };
  const row = naProKeq.rows.find((r) => r.product === a.proKey && r.cropColumn === column && r.periods.includes(period as never));
  if (!row) return { ...base, missing: `annexe 5 sans valeur pour cette culture et cette période (${label})` };
  if (column === "grassland" || column === "other_crops") {
    const k = cell(row.keq);
    if (k === "missing" || k === null) return { ...base, missing: `Keq non référencé à l'annexe 5 (${label})` };
    return { ...base, xa: use === "campaign" ? a.nTotalKgHa * k : 0, ri: 0, keq: { bilan: k, ri: null, cycle: k }, missing: null, notRecommended: !!row.notRecommended };
  }
  const bilan = cell(row.keqBilan);
  const ri = cell(row.keqRi);
  const cycle = cell(row.keqCycle);
  const need = use === "previous" ? [cycle] : before ? (column === "rapeseed" ? [bilan] : [bilan, ri]) : [bilan];
  if (need.some((x) => x === "missing" || x === null)) return { ...base, missing: `Keq non référencé à l'annexe 5 (${label}) : valeur à saisir` };
  const n = (x: number | null | "missing") => (typeof x === "number" ? x : null);
  return {
    ...base,
    keq: { bilan: n(bilan), ri: n(ri), cycle: n(cycle) },
    xa: use === "previous" ? a.nTotalKgHa * (n(cycle) ?? 0) : a.nTotalKgHa * (n(bilan) ?? 0),
    ri: use === "campaign" && before ? a.nTotalKgHa * (n(ri) ?? 0) : 0,
    missing: null,
    notRecommended: !!row.notRecommended,
  };
}

/** Somme des Xa d'une campagne (ou du précédent) ; les apports sans Keq sont nommés. */
export function keqTotal(results: KeqResult[]): { xa: number; ri: number; missing: string[]; detail: string } {
  const ok = results.filter((r) => !r.missing);
  const fmt = (v: number) => Math.round(v * 10) / 10;
  return {
    xa: fmt(ok.reduce((s, r) => s + r.xa, 0)),
    ri: fmt(ok.reduce((s, r) => s + r.ri, 0)),
    missing: results.filter((r) => r.missing).map((r) => `${r.product} du ${r.date.slice(8, 10)}/${r.date.slice(5, 7)} : ${r.missing}`),
    detail: ok.map((r) => `${r.product} du ${r.date.slice(8, 10)}/${r.date.slice(5, 7)} : ${fmt(r.nTotalKgHa)} kg N × Keq ${(r.nTotalKgHa ? Math.round((r.xa / r.nTotalKgHa) * 100) / 100 : 0).toLocaleString("fr-FR")}`).join(" ; "),
  };
}
