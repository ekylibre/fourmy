import { samplingBbox, type Bounds } from "./tiles.js";

/**
 * Relief IGN (RGE ALTI) servi par le WMS-R de la Géoplateforme en grille
 * brute `image/x-bil;bits=32` (flottants little-endian, ligne 0 au nord,
 * colonne 0 à l'ouest — vérifié le 2026-11-07 contre le service d'altimétrie
 * ponctuel, écart < 0,2 m). Aucune donnée à stocker : la tuile est calculée
 * à la demande puis mise en cache (ADR-9, révisée après le spike).
 */
export const GEOPF_WMS_R = "https://data.geopf.fr/wms-r";
export const ELEVATION_LAYER = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES";

/** Valeurs « pas de donnée » (mer, hors France) ramenées au niveau de la mer. */
const NODATA_BELOW = -1000;

export function elevationUrl(b: Bounds, size: number, base = GEOPF_WMS_R): string {
  const s = samplingBbox(b, size);
  const p = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: ELEVATION_LAYER,
    STYLES: "",
    CRS: "EPSG:4326",
    // WMS 1.3.0 + EPSG:4326 : ordre des axes latitude, longitude.
    BBOX: [s.south, s.west, s.north, s.east].join(","),
    WIDTH: String(size),
    HEIGHT: String(size),
    FORMAT: "image/x-bil;bits=32",
  });
  return `${base}?${p.toString()}`;
}

/** Décode une grille BIL float32 little-endian ; « pas de donnée » → 0. */
export function decodeBil(buffer: ArrayBuffer, size: number): Float32Array {
  if (buffer.byteLength !== size * size * 4) {
    throw new Error(`Grille de relief inattendue : ${buffer.byteLength} octets pour ${size}×${size}.`);
  }
  const view = new DataView(buffer);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = view.getFloat32(i * 4, true);
    out[i] = Number.isFinite(v) && v > NODATA_BELOW ? v : 0;
  }
  return out;
}

/** Erreur HTTP de la Géoplateforme (429 = limite de débit, 5xx = indisponible). */
export class IgnHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

export async function fetchHeightmap(
  b: Bounds,
  size: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Float32Array> {
  const res = await fetchImpl(elevationUrl(b, size), { signal: AbortSignal.timeout(20_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/x-bil")) {
    const retry = Number(res.headers.get("retry-after"));
    throw new IgnHttpError(`Relief IGN indisponible (${res.status} ${type})`, res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return decodeBil(await res.arrayBuffer(), size);
}
