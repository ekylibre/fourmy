#!/usr/bin/env node
/**
 * Référentiels de la grille d'audit HVE v1.15 (classeur ministériel) :
 * - planchers et plafonds IFT (onglets Scoring_GC, Scoring_Viticulture,
 *   Scoring_Arboriculture), notation « en cours » et « ancienne » ;
 * - départements → ancienne région et bassin viticole (onglet Paramètres),
 *   communes de l'Ardèche et de la Drôme → partie nord ou sud (Communes_07-26).
 * Écrit src/hve/ift-references.ts et src/hve/regions.ts.
 *
 * Usage : node scripts/extract-hve-grid.mjs "<grille-audit-hvev4-v1.15….xlsx>"
 */
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { colIndex, readXlsx } from "./xlsx.mjs";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage : extract-hve-grid.mjs <grille.xlsx>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const wb = readXlsx(file);
const sheet = (name) => {
  const s = wb.sheets.find((x) => x.name === name);
  if (!s) throw new Error(`onglet ${name} introuvable`);
  return s;
};
const cell = (s, ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return s.rows.get(Number(m[2]))?.get(colIndex(m[1]));
};
const str = (v) => (v === undefined ? "" : String(v).trim());
const num = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : null);
const quad = (s, row, cols) => {
  const v = cols.map((c) => num(cell(s, `${c}${row}`)));
  return v.every((x) => x !== null) ? v : null;
};

// --- IFT : grandes cultures et pomme de terre, par ancienne région -----------------------
const gc = sheet("Scoring_GC");
const GC = { current: {}, old: {} };
const POTATO = { current: {}, old: {} };
for (const row of [...gc.rows.keys()].sort((a, b) => a - b)) {
  if (row < 5) continue;
  const region = str(cell(gc, `B${row}`));
  if (!region || region.startsWith("Source") || region.startsWith("Note") || region.startsWith("Points")) continue;
  const put = (t, key, cols) => {
    const q = quad(gc, row, cols);
    if (q) t[key] = q;
  };
  put(GC.current, region, ["C", "D", "E", "F"]);
  put(POTATO.current, str(cell(gc, `H${row}`)) || region, ["I", "J", "K", "L"]);
  if (str(cell(gc, `N${row}`))) put(GC.old, str(cell(gc, `N${row}`)), ["O", "P", "Q", "R"]);
  if (str(cell(gc, `T${row}`))) put(POTATO.old, str(cell(gc, `T${row}`)), ["U", "V", "W", "X"]);
}

// --- IFT : vigne, par bassin viticole ------------------------------------------------
const vi = sheet("Scoring_Viticulture");
const VINE = { current: {}, old: {} };
for (const row of [...vi.rows.keys()].sort((a, b) => a - b)) {
  if (row < 5) continue;
  const basin = str(cell(vi, `C${row}`));
  if (!basin) continue;
  const cur = quad(vi, row, ["D", "E", "F", "G"]);
  if (cur) VINE.current[basin] = cur;
  const old = quad(vi, row, ["K", "L", "M", "N"]);
  if (old && str(cell(vi, `J${row}`))) VINE.old[str(cell(vi, `J${row}`))] = old;
}

// --- IFT : arboriculture, par région et type de verger ---------------------------------
const ar = sheet("Scoring_Arboriculture");
const ARBO = { current: {}, old: {} };
for (const row of [...ar.rows.keys()].sort((a, b) => a - b)) {
  if (row < 5) continue;
  const region = str(cell(ar, `E${row}`));
  const orchard = str(cell(ar, `F${row}`));
  if (!region || !orchard) continue;
  const cur = quad(ar, row, ["H", "I", "J", "K"]);
  if (cur) ARBO.current[`${region}|${orchard}`] = cur;
  const old = quad(ar, row, ["S", "T", "U", "V"]);
  if (old) ARBO.old[`${str(cell(ar, `P${row}`))}|${str(cell(ar, `Q${row}`))}`] = old;
}

// --- Départements, anciennes régions, bassins viticoles ---------------------------------
const pa = sheet("Paramètres");
const DEPARTMENTS = {};
const BASIN_KEYS = {};
for (const row of [...pa.rows.keys()].sort((a, b) => a - b)) {
  if (row < 5) continue;
  const code = str(cell(pa, `BB${row}`));
  if (code) DEPARTMENTS[code.padStart(2, "0")] = { name: str(cell(pa, `BC${row}`)), oldRegion: str(cell(pa, `BE${row}`)) };
  const key = str(cell(pa, `BI${row}`));
  if (key) BASIN_KEYS[key] = str(cell(pa, `BH${row}`));
}
const co = sheet("Communes_07-26");
const COMMUNES = {};
for (const row of [...co.rows.keys()].sort((a, b) => a - b)) {
  if (row < 6) continue;
  const insee = str(cell(co, `C${row}`));
  const part = str(cell(co, `B${row}`)).toLowerCase();
  if (/^\d{5}$/.test(insee) && /nord|sud/.test(part)) COMMUNES[insee] = part.includes("nord") ? "nord" : "sud";
}

