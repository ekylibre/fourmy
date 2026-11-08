import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/**
 * Réglementation phytosanitaire (lot 2 : PHY-1 à PHY-4, IFT-1). Le calcul
 * des feux est dans @fourmy/domain (`checkTreatment`) ; ici, les formes
 * échangées avec l'API.
 */

export const complianceLevel = z.enum(["ok", "info", "warning", "danger"]);
export type ComplianceLevelName = z.infer<typeof complianceLevel>;

/** Ce que la saisie transmet avec l'intervention : cible choisie par produit, motif d'un passage outre. */
export const complianceWrite = z.object({
  /** Article → usage E-Phy choisi (cible du traitement). */
  usages: z.record(uuid, z.string().max(64)).default({}),
  /** Motif obligatoire pour enregistrer malgré un feu rouge. */
  reason: z.string().trim().max(500).optional(),
});
export type ComplianceWrite = z.infer<typeof complianceWrite>;

export const complianceIndicator = z.object({
  code: z.enum(["authorization", "dose", "applications", "znt", "dar", "reentry"]),
  level: complianceLevel,
  message: z.string(),
});

export const treatmentCheck = z.object({
  articleId: uuid,
  articleName: z.string(),
  level: complianceLevel,
  indicators: z.array(complianceIndicator),
  usages: z.array(z.object({ id: z.string(), label: z.string(), doseLabel: z.string().nullable() })),
  usageId: z.string().nullable(),
  harvestAllowedFrom: isoDateTime.nullable(),
  reentryAllowedFrom: isoDateTime.nullable(),
});
export type TreatmentCheckDto = z.infer<typeof treatmentCheck>;

/** Résultat du contrôle (POST /phyto/check, ou enregistré avec l'intervention). */
export const complianceResult = z.object({
  level: complianceLevel,
  checkedAt: isoDateTime,
  /** Version du référentiel Lexicon utilisée ; null s'il n'est pas chargé. */
  referential: z.string().nullable(),
  checks: z.array(treatmentCheck),
  /** Motif saisi pour passer outre un feu rouge. */
  reason: z.string().nullable(),
});
export type ComplianceResult = z.infer<typeof complianceResult>;

/** IFT d'une intervention (API IFT du ministère). */
export const iftLine = z.object({
  articleId: uuid,
  parcelId: uuid,
  ift: z.number().nullable(),
  segment: z.string().nullable(),
  doseReference: z.number().nullable(),
  warning: z.string().nullable(),
});
export const iftResult = z.object({
  status: z.enum(["ok", "pending", "unavailable"]),
  total: z.number().nullable(),
  lines: z.array(iftLine),
  computedAt: isoDateTime.nullable(),
  error: z.string().nullable(),
  retryAt: isoDateTime.nullable().optional(),
});
export type IftResult = z.infer<typeof iftResult>;

/** Produit du référentiel (recherche pour créer ou rattacher un article). */
export const phytoProduct = z.object({
  id: z.number().int(),
  amm: z.string(),
  name: z.string(),
  otherNames: z.array(z.string()),
  natures: z.array(z.string()),
  state: z.string(),
  stoppedOn: z.string().nullable(),
  reentryDelayHours: z.number().nullable(),
});
export type PhytoProduct = z.infer<typeof phytoProduct>;

/** État du référentiel et des données d'eau de la ferme. */
export const phytoStatus = z.object({
  referential: z.object({ phytosanitary: z.string().nullable(), taxonomy: z.string().nullable(), loadedAt: isoDateTime.nullable() }),
  water: z.object({ syncedAt: isoDateTime.nullable(), items: z.number().int(), lastError: z.string().nullable() }),
  articles: z.object({ phyto: z.number().int(), linked: z.number().int(), withoutAmm: z.number().int(), unknownAmm: z.number().int() }),
});
export type PhytoStatus = z.infer<typeof phytoStatus>;

/** Créer un article depuis le référentiel, ou rattacher un article existant à un n° AMM. */
export const phytoArticleCreate = z.object({
  productId: z.number().int(),
  /** Unité de stock : litre ou kilogramme. */
  unit: z.enum(["liter", "kilogram"]),
  name: z.string().trim().min(1).max(200).optional(),
});
export const phytoArticleLink = z.object({ amm: z.string().trim().min(4).max(20) });

// --- Météo (lot 3 : MET-1 à MET-3) ---------------------------------------------

export const weatherSource = z.enum(["open_meteo", "openweather", "meteoblue", "manual"]);

/** Météo enregistrée avec l'intervention (pré-remplie, modifiable). */
export const interventionWeather = z.object({
  source: weatherSource,
  /** Observée (passé), prévue (à venir), ou saisie. */
  kind: z.enum(["observed", "forecast", "manual"]),
  temperatureC: z.number().min(-50).max(60).nullable(),
  humidityPct: z.number().min(0).max(100).nullable(),
  windKmh: z.number().min(0).max(300).nullable(),
  windMaxKmh: z.number().min(0).max(300).nullable().optional(),
  precipitationMm: z.number().min(0).max(1000).nullable(),
  fetchedAt: isoDateTime.nullable().optional(),
});
export type InterventionWeather = z.infer<typeof interventionWeather>;

/** Créneau de pulvérisation (widget « conditions de pulvérisation »). */
export const sprayingSlot = z.object({
  at: isoDateTime,
  stepHours: z.number(),
  level: z.enum(["go", "caution", "stop"]),
  reasons: z.array(z.string()),
  temperatureC: z.number().nullable(),
  humidityPct: z.number().nullable(),
  windKmh: z.number().nullable(),
  precipitationMm: z.number().nullable(),
});
export const sprayingForecast = z.object({
  source: weatherSource,
  latitude: z.number(),
  longitude: z.number(),
  slots: z.array(sprayingSlot),
});
export type SprayingForecast = z.infer<typeof sprayingForecast>;
