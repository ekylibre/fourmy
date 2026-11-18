import type { Bounds } from "./tiles.js";
import { GEOPF_WFS } from "./bdtopo.js";
import { IgnHttpError } from "./elevation.js";

/**
 * Paysage de la BD TOPO pour le plan 3D (claudedocs/conception_rejeu_3d_outils_paysage.md §7) :
 * haies (lignes), zones de végétation (nature), lignes électriques (tension)
 * et pylônes (hauteur), par le WFS de la Géoplateforme. Seuls les champs
 * utiles sont gardés (une tuile de zoom 14 tient en quelques dizaines de ko).
 */

export type LandscapeKind = "hedge" | "vegetation" | "power_line" | "pylon";

const TYPENAMES: Record<LandscapeKind, string> = {
  hedge: "BDTOPO_V3:haie",
  vegetation: "BDTOPO_V3:zone_de_vegetation",
  power_line: "BDTOPO_V3:ligne_electrique",
  pylon: "BDTOPO_V3:pylone",
};

export interface LandscapeFeature {
  id: string;
  kind: LandscapeKind;
  /** Coordonnées [lon, lat] (l'altitude des lignes est retirée : altitudes NGF, voir la conception §7.4). */
  geometry: { type: "Point" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon"; coordinates: unknown };
  /** Nature d'une zone de végétation (« Bois », « Haie »…). */
  nature?: string;
  /** Hauteur d'un pylône (m). */
  heightM?: number;
  /** Tension d'une ligne (kV). */
  voltageKv?: number;
}

export function landscapeUrl(kind: LandscapeKind, b: Bounds, count = 500, startIndex = 0, base = GEOPF_WFS): string {
  const p = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: TYPENAMES[kind],
    SRSNAME: "EPSG:4326",
    // WFS 2.0 + URN EPSG:4326 : ordre latitude, longitude.
    BBOX: `${b.south},${b.west},${b.north},${b.east},urn:ogc:def:crs:EPSG::4326`,
    OUTPUTFORMAT: "application/json",
    COUNT: String(count),
  });
  if (startIndex) p.set("STARTINDEX", String(startIndex));
  return `${base}?${p.toString()}`;
}

type Feature = { id?: string; geometry: { type: string; coordinates: unknown } | null; properties: Record<string, unknown> };

/** Coordonnées sans altitude, arrondies au centimètre près (7 décimales). */
function flat(c: unknown): unknown {
  if (Array.isArray(c) && typeof c[0] === "number") return [Math.round((c[0] as number) * 1e7) / 1e7, Math.round((c[1] as number) * 1e7) / 1e7];
  return Array.isArray(c) ? c.map(flat) : c;
}

/** « 225 kV » → 225 ; « 63 kV » → 63 ; sinon undefined. */
export function voltageKv(v: unknown): number | undefined {
  const m = typeof v === "string" ? /(\d+(?:[.,]\d+)?)\s*kV/i.exec(v) : null;
  return m ? Number(m[1]!.replace(",", ".")) : undefined;
}

export function parseLandscape(kind: LandscapeKind, json: { features?: Feature[] }): LandscapeFeature[] {
  const accepted: Record<LandscapeKind, string[]> = {
    hedge: ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
    vegetation: ["Polygon", "MultiPolygon"],
    power_line: ["LineString", "MultiLineString"],
    pylon: ["Point"],
  };
  return (json.features ?? [])
    .filter((f) => f.geometry && accepted[kind].includes(f.geometry.type))
    .filter((f) => (f.properties.etat_de_l_objet ?? "En service") === "En service")
    .map((f, i) => {
      const p = f.properties;
      const out: LandscapeFeature = {
        id: String(p.cleabs ?? f.id ?? `${kind}-${i}`),
        kind,
        geometry: { type: f.geometry!.type as LandscapeFeature["geometry"]["type"], coordinates: flat(f.geometry!.coordinates) },
      };
      if (typeof p.nature === "string") out.nature = p.nature;
      if (typeof p.hauteur === "number" && p.hauteur > 0) out.heightM = p.hauteur;
      const kv = voltageKv(p.voltage);
      if (kv !== undefined) out.voltageKv = kv;
      return out;
    });
}

const PAGE = 500;
const MAX_PAGES = 20;

/** Paysage d'une emprise : les quatre types, page par page. */
export async function fetchLandscape(b: Bounds, fetchImpl: typeof fetch = fetch): Promise<LandscapeFeature[]> {
  const items: LandscapeFeature[] = [];
  for (const kind of Object.keys(TYPENAMES) as LandscapeKind[]) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetchImpl(landscapeUrl(kind, b, PAGE, page * PAGE), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new IgnHttpError(`BD TOPO indisponible (${res.status})`, res.status, Number(res.headers.get("retry-after")) || null);
      const json = (await res.json()) as { features?: Feature[] };
      items.push(...parseLandscape(kind, json));
      if ((json.features?.length ?? 0) < PAGE) break;
    }
  }
  return items;
}
