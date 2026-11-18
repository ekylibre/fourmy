import type { Bounds } from "./tiles.js";
import { GEOPF_WMS_R, IgnHttpError } from "./elevation.js";

/**
 * Hauteur de la végétation (MNH du LiDAR HD de l'IGN) pour le plan 3D
 * (claudedocs/conception_rejeu_3d_outils_paysage.md §8) : grille float32 par
 * tuile Web Mercator de zoom 14 (environ 2,2 m entre deux points), par le
 * WMS-R de la Géoplateforme. Hors couverture LiDAR : NaN.
 *
 * Le MNH est la hauteur au-dessus du sol de tout ce qui dépasse : arbres,
 * mais aussi bâtiments et cultures hautes (maïs). D'où les exclusions de
 * `canopyPeaks` et les seuils de la conception.
 */

export const CANOPY_LAYER = "IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G";
/** Points par côté d'une tuile de zoom 14. */
export const CANOPY_SIZE = 768;
/** En deçà : pas de donnée (l'IGN marque l'absence par -99999). */
const NODATA_BELOW = -50;

/** Requête GetMap BIL float32 ; la grille est celle des centres de pixel de l'emprise. */
export function canopyUrl(b: Bounds, size = CANOPY_SIZE, base = GEOPF_WMS_R): string {
  const p = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: CANOPY_LAYER,
    STYLES: "",
    CRS: "EPSG:4326",
    // WMS 1.3.0 + EPSG:4326 : ordre des axes latitude, longitude.
    BBOX: [b.south, b.west, b.north, b.east].join(","),
    WIDTH: String(size),
    HEIGHT: String(size),
    FORMAT: "image/x-bil;bits=32",
  });
  return `${base}?${p.toString()}`;
}

/** Grille BIL float32 little-endian ; « pas de donnée » → NaN. */
export function decodeCanopy(buffer: ArrayBuffer, size = CANOPY_SIZE): Float32Array {
  if (buffer.byteLength !== size * size * 4) throw new Error(`Grille de hauteur inattendue : ${buffer.byteLength} octets pour ${size}×${size}.`);
  const view = new DataView(buffer);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = view.getFloat32(i * 4, true);
    out[i] = Number.isFinite(v) && v > NODATA_BELOW ? Math.max(0, v) : NaN;
  }
  return out;
}

export async function fetchCanopy(b: Bounds, size = CANOPY_SIZE, fetchImpl: typeof fetch = fetch): Promise<Float32Array> {
  const res = await fetchImpl(canopyUrl(b, size), { signal: AbortSignal.timeout(30_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/x-bil")) {
    const retry = Number(res.headers.get("retry-after"));
    throw new IgnHttpError(`Hauteur de la végétation IGN indisponible (${res.status} ${type})`, res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return decodeCanopy(await res.arrayBuffer(), size);
}

/** Grille de hauteurs et son emprise. */
export interface CanopyGrid {
  bounds: Bounds;
  size: number;
  data: Float32Array;
}

/** Colonne et rangée du pixel qui contient (lon, lat) ; null hors de la grille. */
function pixel(g: CanopyGrid, lon: number, lat: number): [number, number] | null {
  const { west, east, south, north } = g.bounds;
  const i = Math.floor(((lon - west) / (east - west)) * g.size);
  const j = Math.floor(((north - lat) / (north - south)) * g.size);
  return i < 0 || j < 0 || i >= g.size || j >= g.size ? null : [i, j];
}

/**
 * Hauteur au pied d'un arbre : le maximum dans un voisinage de `radius`
 * pixels (le point de la BD TOPO ne tombe pas toujours sur la cime).
 * null : hors de la grille ou sans donnée LiDAR.
 */
export function canopyAt(grids: readonly CanopyGrid[], lon: number, lat: number, radius = 1): number | null {
  for (const g of grids) {
    const p = pixel(g, lon, lat);
    if (!p) continue;
    let best = NaN;
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const [i, j] = [p[0] + di, p[1] + dj];
        if (i < 0 || j < 0 || i >= g.size || j >= g.size) continue;
        const v = g.data[j * g.size + i]!;
        if (!Number.isNaN(v) && !(v <= best)) best = v;
      }
    }
    return Number.isNaN(best) ? null : best;
  }
  return null;
}

/**
 * Cimes : maxima locaux d'au moins `minHeightM` dans une fenêtre de
 * (2 × `radius` + 1) pixels de côté. `minHeightAt` relève le seuil par
 * endroit (cultures hautes) ; Infinity l'interdit (bâtiments).
 */
export function canopyPeaks(
  g: CanopyGrid,
  opts: { minHeightM: number; radius?: number; minHeightAt?: (lon: number, lat: number) => number },
): { lon: number; lat: number; heightM: number }[] {
  const { size, data, bounds } = g;
  const r = opts.radius ?? 2;
  const dx = (bounds.east - bounds.west) / size;
  const dy = (bounds.north - bounds.south) / size;
  const out: { lon: number; lat: number; heightM: number }[] = [];
  for (let j = r; j < size - r; j++) {
    for (let i = r; i < size - r; i++) {
      const v = data[j * size + i]!;
      if (!(v >= opts.minHeightM)) continue;
      let peak = true;
      for (let dj = -r; dj <= r && peak; dj++) {
        for (let di = -r; di <= r; di++) {
          if (!di && !dj) continue;
          const w = data[(j + dj) * size + i + di]!;
          // Égalité : seul le premier pixel (haut-gauche) compte, pour ne pas doubler une cime plate.
          if (w > v || (w === v && (dj < 0 || (dj === 0 && di < 0)))) {
            peak = false;
            break;
          }
        }
      }
      if (!peak) continue;
      const lon = bounds.west + (i + 0.5) * dx;
      const lat = bounds.north - (j + 0.5) * dy;
      if (opts.minHeightAt && v < opts.minHeightAt(lon, lat)) continue;
      out.push({ lon, lat, heightM: Math.round(v * 10) / 10 });
    }
  }
  return out;
}
