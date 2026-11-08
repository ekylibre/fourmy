/**
 * API Carto de l'IGN (sans clé) : registre parcellaire graphique (RPG, PAC,
 * 2015 à 2024 ; 2014 en v1) et parcelles cadastrales, en un point ou sur une
 * géométrie. Sert à créer une parcelle depuis la carte (comme
 * l'identificateur de parcelle de Lexicon) et à garder ses références (PAC,
 * cadastre) dans Fourmy, hors connexion comprise.
 */

export const API_CARTO = "https://apicarto.ign.fr/api";
/** Années du RPG servies par l'API Carto (v2). */
export const RPG_YEARS = { first: 2015, last: 2024 } as const;

type Geometry = { type: string; coordinates: unknown };

export interface CapParcel {
  /** Identifiant de la parcelle graphique dans le RPG de l'année. */
  id: string;
  year: number;
  cropCode: string;
  areaHa: number | null;
  geometry: Geometry;
}

export interface CadastralParcel {
  /** Identifiant cadastral (IDU), ex. 17387000ZA0001. */
  idu: string;
  section: string;
  numero: string;
  commune: string;
  inseeCode: string;
  /** Contenance cadastrale (m²). */
  areaM2: number | null;
  geometry: Geometry;
}

async function getFeatures(url: string, fetchImpl: typeof fetch): Promise<{ id?: string; properties: Record<string, unknown>; geometry: Geometry }[]> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`API Carto IGN : HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { features?: unknown[] } | null;
  if (!body || !Array.isArray(body.features)) throw new Error("API Carto IGN : réponse illisible.");
  return body.features as { id?: string; properties: Record<string, unknown>; geometry: Geometry }[];
}

const geomParam = (g: Geometry) => encodeURIComponent(JSON.stringify(g));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parcelles PAC (RPG) d'une année qui touchent la géométrie (souvent un point). */
export async function fetchCapParcels(geometry: Geometry, year: number, fetchImpl: typeof fetch = fetch, base = API_CARTO): Promise<CapParcel[]> {
  if (year < RPG_YEARS.first - 1 || year > RPG_YEARS.last) return [];
  const version = year < RPG_YEARS.first ? "v1" : "v2";
  const features = await getFeatures(`${base}/rpg/${version}?annee=${year}&geom=${geomParam(geometry)}`, fetchImpl);
  return features.map((f) => ({
    id: str(f.properties.id_parcel ?? f.properties.id_ilot ?? f.id),
    year,
    cropCode: str(f.properties.code_cultu ?? f.properties.code_cultu_majoritaire ?? f.properties.code_groupe_culture),
    areaHa: num(f.properties.surf_parc ?? f.properties.surf_ilot),
    geometry: f.geometry,
  }));
}

/** Parcelles cadastrales qui touchent la géométrie. */
export async function fetchCadastralParcels(geometry: Geometry, fetchImpl: typeof fetch = fetch, base = API_CARTO): Promise<CadastralParcel[]> {
  const features = await getFeatures(`${base}/cadastre/parcelle?geom=${geomParam(geometry)}`, fetchImpl);
  return features.map((f) => ({
    idu: str(f.properties.idu),
    section: str(f.properties.section),
    numero: str(f.properties.numero),
    commune: str(f.properties.nom_com),
    inseeCode: str(f.properties.code_insee),
    areaM2: num(f.properties.contenance),
    geometry: f.geometry,
  }));
}
