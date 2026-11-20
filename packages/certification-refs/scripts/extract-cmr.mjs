#!/usr/bin/env node
/**
 * Liste ministérielle des produits phytopharmaceutiques classés CMR (HVE,
 * item 5.1) : un onglet par version datée. Écrit src/hve/cmr/<date>.ts, une
 * table par n° d'autorisation (PCP compris) : classe CMR1 ou CMR2, herbicide.
 *
 * Usage : node scripts/extract-cmr.mjs "<HVE_Liste des PPP classés CMR….xlsx>"
 */
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "./xlsx.mjs";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage : extract-cmr.mjs <classeur CMR.xlsx>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const out = [];
for (const sheet of readXlsx(file).sheets) {
  const title = String(sheet.rows.get(2)?.get(0) ?? "");
  const m = /Version du (\d{2})\/(\d{2})\/(\d{4})/.exec(title);
  if (!m) throw new Error(`${sheet.name} : date de version introuvable (« ${title} »)`);
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  const header = [...sheet.rows.entries()].find(([, r]) => r.get(1) === "N° d'autorisation");
  if (!header) throw new Error(`${sheet.name} : en-tête introuvable`);
  const H = header[1];
  const col = (label) => [...H.entries()].find(([, v]) => String(v).startsWith(label))?.[0];
  const cAuth = col("N° d'autorisation"), cAmm = col("N° AMM"), cFn = col("Fonctions"), cCmr = col("CMR 1 ou CMR 2");
  const table = new Map();
  let lines = 0;
  for (const [n, r] of [...sheet.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (n <= header[0]) continue;
    const auth = r.get(cAuth);
    const cls = String(r.get(cCmr) ?? "").replace(/\s/g, "").toUpperCase();
    if (auth === undefined || !/^CMR[12]$/.test(cls)) continue;
    lines++;
    const key = String(auth).trim();
    const herbicide = /herbicide/i.test(String(r.get(cFn) ?? ""));
    const prev = table.get(key);
    // Un n° d'autorisation, plusieurs noms : on garde la classe la plus grave.
    const c = prev && prev.c === 1 ? 1 : cls === "CMR1" ? 1 : 2;
    table.set(key, { c, h: (prev?.h ?? false) || herbicide, amm: String(r.get(cAmm) ?? key).trim() });
  }
  const entries = [...table.entries()].sort(([a], [b]) => a.localeCompare(b));
  const ident = `CMR_${date.replace(/-/g, "_")}`;
  writeFileSync(
    join(here, "..", "src", "hve", "cmr", `${date}.ts`),
    `// Fichier généré par scripts/extract-cmr.mjs : ne pas modifier à la main.
import type { RefSource } from "../../source.js";

export const ${ident}_SOURCE: RefSource = {
  text: "Liste des PPP classés CMR 1 et 2 (ministère de l'Agriculture, HVE)",
  version: ${JSON.stringify(date)},
  at: ${JSON.stringify(`${basename(file)}, onglet « ${sheet.name} » (${lines} lignes, ${entries.length} n° d'autorisation)`)},
};

/** N° d'autorisation → classe (« 1 » ou « 2 ») et « h » si herbicide. */
export const ${ident}: Record<string, string> = {
${entries.map(([k, v]) => `  ${JSON.stringify(k)}: "${v.c}${v.h ? "h" : ""}",`).join("\n")}
};
`,
  );
  out.push({ date, lines, products: entries.length, cmr1: entries.filter(([, v]) => v.c === 1).length });
}
console.log(JSON.stringify(out));
