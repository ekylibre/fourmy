/**
 * Extraction du barème BCMA (guides CEGARA « Coût des façons culturales »)
 * vers `data/bcma-<édition>.csv` et `src/work/bcma-<édition>.ts` (lot IT4,
 * claudedocs/conception_assolement_itk.md §15.3). Accord du CEGARA et du
 * BCMA du 21/11/2026 ; les PDF ne sont pas versionnés.
 *
 *   pdftotext -layout guidepratique_baremebcma_faconsculturales_2024.pdf gc.txt
 *   pdftotext -layout guidepratique_baremebcma_faconsculturales_vitiarbo_2024.pdf va.txt
 *   node --experimental-strip-types scripts/extract-bcma.ts 2024 gc.txt va.txt
 *
 * Lecture : une famille (« Semis  hectares ») puis ses matériels ; une ligne
 * de matériel porte 7 nombres (prix, utilisation annuelle, coût fixe, coût
 * variable, coût par unité, performance par heure, coût horaire). Un libellé
 * trop long est coupé par le PDF autour de la ligne des nombres : la ligne
 * d'avant et celle d'après sont recollées.
 */
import { readFileSync, writeFileSync } from "node:fs";

export interface BcmaRow {
  id: string;
  guide: string;
  family: string;
  unit: string;
  label: string;
  widthM: number | null;
  purchasePrice: number;
  annualUse: number;
  fixedCost: number;
  variableCost: number;
  costPerUnit: number;
  performancePerH: number;
  costPerHour: number;
}

const UNITS = "heures|hectares|voyages|m3|tonnes|balles|km|jours|quintaux|sacs|kg|rangs|pieds|arbres|litres|unités";
const FAMILY = new RegExp(`^(\\S.*?)\\s{3,}(${UNITS})\\s*$`);
const UNIT_ONLY = new RegExp(`^(${UNITS})$`);
const NUM = String.raw`(\d{1,3}(?: \d{3})*(?:,\d+)?|-)`;
const ROW = new RegExp(String.raw`^(.*?)\s*${NUM}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}(?:\s+(.*?))?\s*$`);
const JUNK = /CEGARA|Barème annuel|Prix d'achat|Quantité|d'unités|d'utilisation|^\s*unité\s*$|moyen\s*$|Variat|Perfor|mance en|\/\s*n-1|SOURCE|Coûts standards|Ces coûts|Familles de matériels|financier sur|calcul dite|par unité/;
const NUMBER_ONLY = /^\d+$/;

const num = (s: string) => (s === "-" ? 0 : Number(s.replace(/ /g, "").replace(",", ".")));
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);

/** Largeur de travail lue dans le libellé (« 4 m », « 3.5 m », « rampe 24 m ») ; null sinon. */
export function widthOf(label: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*m\b(?!\s*3)/.exec(label);
  if (!m) return null;
  const w = Number(m[1]!.replace(",", "."));
  return w > 0 && w <= 60 ? w : null;
}

