import type { CanopyPhase, ParcelCanopy } from "@fourmy/contracts";
import { addDays, dayNumber, type SeriesPoint } from "./remote-sensing.js";

/**
 * Végétation du plan 3D (lot AA, docs/jumeau-3d.md) : profils de culture,
 * état du couvert à une date d'après le NDVI lissé et les interventions, et
 * découpage des rangs d'une parcelle. Pur : ni base, ni réseau, ni Cesium.
 */

export interface CropProfile {
  /** Hauteur adulte (m). */
  maxHeightM: number;
  /** Inter-rang réel par défaut (m). */
  spacingM: number;
  /** Largeur d'un rang à pleine densité, en part de l'inter-rang dessiné. */
  widthFraction: number;
}

const CEREAL: CropProfile = { maxHeightM: 1.0, spacingM: 0.15, widthFraction: 0.95 };
const PROFILES: Record<string, CropProfile> = {
  zea_mays: { maxHeightM: 2.5, spacingM: 0.75, widthFraction: 0.7 },
  helianthus_annuus: { maxHeightM: 1.9, spacingM: 0.6, widthFraction: 0.7 },
  brassica_napus: { maxHeightM: 1.5, spacingM: 0.3, widthFraction: 0.95 },
  beta_vulgaris: { maxHeightM: 0.5, spacingM: 0.45, widthFraction: 0.9 },
  glycine_max: { maxHeightM: 0.9, spacingM: 0.5, widthFraction: 0.85 },
  triticum: CEREAL,
  triticum_aestivum: CEREAL,
  triticum_durum: CEREAL,
  hordeum_vulgare: { ...CEREAL, maxHeightM: 0.9 },
  x_triticosecale: { ...CEREAL, maxHeightM: 1.2 },
  secale_cereale: { ...CEREAL, maxHeightM: 1.4 },
  avena_sativa: CEREAL,
  vitis: { maxHeightM: 1.8, spacingM: 2.0, widthFraction: 0.25 },
};
const GRASSLAND: CropProfile = { maxHeightM: 0.5, spacingM: 0.5, widthFraction: 1 };
const DEFAULT: CropProfile = { maxHeightM: 1.0, spacingM: 0.5, widthFraction: 0.85 };

/** Profil d'une production : l'espèce d'abord (les cépages sont des `vitis`), sinon la nature. */
export function cropProfile(species: string | null, nature: string | null): CropProfile {
  if (nature === "vine") return PROFILES.vitis!;
  if (species && PROFILES[species]) return PROFILES[species]!;
  if (nature === "grassland") return GRASSLAND;
  return DEFAULT;
}

/** Inter-rang dessiné : au moins 1 m hors vigne (les céréales semées à 15 cm forment un couvert continu). */
export const visualSpacing = (profile: CropProfile, spacingM: number, nature: string | null) => (nature === "vine" ? spacingM : Math.max(spacingM, 1));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export interface CanopyInput {
  day: string;
  nature: string | null;
  species: string | null;
  /** Courbe NDVI lissée (journalière) de la parcelle, jusqu'à `day` au moins. */
  smoothed: SeriesPoint[];
  /** Dates des interventions réalisées qui retirent le couvert (récolte, broyage, fauche, labour). */
  removals: string[];
}

/**
 * Le NDVI monte bien plus vite que la plante (il sature dès que le sol est
 * couvert) : hauteur ∝ croissance^1,5. Maïs de Pierre : ~0,7 m fin mai
 * (NDVI 0,46), ~1,9 m fin juin (0,67), 2,5 m au pic.
 */
const GROWTH_EXPONENT = 1.5;

/** Au-delà, la dernière mesure ne dit plus l'état du jour. */
const MAX_AGE_DAYS = 20;

/**
 * État du couvert d'une parcelle à `day`, d'après sa courbe NDVI lissée :
 * - **en croissance** tant que le NDVI est au plus haut (hauteur ∝ NDVI) ;
 * - **en sénescence** quand il redescend après un pic ≥ 0,5 (hauteur gardée,
 *   feuillage clairsemé) ;
 * - **récolté** si une intervention qui retire le couvert est réalisée après
 *   le pic, ou si le NDVI retombe sous 0,25 (sol nu, récolte non saisie) ;
 * - **sol nu** sans couvert notable ; **inconnu** sans mesure récente.
 * La vigne garde sa structure : seul son feuillage suit le NDVI (dormante l'hiver).
 */
