#!/usr/bin/env node
/**
 * Jeu de test anonymisé tiré d'un export DAPLOS réel, calé sur le jeu
 * Geofolia anonymisé (scripts/anonymize-geofolia.mjs) : mêmes cultures
 * (numéros de travail), mêmes GUID de couple intervention × parcelle, mêmes
 * noms de parcelles et de produits, même déplacement des géométries. Les deux
 * jeux décrivent donc la même ferme, ce qui permet de tester leur
 * dédoublonnage.
 *
 *   node packages/importers/scripts/anonymize-daplos.mjs <export.dap> <export-geofolia.zip> <jeu-geofolia.zip> <sortie.dap>
 *
 * `export-geofolia.zip` est l'export réel dont le jeu Geofolia a été tiré :
 * la même sélection de parcelles y est refaite pour retrouver, dans l'ordre,
 * le GUID anonymisé de chaque couple. Le nombre de parcelles principales doit
 * être celui du jeu Geofolia (6 par défaut).
 *
 * Anonymisation : SIRET et PACAGE fictifs, nom, adresse et destinataire
 * remplacés, commune neutralisée, commentaires et motifs retirés, nom d'un
 * produit absent du jeu Geofolia remplacé (« Produit de la ferme »),
 * géométries déplacées (200 km vers l'est, 150 km vers le sud : coordonnées
 * Lambert 93 du fichier).
 * Codes, doses, dates et statuts sont gardés. Ne jamais publier l'export
 * d'origine.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LINE_DEFS } from "@osfarm/agroedei-edifact-daplos-reader";
import { unzip } from "@fourmy/isoxml";

const [dapPath, realZipPath, fixtureZipPath, outPath, countArg] = process.argv.slice(2);
if (!dapPath || !realZipPath || !fixtureZipPath || !outPath) {
  console.error("usage : anonymize-daplos.mjs <export.dap> <export-geofolia.zip> <jeu-geofolia.zip> <sortie.dap> [nombre de parcelles principales]");
  process.exit(2);
}
const MAIN_PLOTS = Number(countArg ?? 6);
const SIRET = "40000000000003";
const RECEIVER = "40000000000011";
const DX = 200_000;
const DY = -150_000;

const readJson = (zipPath, name) => {
  const files = unzip(new Uint8Array(readFileSync(zipPath)));
  const entry = [...files.keys()].find((k) => k.toLowerCase().endsWith(name.toLowerCase()));
  return JSON.parse(new TextDecoder().decode(files.get(entry)));
};
const bare = (g) => g.replace(/[{}-]/g, "").toUpperCase();

// --- Couples du jeu Geofolia, dans l'ordre, retrouvés dans l'export réel ------------
const realFields = readJson(realZipPath, "Field.Json").Fields;
const realActions = readJson(realZipPath, "Action.Json").Activities;
const plotUse = new Map();
for (const a of realActions) for (const cz of a.CropZoneIds ?? []) plotUse.set(cz.PlotId, (plotUse.get(cz.PlotId) ?? 0) + 1);
const mains = realFields.filter((f) => f.PlotKind === 1).sort((a, b) => (plotUse.get(b.Id) ?? 0) - (plotUse.get(a.Id) ?? 0)).slice(0, MAIN_PLOTS);
const mainIds = new Set(mains.map((f) => f.Id));
const plotIds = new Set(realFields.filter((f) => mainIds.has(f.Id) || mainIds.has(f.MainPlotId)).map((f) => f.Id));
const realZones = realActions.flatMap((a) => (a.CropZoneIds ?? []).filter((cz) => plotIds.has(cz.PlotId)));

const fixtureFields = readJson(fixtureZipPath, "Field.Json").Fields;
const fixtureActions = readJson(fixtureZipPath, "Action.Json");
const fixtureZones = fixtureActions.Activities.flatMap((a) => a.CropZoneIds ?? []);
if (realZones.length !== fixtureZones.length || realZones.some((z, i) => z.PlotCode !== fixtureZones[i].PlotCode)) {
  console.error(`Le jeu Geofolia ne correspond pas à cet export (${realZones.length} couples contre ${fixtureZones.length}).`);
  process.exit(1);
}
const guidMap = new Map(realZones.map((z, i) => [bare(z.RecognitionId), bare(fixtureZones[i].RecognitionId)]));
const keptCodes = new Set(fixtureFields.map((f) => String(f.Code).trim()));
const nameOf = new Map(fixtureFields.map((f) => [String(f.Code).trim(), f.Name]));
const productNames = new Set(fixtureActions.Products.map((p) => p.SupplyName.trim().toLowerCase()));

// --- Réécriture des lignes à largeur fixe -------------------------------------------
const layout = (key) => {
  let at = 2;
  return Object.fromEntries(LINE_DEFS[key].cells.map((c) => [c.name, { at: (at += c.len) - c.len, len: c.len }]));
};
const layouts = Object.fromEntries(Object.keys(LINE_DEFS).map((k) => [k, layout(k)]));
const get = (line, key, name) => {
  const c = layouts[key][name];
  return c ? line.slice(c.at, c.at + c.len) : "";
};
/** Champ remplacé, cadré comme l'original (à droite s'il commençait par des espaces). */
function set(line, key, name, value) {
  const c = layouts[key][name];
  if (!c || line.length < c.at) return line;
  const old = line.slice(c.at, c.at + c.len);
  const v = String(value).slice(0, c.len);
  const cell = /^\s+\S/.test(old) ? v.padStart(c.len) : v.padEnd(c.len);
  return line.slice(0, c.at) + cell + line.slice(c.at + c.len);
}
const blank = (line, key, name) => set(line, key, name, "");
/** Nombre réécrit avec autant de décimales que l'original. */
const sameFormat = (old, value) => {
  const t = old.trim();
  const v = value.toFixed((t.split(".")[1] ?? "").length);
  // Zéros de tête gardés (« 0356789.123 »).
  return /^0\d/.test(t) ? v.padStart(t.length, "0") : v;
};

