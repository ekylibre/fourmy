/**
 * Commune d'un point, par l'API Géo de l'État (geo.api.gouv.fr, sans clé,
 * code officiel géographique de l'INSEE). Sert au zonage nitrates des
 * parcelles (lot AF).
 */

export const GEO_API = "https://geo.api.gouv.fr";

export async function communeAt(
  lon: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
  base = GEO_API,
): Promise<{ insee: string; name: string } | null> {
  const res = await fetchImpl(`${base}/communes?lat=${lat}&lon=${lon}&fields=code,nom&format=json`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`API Géo : HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { code?: string; nom?: string }[] | null;
  const c = Array.isArray(body) ? body[0] : undefined;
  return c?.code && c.nom ? { insee: c.code, name: c.nom } : null;
}
