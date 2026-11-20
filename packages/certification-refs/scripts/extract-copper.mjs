#!/usr/bin/env node
/**
 * Teneur en cuivre métal des produits phytopharmaceutiques, extraite du
 * catalogue E-Phy (data.gouv.fr, « decisionamm-intrant-format-csv », fichier
 * produits_utf8.csv) : Lexicon ne garde que « Copper compounds », sans dire si
 * la teneur est celle du cuivre ou du composé.
 *
 * Usage : node scripts/extract-copper.mjs <produits_utf8.csv> <date du jeu AAAA-MM-JJ>
 * Écrit src/ab/copper-ephy.ts. Les règles de conversion sont dans src/ab/copper.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [file, date] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage : extract-copper.mjs <produits_utf8.csv> <AAAA-MM-JJ>");
  process.exit(1);
}

/** CSV « ; » avec guillemets éventuels. */
function parse(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const [header, ...rows] = parse(readFileSync(file, "utf8"));
const col = (name) => header.findIndex((h) => h.trim() === name);
const iAmm = col("numero AMM"), iSub = col("Substances actives"), iName = col("nom produit");
if (iAmm < 0 || iSub < 0) throw new Error("colonnes « numero AMM » ou « Substances actives » introuvables");

const out = {};
for (const r of rows) {
  const amm = r[iAmm]?.trim();
  if (!amm) continue;
  const parts = (r[iSub] ?? "").split(" | ").filter((s) => s.includes("(Copper compounds)"));
  if (!parts.length) continue;
  // Un produit peut citer deux fois la même substance (doublon E-Phy) : une seule fois.
  out[amm] = { name: r[iName]?.trim() ?? "", substances: [...new Set(parts.map((s) => s.trim()))] };
}

const lines = Object.entries(out)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([amm, p]) => `  ${JSON.stringify(amm)}: ${JSON.stringify(p.substances)}, // ${p.name.replace(/\*\//g, "")}`);
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(
  join(here, "..", "src", "ab", "copper-ephy.ts"),
  `// Fichier généré par scripts/extract-copper.mjs : ne pas modifier à la main.
import type { RefSource } from "../source.js";

export const COPPER_EPHY_SOURCE: RefSource = {
  text: "Catalogue E-Phy (ANSES), données ouvertes data.gouv.fr, produits_utf8.csv",
  version: ${JSON.stringify(date)},
  at: "colonne « Substances actives », composés du cuivre",
};

/** Substances cupriques de chaque produit, par n° d'AMM, telles qu'E-Phy les libelle. */
export const COPPER_EPHY: Record<string, string[]> = {
${lines.join("\n")}
};
`,
);
console.log(`${Object.keys(out).length} produits cupriques`);
