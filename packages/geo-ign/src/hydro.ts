import type { Bounds } from "./tiles.js";
import { GEOPF_WFS } from "./bdtopo.js";

/**
 * Eau de la BD TOPO (WFS de la Géoplateforme, sans clé) : tronçons
 * hydrographiques (cours d'eau, permanents ou intermittents, fossés) et
 * surfaces hydrographiques (plans d'eau, bassins). La même source que
 * l'hydrographie de Lexicon ; ici avec les tracés, pour mesurer la distance
 * réelle d'une zone traitée à l'eau (ZNT).
 */

export interface WaterItem {
  id: string;
  kind: "line" | "area";
  nature: string | null;
  name: string | null;
  permanent: boolean | null;
  ditch: boolean;
  geometry: { type: string; coordinates: unknown };
}

const LAYERS = [
  { typename: "BDTOPO_V3:troncon_hydrographique", kind: "line" as const },
  { typename: "BDTOPO_V3:surface_hydrographique", kind: "area" as const },
];

export function waterUrl(typename: string, b: Bounds, startIndex = 0, count = 1000, base = GEOPF_WFS): string {
  const p = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: typename,
    SRSNAME: "EPSG:4326",
    BBOX: `${b.south},${b.west},${b.north},${b.east},urn:ogc:def:crs:EPSG::4326`,
    OUTPUTFORMAT: "application/json",
    COUNT: String(count),
    STARTINDEX: String(startIndex),
  });
  return `${base}?${p.toString()}`;
}

type Feature = { id?: string; geometry: WaterItem["geometry"] | null; properties: Record<string, unknown> };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseWater(json: { features?: Feature[] }, kind: "line" | "area"): WaterItem[] {
  return (json.features ?? [])
    .filter((f) => f.geometry && f.properties.fictif !== true && f.properties.etat_de_l_objet !== "En projet")
    .map((f, i) => ({
      id: String(f.properties.cleabs ?? f.id ?? `${kind}-${i}`),
      kind,
      nature: str(f.properties.nature),
      name: str(f.properties.cpx_toponyme_de_cours_d_eau) ?? str(f.properties.toponyme) ?? str(f.properties.cpx_toponyme_de_plan_d_eau),
      permanent: f.properties.persistance === "Permanent" ? true : f.properties.persistance === "Intermittent" ? false : null,
      ditch: f.properties.fosse === true,
      geometry: f.geometry!,
    }));
}

/** Toute l'eau d'une emprise, page par page (1 000 objets par requête, 20 pages au plus). */
export async function fetchWater(b: Bounds, fetchImpl: typeof fetch = fetch): Promise<WaterItem[]> {
  const items: WaterItem[] = [];
  for (const layer of LAYERS) {
    for (let page = 0; page < 20; page++) {
      const res = await fetchImpl(waterUrl(layer.typename, b, page * 1000), { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`BD TOPO (eau) indisponible (${res.status})`);
      const json = (await res.json()) as { features?: Feature[] };
      items.push(...parseWater(json, layer.kind));
      if ((json.features ?? []).length < 1000) break;
    }
  }
  return items;
}
