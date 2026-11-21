import type { Sql, TransactionSql } from "postgres";
import { EU_MARKET_CODES, euMarketCode } from "@fourmy/certification-refs";

/**
 * Prix de marché des céréales de l'API agrifood de la Commission européenne
 * (lot E3, décisions A12 et A16, claudedocs/conception_assolement.md §9.1) :
 * relevés français par semaine, en €/t, mis en cache dans `market_prices`.
 * Appelé par le worker, jamais depuis le navigateur. L'API tombe souvent
 * (erreur 500, point d'entrée suspendu depuis le 20/11/2026) : délai court,
 * nouvel essai le lendemain, et le cache comme le jeu Lexicon
 * `eu_market_prices` restent en repli.
 */

export const AGRIFOOD_URL = "https://api.tech.ec.europa.eu/agrifood";
/** `FOURMY_AGRIFOOD_URL` : autre adresse, ou `off` pour ne jamais appeler (tests, hors ligne). */
export const agrifoodBaseFromEnv = (env: Record<string, string | undefined> = process.env): string | null => {
  const url = env.FOURMY_AGRIFOOD_URL?.trim();
  return url === "off" ? null : url || AGRIFOOD_URL;
};

const SUCCESS_EVERY_MS = 7 * 86_400_000;
const RETRY_AFTER_MS = 86_400_000;

/** Élément de réponse de `/api/cereal/prices` (champs lus par Lexicon). */
interface AgrifoodItem {
  memberStateCode?: string;
  beginDate?: string;
  endDate?: string;
  productName?: string;
  marketName?: string;
  stageName?: string;
  unit?: string;
  price?: string | number | null;
}

export interface MarketPriceRow {
  id: string;
  productCode: string;
  specie: string | null;
  productLabel: string;
  market: string;
  stage: string | null;
  unit: string;
  price: number;
  startedOn: string;
  endedOn: string | null;
}

/** « €201,50 », « 1 201.5 » → 201.5 ; null si illisible. */
export function parseAgrifoodPrice(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (!v) return null;
  const cleaned = v.replace(/[^0-9,.]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) && n > 0 ? n : null;
}

/** « 13/04/2026 » → « 2026-04-13 » ; null si illisible. */
export function parseAgrifoodDate(v: string | undefined): string | null {
  const m = v?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const UNITS: Record<string, string> = { TONNES: "ton", TONNE: "ton", T: "ton" };

/** Lignes du cache d'une réponse ; les éléments sans prix, sans date ou hors France sont écartés. */
export function readAgrifoodItems(code: string, items: AgrifoodItem[]): MarketPriceRow[] {
  const ref = euMarketCode(code);
  const out: MarketPriceRow[] = [];
  for (const i of items) {
    const price = parseAgrifoodPrice(i.price);
    const startedOn = parseAgrifoodDate(i.beginDate);
    if (price === null || !startedOn || (i.memberStateCode && i.memberStateCode !== "FR")) continue;
    const market = (i.marketName ?? "").trim() || "France";
    out.push({
      id: `${code}_FR_${market}_${startedOn}`,
      productCode: code,
      specie: ref?.specie ?? null,
      productLabel: `${(i.productName ?? ref?.label ?? code).trim()} ${market}`.trim(),
      market,
      stage: i.stageName?.trim() || null,
      unit: UNITS[(i.unit ?? "TONNES").toUpperCase()] ?? (i.unit ?? "ton").toLowerCase(),
      price,
      startedOn,
      endedOn: parseAgrifoodDate(i.endDate),
    });
  }
  return out;
}

/** Prix d'un code depuis `since` (AAAA-MM-JJ). Erreur si l'API ne répond pas en 20 s ou pas en 200. */
export async function fetchCerealPrices(base: string, code: string, since: string, fetchImpl: typeof fetch = fetch): Promise<MarketPriceRow[]> {
  const [y, m, d] = since.split("-");
  const url = `${base.replace(/\/+$/, "")}/api/cereal/prices?memberStateCodes=FR&productCodes=${encodeURIComponent(code)}&beginDate=${d}/${m}/${y}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`agrifood ${code} : HTTP ${res.status}${body ? ` — ${body}` : ""}`);
  }
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error(`agrifood ${code} : réponse inattendue`);
  return readAgrifoodItems(code, json as AgrifoodItem[]);
}

export interface RefreshReport {
  status: "skipped" | "loaded" | "failed";
  rows: number;
  error?: string;
}

/**
 * Rafraîchit le cache : au plus une fois par semaine après une réussite, le
 * lendemain après un échec. Le premier code en erreur arrête le tour (l'API
 * est alors en panne pour tous) ; ce qui est déjà en cache reste.
 */
export async function refreshMarketPrices(
  sql: Sql | TransactionSql,
  { base, fetchImpl = fetch, now = new Date(), force = false }: { base: string; fetchImpl?: typeof fetch; now?: Date; force?: boolean },
): Promise<RefreshReport> {
  const [last] = await sql<{ attempted_at: Date; succeeded_at: Date | null }[]>`SELECT attempted_at, succeeded_at FROM market_price_fetches WHERE source = 'agrifood'`;
  if (!force && last) {
    const sinceSuccess = last.succeeded_at ? now.getTime() - last.succeeded_at.getTime() : Infinity;
    const sinceAttempt = now.getTime() - last.attempted_at.getTime();
    if (sinceSuccess < SUCCESS_EVERY_MS || sinceAttempt < RETRY_AFTER_MS) return { status: "skipped", rows: 0 };
  }
  // Depuis le dernier prix en cache (moins deux semaines, pour les corrections), au plus un an en arrière.
  const [newest] = await sql<{ d: string | null }[]>`SELECT max(started_on)::text AS d FROM market_prices`;
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const since = newest?.d ? new Date(Date.parse(newest.d) - 14 * 86_400_000).toISOString().slice(0, 10) : yearAgo;
  let rows = 0;
  try {
    for (const { code } of EU_MARKET_CODES) {
      const list = await fetchCerealPrices(base, code, since < yearAgo ? yearAgo : since, fetchImpl);
      for (const r of list) {
        await sql`
          INSERT INTO market_prices (id, product_code, specie, product_label, market, stage, unit, price, started_on, ended_on, fetched_at)
          VALUES (${r.id}, ${r.productCode}, ${r.specie}, ${r.productLabel}, ${r.market}, ${r.stage}, ${r.unit}, ${r.price}, ${r.startedOn}, ${r.endedOn}, ${now})
          ON CONFLICT (id) DO UPDATE SET price = excluded.price, stage = excluded.stage, ended_on = excluded.ended_on, fetched_at = excluded.fetched_at`;
      }
      rows += list.length;
    }
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await sql`
      INSERT INTO market_price_fetches (source, attempted_at, rows, error) VALUES ('agrifood', ${now}, ${rows}, ${error})
      ON CONFLICT (source) DO UPDATE SET attempted_at = excluded.attempted_at, rows = excluded.rows, error = excluded.error`;
    return { status: "failed", rows, error };
  }
  await sql`
    INSERT INTO market_price_fetches (source, attempted_at, succeeded_at, rows, error) VALUES ('agrifood', ${now}, ${now}, ${rows}, NULL)
    ON CONFLICT (source) DO UPDATE SET attempted_at = excluded.attempted_at, succeeded_at = excluded.succeeded_at, rows = excluded.rows, error = NULL`;
  return { status: "loaded", rows };
}
