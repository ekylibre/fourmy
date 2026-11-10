import {
  OFFICIAL_REGISTER_FIELDS,
  OFFICIAL_REGISTER_REQUIRED,
  OFFICIAL_REGISTER_SURVEY_FIELDS,
  type OfficialRegisterField,
  type OfficialRegisterLine,
} from "@fourmy/contracts";

/**
 * Mise en forme d'une ligne du registre phyto réglementaire (lot X) :
 * données brutes d'un produit sur une parcelle → intitulés standard de la
 * notice du 22/09/2026, formats imposés (JJ/MM/AAAA, HH:MM en heure locale,
 * 9999.9999), champs obligatoires manquants dans `anomalies`.
 */
export interface RawRegisterLine {
  inputId: string;
  targetId: string;
  interventionId: string;
  landParcelId: string;
  parcelName: string;
  activityId: string | null;
  /** Libellé de la procédure : mode d'application (facultatif). */
  procedureLabel: string;
  startedAt: string | null;
  stoppedAt: string | null;
  productName: string;
  amm: string | null;
  quantity: number | null;
  /** Unité enregistrée : `kilogram_per_hectare`, `liter`… */
  unit: string | null;
  /** Surface traitée de toute l'intervention (pour une quantité totale). */
  interventionAreaM2: number;
  treatedAreaM2: number;
  parcelAreaM2: number;
  lat: number | null;
  lon: number | null;
  cropOepp: string | null;
  bbchLabel: string | null;
  organic: boolean;
  usageTarget: string | null;
  siret: string | null;
  pacage: string | null;
  campaign: number;
}

const BASE_UNIT: Record<string, string> = { kilogram: "kg/ha", liter: "L/ha", gram: "kg/ha", milliliter: "L/ha" };
const TO_BASE: Record<string, number> = { gram: 0.001, milliliter: 0.001 };

/** 9999.9999 : au plus 4 décimales, point décimal, sans zéros inutiles. */
export function registerNumber(n: number, digits = 4): string {
  return String(Number(n.toFixed(digits)));
}

/** Dose par hectare et unité de la notice (kg/ha, L/ha, unité/ha). */
export function registerDose(quantity: number | null, unit: string | null, interventionAreaM2: number): { value: string; unit: string } {
  if (quantity === null || !unit) return { value: "", unit: "" };
  const perHectare = unit.endsWith("_per_hectare");
  const base = perHectare ? unit.slice(0, -"_per_hectare".length) : unit;
  const factor = TO_BASE[base] ?? 1;
  const areaHa = interventionAreaM2 / 10_000;
  if (!perHectare && areaHa <= 0) return { value: "", unit: "" };
  const value = (perHectare ? quantity : quantity / areaHa) * factor;
  return { value: registerNumber(value), unit: BASE_UNIT[base] ?? "unité/ha" };
}

function localParts(iso: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.day}/${parts.month}/${parts.year}`, time: `${parts.hour}:${parts.minute}` };
}

export function officialRegisterLine(raw: RawRegisterLine, timeZone = "Europe/Paris"): OfficialRegisterLine {
  const start = raw.startedAt ? localParts(raw.startedAt, timeZone) : null;
  const stop = raw.stoppedAt ? localParts(raw.stoppedAt, timeZone) : null;
  const dose = registerDose(raw.quantity, raw.unit, raw.interventionAreaM2);
  const amm = raw.amm && /^\d{7}$/.test(raw.amm.trim()) ? raw.amm.trim() : "";
  const fields: Record<OfficialRegisterField, string> = {
    idTraitement: `${raw.inputId}:${raw.targetId}`,
    idIntervention: raw.interventionId,
    siretApplicateur: raw.siret ?? "",
    siretBeneficiaire: "",
    nomProduit: raw.productName,
    numeroAMMProduit: amm,
    dateIntervention: start?.date ?? "",
    heureDebut: start?.time ?? "",
    heureFin: stop?.time ?? "",
    delaiRentree: "",
    doseProduitValeur: dose.value,
    doseProduitUnite: dose.unit,
    volumeDeBouillie: "",
    uniteBouillie: "",
    usageCible: raw.usageTarget ?? "",
    modeApplication: raw.procedureLabel,
    surfaceTraitee: raw.treatedAreaM2 > 0 ? (raw.treatedAreaM2 / 10_000).toFixed(2) : "",
    surfaceUnite: raw.treatedAreaM2 > 0 ? "ha" : "",
    numIlot: "",
    numParcelle: "",
    codeCommuneInsee: "",
    // Sans référence RPG de l'exploitant : point de la parcelle (WGS84), latitude ; longitude.
    coordonneesGps: raw.lat !== null && raw.lon !== null ? `${raw.lat.toFixed(5)} ; ${raw.lon.toFixed(5)}` : "",
    cultureOepp: raw.cropOepp ?? "",
    codeBbch: raw.bbchLabel ?? "",
    modeDeConduite: raw.organic ? "Oui" : "Non",
    commentaire: "",
  };
  const survey = {
    campagne: String(raw.campaign),
    pacage: raw.pacage ?? "",
    surfaceParcelle: raw.parcelAreaM2 > 0 ? (raw.parcelAreaM2 / 10_000).toFixed(2) : "",
    surfaceTotaleUnite: raw.parcelAreaM2 > 0 ? "ha" : "",
    partSurfaceTraitee: raw.parcelAreaM2 > 0 ? String(Math.max(0, Math.min(100, Math.round((raw.treatedAreaM2 / raw.parcelAreaM2) * 100)))) : "",
  };
  const anomalies = OFFICIAL_REGISTER_REQUIRED.filter((f) => !fields[f]);
  // Localisation : RPG ou, à défaut, coordonnées GPS.
  if (!fields.coordonneesGps && !fields.numIlot) anomalies.push("coordonneesGps");
  return { ...fields, ...survey, anomalies, links: { interventionId: raw.interventionId, landParcelId: raw.landParcelId, parcelName: raw.parcelName, activityId: raw.activityId } };
}

/** CSV : séparateur « ; », UTF-8 avec BOM, intitulés standard, une ligne par traitement. */
export function officialRegisterCsv(lines: OfficialRegisterLine[]): string {
  const cell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = [...OFFICIAL_REGISTER_FIELDS];
  const body = lines.map((l) => header.map((f) => cell(l[f])).join(";"));
  return "﻿" + [header.join(";"), ...body].join("\r\n") + "\r\n";
}

/** JSON complet (enquêtes) : champs standard et champs d'enquête, sans les liens internes. */
export function officialRegisterJsonLine(l: OfficialRegisterLine): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of OFFICIAL_REGISTER_FIELDS) out[f] = l[f];
  for (const f of OFFICIAL_REGISTER_SURVEY_FIELDS) out[f] = l[f];
  return out;
}
