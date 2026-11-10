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
  code: z.enum(["authorization", "organic", "dose", "applications", "znt", "dar", "reentry", "applicator"]),
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
  /** Largeur de ZNT eau retenue (m) ; absente des contrôles enregistrés avant le 08/11/2026. */
  zntM: z.number().nullable().optional(),
  /** Conditions d'emploi de l'usage retenu (E-Phy). */
  usageConditions: z.string().nullable().optional(),
});
export type TreatmentCheckDto = z.infer<typeof treatmentCheck>;

/** Résultat du contrôle (POST /phyto/check, ou enregistré avec l'intervention). */
export const complianceResult = z.object({
  level: complianceLevel,
  checkedAt: isoDateTime,
  /** Version du référentiel Lexicon utilisée ; null s'il n'est pas chargé. */
  referential: z.string().nullable(),
  checks: z.array(treatmentCheck),
  /** Mélange des produits (arrêté du 7 avril 2010 modifié) ; absent avant le 08/11/2026. */
  mixture: z
    .object({ level: z.enum(["ok", "danger"]), issues: z.array(z.object({ articleIds: z.array(uuid), message: z.string() })) })
    .nullable()
    .optional(),
  /** Motif saisi pour passer outre un feu rouge. */
  reason: z.string().nullable(),
});
export type ComplianceResult = z.infer<typeof complianceResult>;

/** Article phyto de la ferme et son produit E-Phy (GET /phyto/articles). */
export interface FarmPhytoArticle {
  id: string;
  name: string;
  unit: string;
  amm: string | null;
  product: { name: string; state: string; stoppedOn: string | null } | null;
  /** Pictogrammes de danger (SGH01…SGH09), d'après les mentions H. */
  hazards: string[];
  /** Mentions de danger (H…, EUH…). */
  risks: { code: string; phrase: string }[];
  /** Délai de ré-entrée dans la parcelle (h). */
  reentryDelayHours: number | null;
  /** Précautions d'emploi (E-Phy) : protection de l'opérateur, mentions restrictives. */
  operatorProtection: string | null;
  restrictedMentions: string | null;
  /** Catégories de mélange (arrêté de 2015) ; utilisable en agriculture biologique ; biocontrôle. */
  mixCodes: number[];
  organic: boolean;
  biocontrol: boolean;
}

/** Eau autour d'une intervention (carte de la fiche) : bande de ZNT (GeoJSON) et cours d'eau proches. */
export interface InterventionWaterMap {
  zntM: number | null;
  buffer: unknown;
  water: { type: "FeatureCollection"; features: unknown[] };
}

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

export const weatherSource = z.enum(["open_meteo", "openweather", "meteoblue", "weenat", "sencrop", "manual"]);

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
  /** Station de mesure (sources weenat, sencrop) et sa distance aux parcelles. */
  station: z.object({ name: z.string(), distanceM: z.number() }).nullable().optional(),
  /** Temps dominant (code d'icône OpenWeather `01d`…`50n`), quel que soit le fournisseur. */
  icon: z.string().regex(/^\d\d[dn]$/).nullable().optional(),
  /** Heures de la période (frise de la fiche), 48 au plus. */
  hours: z
    .array(
      z.object({
        at: isoDateTime,
        icon: z.string().regex(/^\d\d[dn]$/).nullable(),
        temperatureC: z.number().nullable(),
        precipitationMm: z.number().nullable(),
        windKmh: z.number().nullable(),
      }),
    )
    .max(48)
    .optional(),
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
  icon: z.string().nullable().optional(),
});
export const sprayingForecast = z.object({
  source: weatherSource,
  /** Prévision (à venir) ou conditions observées (fenêtre passée). */
  kind: z.enum(["forecast", "observed"]).default("forecast"),
  latitude: z.number(),
  longitude: z.number(),
  slots: z.array(sprayingSlot),
});
export type SprayingForecast = z.infer<typeof sprayingForecast>;
