/**
 * API Sirene v4 de l'INSEE : recherche d'une entreprise par nom, SIREN ou
 * SIRET, pour pré-remplir l'identité d'une ferme (assistant, lot IM6).
 * Méthode reprise de Lyvre (`app/services/sirene.py`) : appels côté serveur
 * seulement (la clé ne va jamais au navigateur), délai de 10 s, cache de
 * 24 h, quota de l'INSEE respecté dans le processus (30 requêtes par minute,
 * 2 000 par heure) : une recherche hors quota est refusée tout de suite.
 */

const TIMEOUT_MS = 10_000;
const CACHE_MS = 24 * 3_600_000;
const SEARCH_LIMIT = 8;
const ESTABLISHMENT_FIELDS = ["siren", "siret", "etatEtablissement", "etablissementSiege", "adresseEtablissement"];
const REPETITIONS: Record<string, string> = { B: "bis", T: "ter", Q: "quater", C: "quinquies" };

export class SireneError extends Error {
  constructor(
    readonly code: "not_configured" | "not_found" | "busy" | "unavailable" | "invalid",
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export interface SireneCandidate {
  siren: string;
  siret: string | null;
  name: string;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  headOffice: boolean;
  active: boolean;
}

export const sireneDeps = { fetch: (input: string, init?: RequestInit) => fetch(input, init), now: () => Date.now() };

const config = () => ({
  url: (process.env.SIRENE_API_URL ?? "https://api.insee.fr/api-sirene/4").replace(/\/$/, ""),
  key: process.env.FOURMY_SIRENE_API_KEY ?? process.env.SIRENE_API_KEY ?? process.env.INSEE_SIRENE_API_KEY ?? "",
});

export const sireneAvailable = () => !!config().key;

// --- Quota ---------------------------------------------------------------------------------

const LIMITS: [count: number, windowMs: number][] = [
  [30, 60_000],
  [2000, 3_600_000],
];
const calls: number[] = [];

function acquire(): void {
  const now = sireneDeps.now();
  while (calls.length && now - calls[0]! >= 3_600_000) calls.shift();
  let wait = 0;
  for (const [count, windowMs] of LIMITS) {
    const recent = calls.filter((t) => now - t < windowMs);
    if (recent.length >= count) wait = Math.max(wait, windowMs - (now - recent[recent.length - count]!));
  }
  if (wait > 0) throw new SireneError("busy", "Trop de recherches Sirene : réessayez dans quelques secondes.", Math.ceil(wait / 1000));
  calls.push(now);
}

// --- Appels --------------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: unknown }>();

async function request(method: "GET" | "POST", path: string, body?: unknown, useCache = true): Promise<unknown> {
  const { url, key } = config();
  if (!key) throw new SireneError("not_configured", "La recherche Sirene n'est pas configurée sur ce serveur.");
  const cacheKey = `${method} ${path} ${JSON.stringify(body ?? null)}`;
  const hit = cache.get(cacheKey);
  if (useCache && hit && sireneDeps.now() - hit.at < CACHE_MS) return hit.value;
  acquire();
  let res: Response;
  try {
    res = await sireneDeps.fetch(`${url}${path}`, {
      method,
      headers: { "X-INSEE-Api-Key-Integration": key, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SireneError("unavailable", "Sirene ne répond pas : réessayez plus tard.");
  }
  if (res.status === 404) throw new SireneError("not_found", "Numéro inconnu de Sirene.");
  if (res.status === 429) throw new SireneError("busy", "Sirene est très sollicité : réessayez dans un instant.", 60);
  if (res.status === 401 || res.status === 403) {
    console.warn(`[sirene] clé refusée par l'INSEE (HTTP ${res.status})`);
    throw new SireneError("not_configured", "La clé Sirene du serveur est refusée par l'INSEE : recherche indisponible.");
  }
  if (!res.ok) {
    console.warn(`[sirene] ${method} ${path} : HTTP ${res.status}`);
    throw new SireneError("unavailable", "Sirene ne répond pas : réessayez plus tard.");
  }
  const value = (await res.json().catch(() => {
    throw new SireneError("unavailable", "Réponse de Sirene illisible.");
  })) as unknown;
  if (useCache) {
    if (cache.size > 2000) cache.clear();
    cache.set(cacheKey, { at: sireneDeps.now(), value });
  }
  return value;
}

type Row = Record<string, unknown>;
const items = (data: unknown): Row[] => ((data as { items?: Row[] })?.items ?? []).map((r) => (r.item as Row) ?? r);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Nom d'une unité légale : dénomination, sinon « Prénom Nom » d'un entrepreneur individuel. */
function unitName(u: Row): string {
  const name = str(u.denominationUniteLegale);
  if (name) return name;
  const first = str(u.prenomUsuelUniteLegale) ?? str(u.prenom1UniteLegale);
  const last = str(u.nomUsageUniteLegale) ?? str(u.nomUniteLegale);
  return [first, last].filter(Boolean).join(" ") || String(u.siren ?? "");
}

function addressOf(e: Row | null): Pick<SireneCandidate, "line1" | "line2" | "postalCode" | "city"> {
  const a = (e?.adresseEtablissement ?? {}) as Row;
  const repetition = str(a.indiceRepetitionEtablissement);
  const street = [str(a.numeroVoieEtablissement), repetition ? (REPETITIONS[repetition] ?? repetition) : null, str(a.typeVoieEtablissement)?.toLowerCase(), str(a.libelleVoieEtablissement)]
    .filter(Boolean)
    .join(" ");
  return {
    line1: street || null,
    line2: str(a.complementAdresseEtablissement),
    postalCode: str(a.codePostalEtablissement),
    city: str(a.libelleCommuneEtablissement),
  };
}

const activeUnit = (u: Row) => !["C", "4"].includes(String(u.etatUniteLegale ?? ""));
const openEstablishment = (e: Row) => !["F", "3"].includes(String(e.etatEtablissement ?? ""));

function candidate(u: Row, e: Row | null): SireneCandidate {
  // Unité non diffusible (« P ») : pas d'adresse.
  const address = e && u.statutDiffusionUniteLegale !== "P" ? addressOf(e) : { line1: null, line2: null, postalCode: null, city: null };
  return {
    siren: String(u.siren),
    siret: str(e?.siret),
    name: unitName(u),
    ...address,
    headOffice: !!e?.etablissementSiege,
    active: activeUnit(u) && (!e || openEstablishment(e)),
  };
}

/** Recherche par nom (unités actives et leur siège), SIREN ou SIRET (sa fiche). */
export async function sireneSearch(text: string, postalCode?: string | null): Promise<SireneCandidate[]> {
  const digits = text.replace(/[\s.]/g, "");
  if (/^(\d{9}|\d{14})$/.test(digits)) {
    const unit = (await request("GET", `/etat-courant/unites-legales/${digits.slice(0, 9)}`)) as Row;
    let est: Row | null = null;
    if (digits.length === 14) est = (await request("GET", `/etat-courant/etablissements/${digits}?champs=${ESTABLISHMENT_FIELDS.join(",")}`)) as Row;
    else if (unit.nicSiegeUniteLegale) {
      est = items(await request("POST", "/etat-courant/etablissements/multicritere", { siren: [digits], etablissementSiege: true, champs: ESTABLISHMENT_FIELDS, nombre: 1 }))[0] ?? null;
    }
    return [candidate(unit, est)];
  }
  const q = text.trim();
  if (q.length < 3) throw new SireneError("invalid", "Saisissez au moins trois caractères, un SIREN ou un SIRET.");
  const units = items(await request("POST", "/etat-courant/unites-legales/multicritere", { denominationUniteLegale: [q], etatUniteLegale: ["1"], nombre: SEARCH_LIMIT }, false));
  if (!units.length) return [];
  const sirens = units.map((u) => String(u.siren));
  const postal = postalCode?.replace(/\s/g, "");
  const rows = items(
    await request(
      "POST",
      "/etat-courant/etablissements/multicritere",
      postal
        ? { siren: sirens, codePostalEtablissement: [postal], etatEtablissement: ["1"], champs: ESTABLISHMENT_FIELDS, nombre: SEARCH_LIMIT }
        : { siren: sirens, etablissementSiege: true, champs: ESTABLISHMENT_FIELDS, nombre: sirens.length },
      false,
    ),
  );
  const bySiren = new Map(rows.map((e) => [String(e.siren), e]));
  return units.filter((u) => !postal || bySiren.has(String(u.siren))).map((u) => candidate(u, bySiren.get(String(u.siren)) ?? null));
}