export function canopyAt(input: CanopyInput): ParcelCanopy {
  const profile = cropProfile(input.species, input.nature);
  const series = input.smoothed.filter((p) => p.date <= input.day).sort((a, b) => a.date.localeCompare(b.date));
  const last = series[series.length - 1];
  const fresh = last && dayNumber(input.day) - dayNumber(last.date) <= MAX_AGE_DAYS ? last : undefined;
  const ndvi = fresh ? round(fresh.value, 3) : null;
  const observedOn = fresh?.date ?? null;
  const out = (phase: CanopyPhase, heightM: number, density: number): ParcelCanopy => ({
    phase,
    heightM: round(heightM),
    density: round(clamp01(density)),
    ndvi,
    observedOn,
  });

  if (input.nature === "vine") {
    if (ndvi === null) {
      const month = Number(input.day.slice(5, 7));
      return month >= 11 || month <= 3 ? out("dormant", 0.9, 0) : out("unknown", 0.9, 0);
    }
    const leaves = clamp01((ndvi - 0.3) / 0.35);
    return leaves < 0.1 ? out("dormant", 0.9, 0) : out("growing", 0.9 + (profile.maxHeightM - 0.9) * leaves, leaves);
  }

  const lastRemoval = input.removals.filter((d) => d <= input.day).sort().pop();
  if (ndvi === null) {
    // Sans mesure récente, une récolte saisie depuis moins de 60 jours suffit à dire « chaumes ».
    return lastRemoval && lastRemoval >= addDays(input.day, -60) ? out("harvested", 0.12, 0.3) : out("unknown", 0, 0);
  }
  // Pic du cycle en cours : sur les 150 derniers jours.
  const window = series.filter((p) => p.date >= addDays(input.day, -150));
  const peak = window.reduce((best, p) => (p.value > best.value ? p : best), window[0]!);
  const growth = clamp01((ndvi - 0.25) / 0.5);
  // Récolte après le pic : chaumes, même si le satellite n'est pas encore repassé.
  if (lastRemoval && lastRemoval >= peak.date && (ndvi < 0.45 || lastRemoval >= observedOn!)) return out("harvested", 0.12, 0.3);
  // Retombé au niveau du sol nu après un pic : récolté, même non saisi (un maïs sec sur pied reste vers 0,27–0,30).
  if (peak.value >= 0.5 && ndvi < 0.25) return out("harvested", 0.12, 0.3);
  if (peak.value >= 0.5 && ndvi < peak.value - 0.05) {
    // Sénescence : la plante reste debout (maïs qui sèche) jusqu'à la récolte.
    const reached = profile.maxHeightM * clamp01((peak.value - 0.25) / 0.5) ** GROWTH_EXPONENT;
    return out("senescent", reached, Math.max(0.3, clamp01((ndvi - 0.15) / 0.5)));
  }
  if (growth < 0.05) return out("bare", 0, 0);
  return out("growing", profile.maxHeightM * growth ** GROWTH_EXPONENT, clamp01((ndvi - 0.2) / 0.5));
}

export interface RowPiece {
  /** Milieu du tronçon (m, repère local est/nord). */
  x: number;
  y: number;
  /** Longueur du tronçon (m), le long de l'orientation des rangs. */
  length: number;
}

/**
 * Rangs d'une parcelle en repère local (m, est/nord) : droites parallèles
 * orientées à `bearingDeg` (depuis le nord, sens horaire), espacées de
 * `spacingM`, découpées par le contour (trous compris, règle pair-impair),
 * raccourcies de `insetM` à chaque bout, puis tronçonnées à `maxPieceM` au plus
 * pour suivre le relief. `limit` borne le nombre de tronçons (null au-delà).
 */
export function rowPieces(
  rings: [number, number][][],
  opts: { bearingDeg: number; spacingM: number; insetM?: number; maxPieceM?: number; limit?: number },
): RowPiece[] | null {
  const b = (opts.bearingDeg * Math.PI) / 180;
  const dir: [number, number] = [Math.sin(b), Math.cos(b)];
  const nrm: [number, number] = [Math.cos(b), -Math.sin(b)];
  const inset = opts.insetM ?? 0.5;
  const maxPiece = opts.maxPieceM ?? 15;
  const limit = opts.limit ?? 50_000;
  const edges: [[number, number], [number, number]][] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) edges.push([ring[i]!, ring[i + 1]!]);
    for (const p of ring) {
      const o = p[0] * nrm[0] + p[1] * nrm[1];
      lo = Math.min(lo, o);
      hi = Math.max(hi, o);
    }
  }
  if (!Number.isFinite(lo) || opts.spacingM <= 0) return [];
  const pieces: RowPiece[] = [];
  for (let o = lo + opts.spacingM / 2; o < hi; o += opts.spacingM) {
    const along: number[] = [];
    for (const [a, c] of edges) {
      // Légère perturbation : une droite qui passe par un sommet n'est comptée qu'une fois.
      const oa = a[0] * nrm[0] + a[1] * nrm[1] - o - 1e-9;
      const oc = c[0] * nrm[0] + c[1] * nrm[1] - o - 1e-9;
      if (oa * oc >= 0) continue;
      const t = oa / (oa - oc);
      const x = a[0] + (c[0] - a[0]) * t;
      const y = a[1] + (c[1] - a[1]) * t;
      along.push(x * dir[0] + y * dir[1]);
    }
    along.sort((p, q) => p - q);
    for (let k = 0; k + 1 < along.length; k += 2) {
      const s0 = along[k]! + inset;
      const s1 = along[k + 1]! - inset;
      if (s1 - s0 < 0.5) continue;
      const n = Math.ceil((s1 - s0) / maxPiece);
      const step = (s1 - s0) / n;
      for (let j = 0; j < n; j++) {
        const s = s0 + step * (j + 0.5);
        pieces.push({ x: o * nrm[0] + s * dir[0], y: o * nrm[1] + s * dir[1], length: step });
        if (pieces.length > limit) return null;
      }
    }
  }
  return pieces;
}

/** Projection locale (m) autour d'une origine : suffisante à l'échelle d'une parcelle. */
export function localFrame(lon0: number, lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  const R = 6_378_137;
  return {
    toLocal: (lon: number, lat: number): [number, number] => [((lon - lon0) * Math.PI * R * k) / 180, ((lat - lat0) * Math.PI * R) / 180],
    toLonLat: (x: number, y: number): [number, number] => [lon0 + (x * 180) / (Math.PI * R * k), lat0 + (y * 180) / (Math.PI * R)],
  };
}
