import { Lru } from "@fourmy/geo-ign";
import type { GeocodeResult, GeocodeType } from "@fourmy/contracts";

/**
 * Géocodage IGN relayé (claudedocs/conception_ma_ferme.md §5.2). Seule
 * l'adresse part vers la Géoplateforme (N1). Cache de 24 h : les suggestions
 * tapées lettre par lettre reviennent souvent. La Géoplateforme accepte
 * 50 requêtes par seconde par adresse IP (fiche data.gouv.fr de l'API) : nos
 * limites restent bien en dessous.
 */

const BASE = "https://data.geopf.fr/geocodage";
const TTL_MS = 24 * 3600_000;
export const geocodeConfig = { timeoutMs: 3000, perUserPerSecond: 5, globalPerSecond: 10 };
/** Injection pour les tests (comme `terrainDeps`). */
export const geocodeDeps = { fetch: (input: string, init?: RequestInit) => fetch(input, init) };

export class GeocodeUnavailable extends Error {}
export class GeocodeRateLimited extends Error {}

let cache = new Lru<string, { at: number; value: GeocodeResult[] }>(2000);

/** Fenêtres d'une seconde : une pour l'instance, une par utilisateur. */
const windows = new Map<string, { start: number; count: number }>();
function allow(key: string, limit: number, now: number): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= 1000) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear();
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

const TYPES = new Set<GeocodeType>(["housenumber", "street", "locality", "municipality"]);
type Feature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { label?: string; name?: string; postcode?: string; city?: string; citycode?: string; score?: number; type?: string };
};

function toResult(f: Feature): GeocodeResult | null {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  const type = p.type as GeocodeType;
  if (lon === undefined || lat === undefined || !TYPES.has(type) || !p.label || !p.postcode || !p.city || !p.citycode) return null;
  return {
    label: p.label,
    // Le « name » de l'IGN : numéro et voie, ou lieu-dit ; rien pour une commune seule.
    line1: type === "municipality" ? null : (p.name ?? null),
    postalCode: p.postcode,
    city: p.city,
    inseeCode: p.citycode,
    location: { lat, lon },
    score: Math.max(0, Math.min(1, p.score ?? 0)),
    type,
  };
}

async function call(url: string, userId: string): Promise<GeocodeResult[]> {
  const now = Date.now();
  if (!allow(`user:${userId}`, geocodeConfig.perUserPerSecond, now) || !allow("global", geocodeConfig.globalPerSecond, now)) throw new GeocodeRateLimited();
  let res: Response;
  try {
    res = await geocodeDeps.fetch(url, { signal: AbortSignal.timeout(geocodeConfig.timeoutMs) });
  } catch {
    throw new GeocodeUnavailable();
  }
  if (!res.ok) throw new GeocodeUnavailable();
  const body = (await res.json().catch(() => null)) as { features?: Feature[] } | null;
  return (body?.features ?? []).map(toResult).filter((r): r is GeocodeResult => r !== null);
}

async function cached(key: string, url: string, userId: string): Promise<GeocodeResult[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await call(url, userId);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Suggestions d'adresse (E4). Moins de 3 caractères : aucune requête. */
export async function geocodeSearch(q: string, limit: number, userId: string): Promise<GeocodeResult[]> {
  const query = q.trim().toLowerCase().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  const n = Math.max(1, Math.min(10, limit));
  return cached(`s:${n}:${query}`, `${BASE}/search?q=${encodeURIComponent(query)}&limit=${n}&index=address`, userId);
}

/** Adresse la plus proche d'un point placé à la main (affichée à titre indicatif). */
export async function geocodeReverse(lat: number, lon: number, userId: string): Promise<GeocodeResult | null> {
  // Arrondi à environ 1 m : deux déplacements quasi identiques partagent le cache.
  const la = lat.toFixed(5);
  const lo = lon.toFixed(5);
  const [r] = await cached(`r:${la}:${lo}`, `${BASE}/reverse?lat=${la}&lon=${lo}&limit=1&index=address`, userId);
  return r ?? null;
}

/** Pour les tests : vide le cache et les compteurs. */
export function resetGeocode(): void {
  windows.clear();
  cache = new Lru(2000);
}
