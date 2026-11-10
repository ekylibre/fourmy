/**
 * Télédétection par parcelle (docs/teledetection-design.md) : indices de
 * végétation Sentinel-2 calculés par Copernicus (CDSE), stockés par version de
 * parcelle et par date d'acquisition. Les valeurs ne sont jamais inventées :
 * chaque point porte sa date et sa part de pixels valides.
 */

export const VEGETATION_INDICES = ["ndvi", "ndre", "ndmi"] as const;
export type VegetationIndex = (typeof VEGETATION_INDICES)[number];

export const SATELLITE_IMAGE_KINDS = ["ndvi", "rgb"] as const;
export type SatelliteImageKind = (typeof SATELLITE_IMAGE_KINDS)[number];

/**
 * Palette du NDVI (rouge → vert, domaine fixe 0 à 0,9) : la même pour l'image
 * rendue par Copernicus, la légende, la coloration des parcelles et la courbe.
 */
export const NDVI_PALETTE: { value: number; color: string }[] = [
  { value: 0, color: "#a50026" },
  { value: 0.1, color: "#d73027" },
  { value: 0.2, color: "#f46d43" },
  { value: 0.3, color: "#fdae61" },
  { value: 0.4, color: "#fee08b" },
  { value: 0.5, color: "#d9ef8b" },
  { value: 0.6, color: "#a6d96a" },
  { value: 0.7, color: "#66bd63" },
  { value: 0.8, color: "#1a9850" },
  { value: 0.9, color: "#006837" },
];

/** Couleur d'une valeur de NDVI (interpolée entre les paliers de la palette). */
export function ndviColor(value: number): string {
  const p = NDVI_PALETTE;
  if (!(value > p[0]!.value)) return p[0]!.color;
  for (let i = 1; i < p.length; i++) {
    const hi = p[i]!;
    if (value <= hi.value) {
      const lo = p[i - 1]!;
      const t = (value - lo.value) / (hi.value - lo.value);
      const mix = (a: string, b: string, k: number) =>
        Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - t) + parseInt(b.slice(k, k + 2), 16) * t)
          .toString(16)
          .padStart(2, "0");
      return `#${mix(lo.color, hi.color, 1)}${mix(lo.color, hi.color, 3)}${mix(lo.color, hi.color, 5)}`;
    }
  }
  return p[p.length - 1]!.color;
}

/** Une date est exploitable pour une parcelle si au moins 80 % de ses pixels sont valides. */
export const USABLE_VALID_RATIO = 0.8;
/** En dessous de 30 pixels de 10 m (après retrait de 10 m en bordure), Sentinel-2 ne mesure pas la parcelle. */
export const MIN_PARCEL_PIXELS = 30;
/** Au-delà, la dernière valeur est signalée comme ancienne. */
export const STALE_AFTER_DAYS = 20;

/** Mention exigée par la licence des données Sentinel. */
export const copernicusAttribution = (years: number[]) => {
  const ys = [...new Set(years)].sort();
  const label = ys.length === 0 ? String(new Date().getFullYear()) : ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`;
  return `Contient des données Copernicus Sentinel modifiées ${label}`;
};

export interface RemoteSensingStatus {
  enabled: boolean;
  lastSceneOn: string | null;
  usage: { month: string; requests: number; pu: number; budget: number };
}

export interface SatelliteScene {
  date: string;
  /** Part des pixels des parcelles sans nuage (0..1). */
  validRatio: number;
  images: SatelliteImageKind[];
}

export interface SatelliteImageRef {
  date: string;
  kind: SatelliteImageKind;
  /** Emprise de l'image en WGS84 : ouest, sud, est, nord. */
  bbox: [number, number, number, number];
  url: string;
}

export type ParcelIndexStatus = "ok" | "stale" | "none" | "too_small";

export interface ParcelIndexAt {
  parcelId: string;
  versionId: string;
  status: ParcelIndexStatus;
  date: string | null;
  ageDays: number | null;
  mean: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  validRatio: number | null;
  parcelPixels: number;
}

export interface ParcelIndicesAt {
  at: string;
  index: VegetationIndex;
  items: ParcelIndexAt[];
  /** Dernière image exploitable à la date (ou avant), par sorte. */
  images: SatelliteImageRef[];
  attribution: string;
}

export interface ParcelIndexPoint {
  date: string;
  mean: number | null;
  p10: number | null;
  p90: number | null;
  validRatio: number;
  usable: boolean;
}

export interface ParcelIndexSeries {
  parcelId: string;
  index: VegetationIndex;
  from: string;
  to: string;
  /** Pixels de la version courante (après retrait de 10 m). */
  parcelPixels: number;
  tooSmall: boolean;
  points: ParcelIndexPoint[];
  /** Courbe lissée (Whittaker), un point par jour couvert. */
  smoothed: { date: string; value: number }[];
  /**
   * Référence des années précédentes : pour chaque date de la fenêtre, médiane
   * des courbes lissées des mêmes dates 1, 2, 3… ans plus tôt (alignement sur
   * la fenêtre, pas sur l'année civile : une culture d'hiver reste continue).
   */
  reference: { date: string; median: number; years: number }[];
  referenceYears: number[];
  interventions: { id: string; procedure: string; at: string }[];
  attribution: string;
}
