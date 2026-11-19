/**
 * Serveur de paquets Lexicon (OSFarm) : `index.json` donne la version
 * courante de chaque jeu de données ; chaque version publie `manifest.json`
 * (tables, fichiers et leur sha256), `structure.sql` et les données en CSV
 * gzip sans en-tête, colonnes dans l'ordre de `structure.sql`.
 *
 * Deux sources : le dépôt public (données ouvertes, sans clé), ou le bundle
 * « fourmy » de l'API Lexicon, servi avec une clé d'adhérent portant la
 * portée `bundle:fourmy` (même arborescence, en-tête `Authorization`), qui
 * ajoute les jeux réservés comme `agroedi`
 * (claudedocs/conception_import_onboarding.md §5.8).
 */

/** Serveur public des paquets Lexicon (OSFarm). */
export const LEXICON_PACKAGES_URL = "https://lexicon-packages.osfarm.org";

/** Bundle « fourmy » de l'API Lexicon (avec une clé). */
export const LEXICON_BUNDLE_URL = "https://lexicon.osfarm.org/bundles/fourmy";

export interface LexiconSource {
  base: string;
  /** Clé d'adhérent (`lex_…`) : envoyée en `Authorization: Bearer`. */
  apiKey?: string;
}

/**
 * Source d'après l'environnement : `FOURMY_LEXICON_PACKAGES_URL` (`off` :
 * pas de synchro → null), sinon le bundle si `FOURMY_LEXICON_API_KEY` est
 * fournie, sinon le dépôt public.
 */
export function lexiconSourceFromEnv(env: Record<string, string | undefined> = process.env): LexiconSource | null {
  const url = env.FOURMY_LEXICON_PACKAGES_URL?.trim();
  if (url === "off") return null;
  const apiKey = env.FOURMY_LEXICON_API_KEY?.trim() || undefined;
  return { base: url || (apiKey ? LEXICON_BUNDLE_URL : LEXICON_PACKAGES_URL), apiKey };
}

/**
 * `fetch` qui ajoute la clé à chaque requête vers la source (jamais vers un
 * autre hôte : une redirection ne la transmet pas).
 */
export function withApiKey(fetchImpl: typeof fetch, source: LexiconSource): typeof fetch {
  if (!source.apiKey) return fetchImpl;
  const origin = new URL(source.base).origin;
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) return fetchImpl(input, init);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${source.apiKey}`);
    return fetchImpl(input, { ...init, headers, redirect: "error" });
  }) as typeof fetch;
}

export interface PackageIndex {
  datasources: Record<string, { current: string; versions: string[] }>;
}

export interface PackageManifest {
  name: string;
  version: string;
  scope?: string;
  schema_revision?: number;
  tables: { name: string; rows: number; files: { path: string; sha256?: string }[] }[];
}

const SAFE = /^[A-Za-z0-9._-]+$/;

export function packageUrl(base: string, ...parts: string[]): string {
  for (const p of parts) {
    if (!p.split("/").every((x) => SAFE.test(x) && x !== "." && x !== "..")) throw new Error(`chemin de paquet invalide : ${p}`);
  }
  return `${base.replace(/\/+$/, "")}/${parts.join("/")}`;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Lexicon : ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchIndex(base: string, fetchImpl: typeof fetch = fetch): Promise<PackageIndex> {
  return getJson<PackageIndex>(packageUrl(base, "index.json"), fetchImpl);
}

export async function fetchManifest(base: string, name: string, version: string, fetchImpl: typeof fetch = fetch): Promise<PackageManifest> {
  return getJson<PackageManifest>(packageUrl(base, name, version, "manifest.json"), fetchImpl);
}

export async function fetchStructure(base: string, name: string, version: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = packageUrl(base, name, version, "structure.sql");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Lexicon : ${url} → HTTP ${res.status}`);
  return res.text();
}

/**
 * Colonnes de chaque table, lues dans `structure.sql` — seulement les noms
 * (validés), jamais exécuté : du SQL venu d'un serveur distant ne tourne pas
 * avec les droits du propriétaire de la base.
 */
export function parseStructure(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  for (const m of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\);/gi)) {
    const columns: string[] = [];
    for (const raw of topLevelParts(m[2]!.replace(/--[^\n]*/g, ""))) {
      const line = raw.trim();
      if (!line || /^(PRIMARY|CONSTRAINT|UNIQUE|FOREIGN|CHECK)\b/i.test(line)) continue;
      const col = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i);
      if (col) columns.push(col[1]!.toLowerCase());
    }
    tables.set(m[1]!.toLowerCase(), columns);
  }
  return tables;
}

/** Découpe une liste de définitions sur les virgules de premier niveau (pas dans `numeric(19,4)`). */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}