const raw = Buffer.from(readFileSync(dapPath)).toString("latin1").split("\r\n");
const out = [];
let crops = 0;
for (let line of raw) {
  const key = line.slice(0, 2);
  const lay = layouts[key];
  if (lay?.land_parcel_work_number) {
    const code = get(line, key, "land_parcel_work_number").trim().replace(/^0+(?=\d)/, "");
    if (!keptCodes.has(code)) continue;
  }
  if (lay?.intervention_guid) {
    const g = get(line, key, "intervention_guid").trim();
    const mapped = guidMap.get(bare(g));
    if (!mapped) {
      console.error(`GUID ${g.slice(0, 4)}… absent du jeu Geofolia.`);
      process.exit(1);
    }
    line = set(line, key, "intervention_guid", mapped);
  }
  switch (key) {
    case "EI":
      line = set(set(line, key, "sender_siret", SIRET), key, "receiver_siret", RECEIVER);
      break;
    case "DE":
      line = set(line, key, "reference", "PILOTE");
      break;
    case "DA": {
      const farm = ["TF", "FR"].includes(get(line, key, "entity_nature").trim());
      line = set(line, key, "siret", farm ? SIRET : RECEIVER);
      line = set(line, key, "entity_name", farm ? "GAEC PILOTE TEST" : "DESTINATAIRE TEST");
      line = blank(line, key, "entity_name_complement");
      line = set(line, key, "entity_address", farm ? "LE BOURG" : "1 RUE DE L'ESSAI");
      line = blank(line, key, "entity_address_complement");
      line = set(line, key, "entity_town", "Commune test");
      line = set(line, key, "entity_postal_code", "00000");
      line = blank(line, key, "entity_informations_1");
      line = set(line, key, "entity_informations_2", get(line, key, "entity_nature").trim() === "TF" ? "040000003" : "");
      line = blank(line, key, "entity_informations_3");
      break;
    }
    case "DP": {
      crops++;
      const code = get(line, key, "land_parcel_work_number").trim().replace(/^0+(?=\d)/, "");
      line = set(line, key, "crop_name_details", nameOf.get(code) ?? `Parcelle ${code}`);
      line = set(line, key, "town_insee_code", "00000");
      line = blank(line, key, "other_soil_nature");
      break;
    }
    case "SC":
    case "CC":
    case "VC": {
      // Coordonnées en Lambert 93 dans le fichier (code de système « 5 ») : déplacées telles quelles.
      const x = Number(get(line, key, "longitude"));
      const y = Number(get(line, key, "latitude"));
      if (Number.isFinite(x) && Number.isFinite(y) && x && y) {
        line = set(line, key, "longitude", sameFormat(get(line, key, "longitude"), x + DX));
        line = set(line, key, "latitude", sameFormat(get(line, key, "latitude"), y + DY));
      }
      break;
    }
    case "PV":
      for (const f of ["crop_state_precision", "intervention_nature_precision", "intervention_motivation_details", "worker_licence_number", "worker_name", "first_comment", "second_comment"]) {
        line = blank(line, key, f);
      }
      break;
    case "VI": {
      const name = get(line, key, "input_name").trim();
      if (name && !productNames.has(name.toLowerCase())) line = set(line, key, "input_name", "Produit de la ferme");
      for (const f of Object.keys(layouts.VI).filter((n) => n.startsWith("residue_supplier_"))) line = blank(line, key, f);
      break;
    }
  }
  out.push(line);
}
// Nombre de cultures de l'en-tête.
const de = out.findIndex((l) => l.startsWith("DE"));
if (de >= 0) out[de] = set(out[de], "DE", "crop_count", String(crops).padStart(4, "0"));
writeFileSync(outPath, Buffer.from(out.join("\r\n"), "latin1"));
console.log(`${crops} cultures, ${out.filter((l) => l.startsWith("PV")).length} interventions → ${outPath}`);
