import type { Bounds } from "./tiles.js";

/**
 * Bâtiments de la BD TOPO (WFS de la Géoplateforme) : emprise, hauteur,
 * altitude au sol, identifiants RNB (ADR-10).
 */
export const GEOPF_WFS = "https://data.geopf.fr/wfs/ows";

export interface IgnBuilding {
  id: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  heightM: number | null;
  groundAltitudeM: number | null;
  rnbIds: string | null;
}

export function buildingsUrl(b: Bounds, count = 500, base = GEOPF_WFS): string {
  const p = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: "BDTOPO_V3:batiment",
    SRSNAME: "EPSG:4326",
    // WFS 2.0 + URN EPSG:4326 : ordre latitude, longitude.
    BBOX: `${b.south},${b.west},${b.north},${b.east},urn:ogc:def:crs:EPSG::4326`,
    OUTPUTFORMAT: "application/json",
    COUNT: String(count),
  });
  return `${base}?${p.toString()}`;
}

type Feature = { id?: string; geometry: IgnBuilding["geometry"] | null; properties: Record<string, unknown> };

export function parseBuildings(json: { features?: Feature[] }): IgnBuilding[] {
  return (json.features ?? [])
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f, i) => ({
      id: String(f.properties.cleabs ?? f.id ?? i),
      geometry: f.geometry!,
      heightM: typeof f.properties.hauteur === "number" ? f.properties.hauteur : null,
      groundAltitudeM: typeof f.properties.altitude_minimale_sol === "number" ? f.properties.altitude_minimale_sol : null,
      rnbIds: typeof f.properties.identifiants_rnb === "string" ? f.properties.identifiants_rnb : null,
    }));
}

export async function fetchBuildings(b: Bounds, fetchImpl: typeof fetch = fetch): Promise<IgnBuilding[]> {
  const res = await fetchImpl(buildingsUrl(b), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`BD TOPO indisponible (${res.status})`);
  return parseBuildings((await res.json()) as { features?: Feature[] });
}