const source = (at) => `{ text: "Grille d'audit HVE niveau 3 V4 (ministère de l'Agriculture)", version: "v1.15", at: ${JSON.stringify(`${basename(file)}, ${at}`)} }`;
const table = (t) => `{\n${Object.entries(t).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}\n  }`;
const pair = (t) => `{\n  current: ${table(t.current)},\n  old: ${table(t.old)},\n}`;

writeFileSync(
  join(here, "..", "src", "hve", "ift-references.ts"),
  `// Fichier généré par scripts/extract-hve-grid.mjs : ne pas modifier à la main.
import type { RefSource } from "../source.js";

/**
 * Planchers (Pc, 20e percentile) et plafonds (Pf, 70e percentile) de l'IFT,
 * herbicides puis hors herbicides : [Pc herbicides, Pf herbicides, Pc hors
 * herbicides, Pf hors herbicides]. Notation « en cours » (enquêtes SSP 2014,
 * 2017, 2021) et « ancienne » (admise jusqu'à la campagne 2025 pour les
 * exploitations déjà certifiées V4).
 */
export type IftReference = [number, number, number, number];
export interface IftScales {
  current: Record<string, IftReference>;
  old: Record<string, IftReference>;
}

/** Grandes cultures, par ancienne région. */
export const IFT_FIELD_CROPS: IftScales = ${pair(GC)};
export const IFT_FIELD_CROPS_SOURCE: RefSource = ${source("onglet Scoring_GC, colonnes B-F et N-R")};

/** Pomme de terre, par ancienne région (références recalées sur sa part dans l'assolement). */
export const IFT_POTATO: IftScales = ${pair(POTATO)};
export const IFT_POTATO_SOURCE: RefSource = ${source("onglet Scoring_GC, colonnes H-L et T-X")};

/** Vigne, par bassin viticole. */
export const IFT_VINE: IftScales = ${pair(VINE)};
export const IFT_VINE_SOURCE: RefSource = ${source("onglet Scoring_Viticulture")};

/** Arboriculture, par « région|verger ». */
export const IFT_ORCHARD: IftScales = ${pair(ARBO)};
export const IFT_ORCHARD_SOURCE: RefSource = ${source("onglet Scoring_Arboriculture")};
`,
);

writeFileSync(
  join(here, "..", "src", "hve", "regions.ts"),
  `// Fichier généré par scripts/extract-hve-grid.mjs : ne pas modifier à la main.
import type { RefSource } from "../source.js";

export const HVE_REGIONS_SOURCE: RefSource = ${source("onglets Paramètres (BB-BI) et Communes_07-26")};

/** Département → nom, ancienne région (références IFT grandes cultures). */
export const HVE_DEPARTMENTS: Record<string, { name: string; oldRegion: string }> = ${table(DEPARTMENTS)};

/**
 * Clé de bassin (nom du département, avec « Partie nord/sud » pour l'Ardèche
 * et la Drôme, « Périmètre AOC Beaujolais » ou non pour le Rhône et la
 * Saône-et-Loire) → bassin viticole des références IFT vigne.
 */
export const HVE_VINE_BASIN_KEYS: Record<string, string> = ${table(BASIN_KEYS)};

/** Communes de l'Ardèche et de la Drôme : partie nord ou sud (code INSEE 2021). */
export const HVE_COMMUNES_07_26: Record<string, "nord" | "sud"> = ${table(COMMUNES)};
`,
);
console.log(
  JSON.stringify({
    gc: [Object.keys(GC.current).length, Object.keys(GC.old).length],
    potato: [Object.keys(POTATO.current).length, Object.keys(POTATO.old).length],
    vine: [Object.keys(VINE.current).length, Object.keys(VINE.old).length],
    orchard: [Object.keys(ARBO.current).length, Object.keys(ARBO.old).length],
    departments: Object.keys(DEPARTMENTS).length,
    basinKeys: Object.keys(BASIN_KEYS).length,
    communes: Object.keys(COMMUNES).length,
  }),
);
