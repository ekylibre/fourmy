/**
 * Végétation et météo du plan 3D (lot AA, docs/jumeau-3d.md) : FR-TWIN-3 et
 * FR-TWIN-4. Les rangs de chaque parcelle sont dessinés en 3D, leur hauteur et
 * leur couleur suivent l'état observé (NDVI) et les interventions ; le ciel
 * suit la météo observée du jour de la frise.
 */

/** Phase du couvert d'une parcelle à une date. */
export type CanopyPhase = "bare" | "growing" | "senescent" | "harvested" | "dormant" | "unknown";

export interface ParcelRows {
  /** Orientation des rangs (degrés depuis le nord, sens horaire, 0 à 180). */
  bearingDeg: number;
  /** Inter-rang réel (m). */
  spacingM: number;
  /** Orientation et inter-rang déduits (grand axe de la parcelle, culture) et non saisis. */
  auto: boolean;
}

export interface ParcelCanopy {
  phase: CanopyPhase;
  /** Hauteur du couvert (m). */
  heightM: number;
  /** Densité du feuillage (0..1), largeur des rangs. */
  density: number;
  /** NDVI lissé à la date (null sans mesure récente). */
  ndvi: number | null;
  /** Date de la mesure qui fonde l'état. */
  observedOn: string | null;
  /** Fondement de l'état : le NDVI observé, ou le modèle de croissance quand le NDVI manque (lot AB). */
  source: "ndvi" | "model";
}

export interface ParcelVegetation {
  parcelId: string;
  species: string | null;
  nature: string | null;
  rows: ParcelRows;
  canopy: ParcelCanopy;
}

/** Météo observée (ou prévue) du jour au centre de la ferme, résumée pour le rendu. */
export interface DayWeather {
  day: string;
  source: string;
  kind: "observed" | "forecast";
  /** Temps dominant de la journée (code OpenWeather `01d`…`50d`). */
  icon: string | null;
  precipitationMm: number | null;
  /** Pluie des 48 h précédant la fin du jour (sol mouillé). */
  precipitation48hMm: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  windMaxKmh: number | null;
}

export interface Vegetation3dAt {
  at: string;
  parcels: ParcelVegetation[];
  weather: DayWeather | null;
}

export interface ParcelRowsWrite {
  bearingDeg: number;
  spacingM: number;
}
