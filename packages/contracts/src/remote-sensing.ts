import { PROCEDURES } from "./procedures.js";

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

/** Couleur interpolée entre les paliers d'une palette (valeurs croissantes). */
export function paletteColor(palette: { value: number; color: string }[], value: number): string {
  const p = palette;
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

/** Couleur d'une valeur de NDVI (interpolée entre les paliers de la palette). */
export const ndviColor = (value: number) => paletteColor(NDVI_PALETTE, value);

/** Échelle d'affichage d'un indice : libellé, aide d'une ligne, domaine fixe et palette. */
export interface IndexScale {
  label: string;
  /** Ce que l'indice mesure, en une ligne pour l'agriculteur. */
  help: string;
  domain: [number, number];
  palette: { value: number; color: string }[];
  /** Repères de la légende : bas, milieu, haut. */
  legend: [string, string, string];
}

/**
 * Échelles des trois indices. Domaines fixés d'après les valeurs mesurées sur
 * la ferme de Pierre (2025-2026, p2 à p98) : NDVI 0,14 à 0,87, NDRE 0,09 à
 * 0,71, NDMI −0,31 à 0,44. Le NDRE reprend la palette du NDVI étirée sur son
 * domaine ; le NDMI, qui parle d'eau, a une palette brun → bleu.
 */
export const INDEX_SCALES: Record<VegetationIndex, IndexScale> = {
  ndvi: {
    label: "NDVI",
    help: "Couvert vert : quantité de feuillage. Sature quand le couvert est dense.",
    domain: [0, 0.9],
    palette: NDVI_PALETTE,
    legend: ["0 · sol nu", "0,5", "0,9 · couvert dense"],
  },
  ndre: {
    label: "NDRE",
    help: "Chlorophylle (bande « red edge ») : reste sensible quand le NDVI sature ; suit l'état azoté d'un couvert dense.",
    domain: [0, 0.8],
    palette: NDVI_PALETTE.map((p) => ({ value: (p.value / 0.9) * 0.8, color: p.color })),
    legend: ["0 · sol nu", "0,4", "0,8 · très chlorophyllien"],
  },
  ndmi: {
    label: "NDMI",
    help: "Eau dans les feuilles : baisse quand la culture manque d'eau ou sèche ; négatif sur sol nu ou couvert sec.",
    domain: [-0.4, 0.6],
    palette: [
      { value: -0.4, color: "#8c510a" },
      { value: -0.2, color: "#bf812d" },
      { value: -0.05, color: "#dfc27d" },
      { value: 0.05, color: "#f6e8c3" },
      { value: 0.15, color: "#c7eae5" },
      { value: 0.3, color: "#80cdc1" },
      { value: 0.45, color: "#35978f" },
      { value: 0.6, color: "#01665e" },
    ],
    legend: ["−0,4 · sec", "0", "0,6 · feuillage gorgé d'eau"],
  },
};

/** Couleur d'une valeur d'un indice sur son échelle. */
export const indexColor = (index: VegetationIndex, value: number) => paletteColor(INDEX_SCALES[index].palette, value);

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

// --- Interventions probablement manquantes (lot Z) ---------------------------


/**
 * Procédures qui retirent le couvert (récoltes hors vigne, broyages, fauche,
 * labours) : l'une d'elles saisie autour d'une chute du NDVI l'explique.
 */
export const COVER_REMOVING_PROCEDURES: readonly string[] = [
  ...PROCEDURES.filter((p) => p.shape === "harvest" && p.category !== "vine").map((p) => p.code),
  "plowing",
  "superficial_plowing",
  "crop_residues_grinding",
  "plant_grinding",
  "plant_mowing",
];

/**
 * Chute du couvert : d'un NDVI ≥ 0,5 à ≤ 0,3 en 45 jours au plus. Une
 * intervention saisie de 7 jours avant la chute à 30 jours après l'explique :
 * un maïs grain sèche sur pied et atteint 0,3 deux à quatre semaines avant
 * la récolte (constaté chez Pierre en 2025). On n'alerte donc qu'une fois ces
 * 30 jours écoulés.
 */
export const COVER_LOSS = { high: 0.5, low: 0.3, maxDays: 45, beforeDays: 7, afterDays: 30, confirmDays: 30 } as const;

/**
 * Chute du NDVI vers le sol nu sans intervention saisie qui retire le
 * couvert (récolte probable). `from` : dernière mesure couverte ; `to` :
 * première mesure au niveau du sol nu.
 */
export interface CoverLossAnomaly {
  parcelId: string;
  parcelName: string;
  from: string;
  to: string;
  high: number;
  low: number;
  /** Une mesure suivante reste au niveau du sol nu (sinon : une seule mesure basse). */
  confirmed: boolean;
  /** Fin du délai laissé à la saisie (to + 30 jours), dépassé. */
  dueSince: string;
  /** Procédure proposée pour la saisie. */
  suggestedProcedure: string;
}
