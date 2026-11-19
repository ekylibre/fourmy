#!/usr/bin/env node
/**
 * Jeu de test anonymisé tiré d'un dossier PAC réel (XML TelePAC) : les îlots
 * qui portent les parcelles d'un jeu Geofolia anonymisé (même déplacement des
 * géométries, pour que les deux jeux se superposent), leurs parcelles, et les
 * SNA et ZDH qui les touchent.
 *
 *   node packages/importers/scripts/anonymize-telepac.mjs <dossier.xml> <jeu-geofolia.zip> <sortie.xml>
 *
 * Anonymisation : SIRET et PACAGE fictifs, raison sociale et courriel
 * remplacés, numéros d'îlot de référence, de SNA et de ZDH remplacés,
 * communes neutralisées, demandes d'aides, pièces jointes et effectifs
 * retirés (un effectif fictif est gardé pour tester sa mention), géométries
 * déplacées (200 km vers l'est, 150 km vers le sud, comme le jeu Geofolia).
 * Codes cultures, surfaces et types de SNA sont gardés. Ne jamais publier le
 * dossier d'origine.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { unzip } from "@fourmy/isoxml";

const [xmlPath, geofoliaPath, outPath] = process.argv.slice(2);
if (!xmlPath || !geofoliaPath || !outPath) {
  console.error("usage : anonymize-telepac.mjs <dossier.xml> <jeu-geofolia.zip> <sortie.xml>");
  process.exit(2);
}
const DX = 200_000;
const DY = -150_000;
const xml = readFileSync(xmlPath).toString("latin1");

// Îlots des parcelles du jeu Geofolia (numéro d'îlot gardé par son anonymiseur).
const files = unzip(new Uint8Array(readFileSync(geofoliaPath)));
const field = JSON.parse(new TextDecoder().decode([...files].find(([n]) => n.toLowerCase().endsWith("field.json"))[1]));
const islets = new Set(field.Fields.map((f) => String(f.IsletNum ?? "").trim()).filter(Boolean));

const salt = createHash("sha256").update(String(Math.random())).digest("hex");
const fakeNumber = (v, len) => String(BigInt(`0x${createHash("sha256").update(salt + v).digest("hex").slice(0, 15)}`) % 10n ** BigInt(len)).padStart(len, "0");
const shift = (block) =>
  block.replace(/(<gml:coordinates>)([\s\S]*?)(<\/gml:coordinates>)/g, (_, a, coords, b) =>
    a + coords.trim().split(/\s+/).map((p) => { const [x, y] = p.split(",").map(Number); return `${(x + DX).toFixed(3)},${(y + DY).toFixed(3)}`; }).join(" ") + b);
const blocks = (tag) => [...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);
const bbox = (block) => {
  const pts = [...block.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
};
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

const keptIslets = blocks("ilot").filter((b) => islets.has(/numero-ilot="([^"]+)"/.exec(b)?.[1] ?? ""));
const keptBoxes = keptIslets.map(bbox);
const keptNumbers = new Set(keptIslets.map((b) => /numero-ilot="([^"]+)"/.exec(b)[1]));
const anonIslet = (b) =>
  shift(b)
    .replace(/numero-ilot-reference="(\d+)"/, (_, v) => `numero-ilot-reference="${fakeNumber(v, 12)}"`)
    .replace(/<commune>\d+<\/commune>/, "<commune>00000</commune>");
const sna = blocks("sna-declaree")
  .filter((b) => [...b.matchAll(/<numeroIlot>(\d+)<\/numeroIlot>/g)].some((m) => keptNumbers.has(m[1])))
  .map((b) => shift(b).replace(/<numeroSna>(\d+)<\/numeroSna>/, (_, v) => `<numeroSna>${fakeNumber(v, 12)}</numeroSna>`));
const zdh = blocks("zdh-declaree")
  .filter((b) => keptBoxes.some((k) => overlaps(k, bbox(b))))
  .map((b) => shift(b).replace(/<numeroZdh>(\d+)<\/numeroZdh>/, (_, v) => `<numeroZdh>${fakeNumber(v, 12)}</numeroZdh>`));

const out = `<?xml version="1.0" encoding="ISO-8859-1"?>
<producteurs xmlns="urn:x-telepac:fr.gouv.agriculture.telepac:echange-producteur" xmlns:gml="http://www.opengis.net/gml">
<producteur numero-pacage="040000003" campagne="Courante" fichier-xsd="Echanges-producteur-export-2026-V1">
<demandeur certificat-environnemental="true" dossier-sans-demande-aides="false">
<identification-societe><exploitation>GAEC PILOTE TEST</exploitation></identification-societe>
<siret>40000000000003</siret>
<courriel>pilote@exemple.test</courriel>
</demandeur>
<rpg>
${keptIslets.map(anonIslet).join("\n")}
${sna.join("\n")}
${zdh.join("\n")}
</rpg>
<effectifs-animaux><effectif-animal><effectif-present><type-animal-2>AV</type-animal-2><nb-animaux-2>1000</nb-animaux-2></effectif-present></effectif-animal></effectifs-animaux>
<demandes-aides-pilier1-et-AR autorisation-transmission-assureurs-récolte="true"/>
</producteur>
</producteurs>
`;
writeFileSync(outPath, Buffer.from(out, "latin1"));
console.log(`${keptIslets.length} îlots, ${sna.length} SNA, ${zdh.length} ZDH → ${outPath} (${out.length} caractères)`);
