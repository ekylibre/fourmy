/**
 * Modèle de croissance des cultures (lot AB, FR-TWIN-8,
 * docs/modele-croissance.md) : stades par degrés-jours depuis le semis saisi
 * et bilan hydrique FAO-56, sur la météo journalière Open-Meteo (observée,
 * prévue à 16 jours, puis normales des 5 années précédentes).
 */

export type CropModelKind = "maize" | "winter_cereal";
/** Origine de la météo d'un jour : observée, prévue, ou normale (moyenne des années précédentes). */
export type WeatherBasis = "observed" | "forecast" | "normals";

export interface CropStageDate {
  code: string;
  label: string;
  /** Degrés-jours depuis le semis qui marquent le stade. */
  gdd: number;
  /** Date d'atteinte simulée (null : au-delà de la météo disponible). */
  on: string | null;
  basis: WeatherBasis | null;
}

/** Réserve utile et irrigation d'une parcelle (saisies, sinon valeurs par défaut). */
export interface ParcelSoil {
  tawMm: number;
  irrigated: boolean;
  /** Valeurs par défaut, non saisies. */
  auto: boolean;
}

export interface ParcelSoilWrite {
  tawMm: number;
  irrigated: boolean;
}

export interface CropWaterState {
  /** Eau disponible, en part de la réserve accessible aux racines (0..1). */
  reserve: number;
  /** Réserve accessible ce jour (mm) : elle croît avec l'enracinement. */
  tawMm: number;
  /** Coefficient de stress FAO-56 (1 : pas de stress). */
  ks: number;
  /** Sous cette part de réserve, la culture est en stress (1 − p de FAO-56). */
  stressBelow: number;
  /** Jours de stress de la levée au jour, et dans la fenêtre sensible de la floraison. */
  stressDays: number;
  floweringStressDays: number;
  /** Irrigation simulée depuis le semis (parcelle irriguée), mm. */
  irrigationMm: number;
}

export interface ParcelCropState {
  parcelId: string;
  parcelName: string;
  species: string | null;
  model: CropModelKind;
  modelLabel: string;
  sownOn: string;
  /** Récolte ou destruction saisie (fin de la simulation). */
  endedOn: string | null;
  /** Stade atteint au jour (null : semé, pas encore levé ; ou pas encore semé). */
  stage: { code: string; label: string } | null;
  next: CropStageDate | null;
  /** Degrés-jours cumulés au jour. */
  gdd: number | null;
  stages: CropStageDate[];
  soil: ParcelSoil;
  /** Bilan hydrique au jour (null : récoltée, ou météo indisponible). */
  water: CropWaterState | null;
  /** Dernier jour de météo connue (observée ou prévue) ; au-delà, normales. */
  weatherUntil: string | null;
}

export type CropAlertKind = "flowering_soon" | "harvestable_soon" | "water_stress" | "irrigation_due";

export interface CropAlert {
  parcelId: string;
  parcelName: string;
  kind: CropAlertKind;
  /** Date de l'événement prévu (stade, irrigation), si elle a un sens. */
  on: string | null;
  /** Précision courte, affichée sous le titre de la sorte (« vers le 27/06 », « réserve à 14 % »). */
  text: string;
}

export interface CropModelAt {
  at: string;
  items: ParcelCropState[];
  alerts: CropAlert[];
  /** Météo indisponible (Open-Meteo injoignable et rien en cache). */
  weatherMissing: boolean;
}

export interface CropModelDay {
  date: string;
  basis: WeatherBasis;
  gdd: number;
  reserve: number;
  ks: number;
  rainMm: number;
  etcMm: number;
  irrigationMm: number;
}

export interface ParcelCropSeries {
  at: string;
  /** null : pas de culture modélisée (pas de semis saisi, ou espèce sans modèle). */
  state: ParcelCropState | null;
  days: CropModelDay[];
  /** Raison de l'absence de modèle, pour l'écran. */
  reason: "no_sowing" | "no_model" | "weather_missing" | null;
}

/** Bornes de saisie de la réserve utile (mm). */
export const TAW_RANGE = { min: 10, max: 400 } as const;
export const DEFAULT_TAW_MM = 100;