export function parseBcma(text: string, guide: string): { rows: BcmaRow[]; unread: string[] } {
  // Symboles de la colonne « Variation » (police à usage privé) : retirés.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[\uE000-\uF8FF]/g, " ").replace(/\s+$/, ""));
  const rows: BcmaRow[] = [];
  const unread: string[] = [];
  let family: { name: string; unit: string } | null = null;
  let pending: string | null = null; // texte avant une ligne de nombres sans libellé
  let afterSplit = false; // la ligne de texte suivante termine le libellé coupé
  let familyContinues = false; // en-tête de famille coupé (« Travail du sol profond ou semi- » / « hectares » / « profond »)
  // Le tableau récapitulatif du début (familles et nombres de matériels) se termine par « TOTAL ».
  const start = lines.findIndex((l) => /^TOTAL\b/.test(l.trim()));
  const body = lines.slice(start + 1).filter((l) => l.trim() && !JUNK.test(l));
  /** La ligne suivante est une ligne de nombres sans libellé : le texte courant commence son libellé. */
  const leadsNext = (k: number) => {
    const next = body[k + 1]?.trim();
    const r = next ? ROW.exec(next) : null;
    return !!r && !r[1]!.trim();
  };
  for (const [k, raw] of body.entries()) {
    const line = raw.trim();
    // Fin numérique d'un libellé coupé (« 120 x » / « 160 ») ; sinon un numéro de page.
    if (NUMBER_ONLY.test(line) && !(afterSplit && rows.length)) continue;
    const u = UNIT_ONLY.exec(line);
    if (u && pending) {
      family = { name: pending, unit: u[1]! };
      pending = null;
      afterSplit = false;
      familyContinues = true;
      continue;
    }
    const f = FAMILY.exec(line);
    if (f && !/\d{2,}/.test(f[1]!)) {
      family = { name: f[1]!.trim(), unit: f[2]! };
      pending = null;
      afterSplit = false;
      continue;
    }
    const r = ROW.exec(line);
    if (r && family) {
      const own = r[1]!.trim();
      const tail = (r[9] ?? "").trim();
      familyContinues = false;
      const label = [pending, own].filter(Boolean).join(" ");
      if (!label) {
        unread.push(raw);
        continue;
      }
      const row: BcmaRow = {
        id: "",
        guide,
        family: family.name,
        unit: family.unit,
        label: [label, tail].filter(Boolean).join(" "),
        widthM: null,
        purchasePrice: num(r[2]!),
        annualUse: num(r[3]!),
        fixedCost: num(r[4]!),
        variableCost: num(r[5]!),
        costPerUnit: num(r[6]!),
        performancePerH: num(r[7]!),
        costPerHour: num(r[8]!),
      };
      rows.push(row);
      // Libellé sur deux lignes (avant, après) ou trois (avant, sur la ligne, après).
      afterSplit = !own || !!pending;
      pending = null;
      continue;
    }
    if (familyContinues && family) {
      family = { ...family, name: `${family.name}${family.name.endsWith("-") ? "" : " "}${line}` };
      familyContinues = false;
      continue;
    }
    if (afterSplit && rows.length && !leadsNext(k)) {
      // Fin d'un libellé coupé (« gravitaire 3 m »).
      rows.at(-1)!.label = `${rows.at(-1)!.label} ${line}`;
      afterSplit = false;
      continue;
    }
    if (pending) unread.push(pending);
    pending = line;
  }
  const seen = new Map<string, number>();
  for (const r of rows) {
    r.label = r.label.replace(/\s+/g, " ").trim();
    r.widthM = widthOf(r.label);
    const base = `${slug(r.family).slice(0, 20)}--${slug(r.label)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    r.id = n > 1 ? `${base}-${n}` : base;
  }
  return { rows, unread };
}

const isMain = process.argv[1]?.endsWith("extract-bcma.ts");
if (isMain) {
  const [edition, ...files] = process.argv.slice(2);
  if (!edition || !files.length) {
    console.error("usage : extract-bcma.ts <édition> <texte grandes cultures> [<texte viti-arbo>]");
    process.exit(1);
  }
  const guides = ["Coût des façons culturales", "Coût des façons culturales viti-arbo"];
  const all: BcmaRow[] = [];
  files.forEach((f, k) => {
    const { rows, unread } = parseBcma(readFileSync(f, "utf8"), `${guides[k] ?? f} ${edition}`);
    console.log(`${f} : ${rows.length} matériels lus, ${unread.length} lignes de texte non rattachées`);
    for (const u of unread.slice(0, 15)) console.log(`  ? ${u.trim()}`);
    // Ids uniques entre guides (un même matériel peut figurer dans les deux).
    for (const r of rows) if (all.some((a) => a.id === r.id)) r.id = `${r.id}--va`;
    all.push(...rows);
  });
  const cols: (keyof BcmaRow)[] = ["id", "guide", "family", "unit", "label", "widthM", "purchasePrice", "annualUse", "fixedCost", "variableCost", "costPerUnit", "performancePerH", "costPerHour"];
  const csv = [cols.join(";"), ...all.map((r) => cols.map((c) => String(r[c] ?? "").replace(/;/g, ",")).join(";"))].join("\n") + "\n";
  writeFileSync(new URL(`../data/bcma-${edition}.csv`, import.meta.url), csv);
  const ts = `/* Généré par scripts/extract-bcma.ts : ne pas modifier à la main. */
import type { MachineryRate } from "./machinery-rates.js";

/** Barème BCMA ${edition} (guides CEGARA « Coût des façons culturales »), ${all.length} matériels. */
export const BCMA_${edition}: readonly MachineryRate[] = ${JSON.stringify(all.map(({ guide: _g, ...r }) => r))};
`;
  writeFileSync(new URL(`../src/work/bcma-${edition}.ts`, import.meta.url), ts);
  console.log(`${all.length} matériels écrits.`);
}
