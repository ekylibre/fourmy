#!/usr/bin/env node
/**
 * Jeu de test anonymisé tiré d'un export Geofolia réel (« Parcelles et
 * Interventions complet ») : quelques parcelles principales, leurs cultures
 * secondaires, leurs actions et les produits employés.
 *
 *   node packages/importers/scripts/anonymize-geofolia.mjs <export.zip> <sortie.zip> [nombre de parcelles principales] [mots à masquer]
 *
 * « mots à masquer » : mots, séparés par des virgules, qui ne doivent rester
 * dans aucun nom de produit (nom de la ferme, de l'exploitant). Ils ne sont
 * jamais écrits dans le dépôt : on les passe à la main.
 *
 * Anonymisation : SIRET fictif ; noms de parcelles, de personnes et
 * d'utilisateurs remplacés ; commentaires et motifs retirés ; tous les GUID
 * remplacés (même remplacement pour un même GUID : les liens entre fichiers
 * et le GUID commun avec DAPLOS restent cohérents) ; géométries déplacées
 * (200 km vers l'est, 150 km vers le sud) ; commune neutralisée ; nom d'un
 * produit qui citerait la ferme remplacé. Les codes de travail, cultures,
 * produits du commerce, doses, dates et statuts sont gardés : ce sont eux
 * que les tests vérifient. Ne jamais publier l'export d'origine.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { unzip, zip } from "@fourmy/isoxml";
import { readFileSync } from "node:fs";

const [zipPath, outPath, countArg, maskArg] = process.argv.slice(2);
if (!zipPath || !outPath) {
  console.error("usage : anonymize-geofolia.mjs <export.zip> <sortie.zip> [nombre de parcelles principales]");
  process.exit(2);
}
const MAIN_PLOTS = Number(countArg ?? 6);
const SIRET = "40000000000003";
const DX = 200_000;
const DY = -150_000;

const files = unzip(new Uint8Array(readFileSync(zipPath)));
const read = (name) => {
  const entry = [...files.keys()].find((k) => k.toLowerCase().endsWith(name.toLowerCase()));
  return JSON.parse(new TextDecoder().decode(files.get(entry)));
};
const fieldDoc = read("Field.Json");
const actionDoc = read("Action.Json");

const salt = createHash("sha256").update(String(Math.random())).digest("hex");
const guidMap = new Map();
/** GUID remplacé, avec la même casse et les mêmes tirets que l'original. */
function guid(value) {
  if (!value || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) return value;
  const bare = value.replace(/-/g, "").toLowerCase();
  if (!guidMap.has(bare)) guidMap.set(bare, createHash("sha256").update(salt + bare).digest("hex").slice(0, 32));
  const h = guidMap.get(bare);
  const out = value.includes("-") ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : h;
  return value === value.toUpperCase() ? out.toUpperCase() : out;
}
const shiftWkt = (wkt) =>
  wkt && wkt.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${(Number(x) + DX).toFixed(3)} ${(Number(y) + DY).toFixed(3)}`);

// Parcelles principales choisies : les plus travaillées (variété des opérations).
const actions = actionDoc.Activities;
const plotUse = new Map();
for (const a of actions) for (const cz of a.CropZoneIds ?? []) plotUse.set(cz.PlotId, (plotUse.get(cz.PlotId) ?? 0) + 1);
const mains = fieldDoc.Fields.filter((f) => f.PlotKind === 1).sort((a, b) => (plotUse.get(b.Id) ?? 0) - (plotUse.get(a.Id) ?? 0)).slice(0, MAIN_PLOTS);
const mainIds = new Set(mains.map((f) => f.Id));
const fields = fieldDoc.Fields.filter((f) => mainIds.has(f.Id) || mainIds.has(f.MainPlotId));
const plotIds = new Set(fields.map((f) => f.Id));

let n = 0;
const anonField = (f) => ({
  ...f,
  FarmIdentificationCode: SIRET,
  Id: guid(f.Id),
  MainPlotId: guid(f.MainPlotId),
  ParentId1: guid(f.ParentId1),
  SoilAnalysisId: guid(f.SoilAnalysisId),
  NMinus1PlotId: guid(f.NMinus1PlotId),
  NMinus2PlotId: guid(f.NMinus2PlotId),
  NMinus3PlotId: guid(f.NMinus3PlotId),
  NMinus4PlotId: guid(f.NMinus4PlotId),
  NMinus5PlotId: guid(f.NMinus5PlotId),
  Name: `Parcelle ${++n}`,
  Geography: shiftWkt(f.Geography),
  CityNumber: "00000",
  City: "Commune",
  Comment: null,
  FertiDiaryComment: "",
  PhytoDiaryComment: "",
  TraceabilityCode: "",
  ExternalId: "",
  WaterPointName: null,
});

const kept = actions
  .map((a) => ({ ...a, CropZoneIds: (a.CropZoneIds ?? []).filter((cz) => plotIds.has(cz.PlotId)) }))
  .filter((a) => a.CropZoneIds.length);
const zones = new Set(kept.flatMap((a) => a.CropZoneIds.map((cz) => cz.RecognitionId)));
const usedSupplies = new Set();
const usedHarvests = new Set();
// Nom d'un produit qui citerait la ferme (« Fumier Poulet label <ferme> ») : remplacé partout.
const masked = (maskArg ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
const productName = (name) => (masked.some((w) => (name ?? "").toLowerCase().includes(w)) ? "Produit de la ferme" : name);
const anonAction = (a) => {
  const products = (a.ProductIds ?? []).filter((p) => zones.has(p.RecognitionId));
  const harvests = (a.ActionHarvests ?? []).filter((h) => zones.has(h.RecognitionId));
  products.forEach((p) => usedSupplies.add(p.SupplyId));
  harvests.forEach((h) => usedHarvests.add(h.HarvestId));
  return {
    ...a,
    FarmIdentificationCode: SIRET,
    ActionId: guid(a.ActionId),
    LastModificationUser: "UTILISATEUR",
    Comment: null,
    Motivation: null,
    MotivationDetail: null,
    CropZoneIds: a.CropZoneIds.map((cz) => ({ ...cz, ActionId: guid(cz.ActionId), PlotId: guid(cz.PlotId), RecognitionId: guid(cz.RecognitionId), FarmIdentificationCode: SIRET, SPEKindId: guid(cz.SPEKindId) })),
    ProductIds: products.length
      ? products.map((p) => ({ ...p, SupplyName: productName(p.SupplyName), ActionId: guid(p.ActionId), SupplyId: guid(p.SupplyId), RecognitionId: guid(p.RecognitionId), FarmIdentificationCode: SIRET }))
      : null,
    ActionHarvests: harvests.length
      ? harvests.map((h) => ({ ...h, ActionId: guid(h.ActionId), HarvestId: guid(h.HarvestId), RecognitionId: guid(h.RecognitionId), ActionHarvestBatches: null }))
      : null,
    ActionEmployees: a.ActionEmployees?.map((e, i) => ({ ...e, EmployeeActionId: guid(e.EmployeeActionId), EmployeeRecognitionId: guid(e.EmployeeRecognitionId), EmployeeId: guid(e.EmployeeId), EmployeeFarmIdentificationCode: SIRET, EmployeeName: `Salarié ${i + 1}`, EmployeeFirstName: "Prénom" })) ?? null,
  };
};
const outActions = kept.map(anonAction);
const products = actionDoc.Products.filter((p) => usedSupplies.has(p.SupplyId)).map((p) => ({
  ...p,
  FarmIdentificationCode: SIRET,
  SupplyId: guid(p.SupplyId),
  RecognitionId: guid(p.RecognitionId),
  SupplyName: productName(p.SupplyName),
}));
const harvested = actionDoc.HarvestedProducts.filter((h) => usedHarvests.has(h.HarvestId)).map((h) => ({ ...h, HarvestId: guid(h.HarvestId) }));
const employees = (actionDoc.Employees ?? []).map((e, i) => ({ ...e, EmployeeId: guid(e.EmployeeId), FarmIdentificationCode: SIRET, Name: `Salarié ${i + 1}`, FirstName: "Prénom", NationalIdentificationCode: null }));

// Même forme que l'export : JSON en UTF-8 avec marque d'ordre des octets, dans un zip.
const bom = (o) => "\uFEFF" + JSON.stringify(o);
const archive = zip(
  {
    "Field.Json": bom({ ...fieldDoc, Fields: fields.map(anonField) }),
    "Action.Json": bom({ ...actionDoc, Products: products, Employees: employees, Partners: [], HarvestedProducts: harvested, Equipments: [], Activities: outActions }),
    "IdentificationCodes.json": bom([SIRET]),
  },
  new Date("2026-11-18T09:14:55Z"),
);
writeFileSync(outPath, archive);
console.log(`${fields.length} cultures (${mains.length} parcelles principales), ${outActions.length} actions, ${products.length} produits → ${outPath} (${archive.length} octets)`);
