#!/usr/bin/env node
/**
 * Génère src/icons/agric.ts : les dessins des icônes Agric utilisées par
 * Fourmy (packages/contracts/src/procedure-icons.ts), et seulement elles.
 *
 *   git clone https://github.com/ekylibre/agric /chemin/agric
 *   pnpm --filter @fourmy/contracts build
 *   node apps/web/scripts/agric-icons.mjs /chemin/agric
 *
 * Même normalisation que le build d'Agric (scripts/build.mjs) : boîte
 * `0 0 <largeur> 1000`, couleur héritée (currentColor côté composant).
 * Agric est sous licence MIT ; ses icônes importées gardent leur licence
 * (manifest.json) : le script refuse celles qui ne sont pas MIT, ISC, CC0,
 * Apache-2.0 ou OFL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGRIC_ICON_NAMES } from "@fourmy/contracts";

const repo = process.argv[2];
if (!repo) {
  console.error("Usage : node apps/web/scripts/agric-icons.mjs <dépôt agric>");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(repo, "manifest.json"), "utf8"));
const commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const OK_LICENSES = new Set(["MIT", "ISC", "CC0-1.0", "Apache-2.0", "OFL-1.1"]);

const glyphs = {};
for (const name of AGRIC_ICON_NAMES) {
  const meta = manifest.icons[name];
  if (!meta) throw new Error(`Icône inconnue d'Agric : ${name}`);
  const license = meta.source === "legacy" || meta.source === "ekylibre" ? "MIT" : meta.license;
  if (!OK_LICENSES.has(license)) throw new Error(`${name} : licence ${license} non acceptée`);
  const svg = readFileSync(path.join(repo, "glyphs", `${name}.svg`), "utf8");
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const width = viewBox ? Number(viewBox[1]) : Number(svg.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1]);
  const height = viewBox ? Number(viewBox[2]) : Number(svg.match(/<svg[^>]*\sheight="([\d.]+)"/)?.[1]);
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!width || !height || paths.length === 0) throw new Error(`${name} : dessin illisible`);
  glyphs[name] = { w: width, h: height, d: paths.join(" ") };
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/icons/agric.ts");
writeFileSync(
  out,
  `/* Fichier généré par apps/web/scripts/agric-icons.mjs — ne pas modifier à la main.
 * Icônes Agric (https://github.com/ekylibre/agric, commit ${commit}),
 * licence MIT, Copyright (c) 2013 Brice Texier. */

export interface AgricGlyph {
  /** Largeur et hauteur de la boîte du dessin. */
  w: number;
  h: number;
  d: string;
}

export const AGRIC_GLYPHS: Record<string, AgricGlyph> = ${JSON.stringify(glyphs, null, 2)};
`,
);
console.log(`${Object.keys(glyphs).length} icônes écrites dans ${path.relative(process.cwd(), out)}`);
