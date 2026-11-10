/**
 * Stations météo de l'agriculteur (lot W, retours du 10/11/2026) : Weenat
 * (API de l'application, identifiants de l'agriculteur) et Sencrop
 * (identifiant et secret d'application, OAuth2 client credentials). Mesures
 * horaires ramenées à un même format ; références : plugins Ekylibre
 * ekylibre-weenat et ekylibre-sencrop.
 */

export interface StationInfo {
  externalId: string;
  name: string;
  lat: number | null;
  lon: number | null;
}

export interface StationMeasure {
  /** Heure de la mesure (ISO, UTC), telle que donnée par le fournisseur. */
  at: string;
  temperatureC: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  windDirectionDeg: number | null;
  precipitationMm: number | null;
  /** Durée d'humectation du feuillage sur l'heure (min). */
  leafWetnessMin: number | null;
  raw: Record<string, unknown>;
}

export interface StationClient {
  stations(): Promise<StationInfo[]>;
  /** Mesures horaires de [from, to] ; découpe la fenêtre selon les limites du fournisseur. */
  measures(externalId: string, from: Date, to: Date): Promise<StationMeasure[]>;
}

export class StationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

async function call<T>(fetchImpl: typeof fetch, url: string, init: RequestInit, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new StationError(`${label} refuse l'accès (${res.status}) : vérifiez les identifiants.`, res.status);
    // Limite de débit : on attend puis on réessaie.
    if (res.status === 429 || res.status >= 500) {
      lastError = new StationError(`${label} : HTTP ${res.status}`, res.status);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new StationError(`${label} : HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  }
  throw lastError instanceof Error ? lastError : new StationError(`${label} injoignable`);
}

/** Fenêtres successives de `days` jours couvrant [from, to]. */
export function windows(from: Date, to: Date, days: number): { from: Date; to: Date }[] {
  const out: { from: Date; to: Date }[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += days * DAY) out.push({ from: new Date(t), to: new Date(Math.min(t + days * DAY, to.getTime())) });
  return out;
}

// --- Weenat --------------------------------------------------------------------

export const WEENAT_URL = "https://api-prod.weenat.com/api";

/** Weenat : e-mail et mot de passe de l'application ; jeton JWT gardé pour la session. */
export class WeenatClient implements StationClient {
  private token: string | null = null;
  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = WEENAT_URL,
  ) {}

  private async auth(): Promise<string> {
    if (this.token) return this.token;
    const r = await call<{ token?: string }>(
      this.fetchImpl,
      `${this.base}/api-token-auth/`,
      { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: this.email, password: this.password }) },
      "Weenat",
    ).catch((e: unknown) => {
      // Mauvais identifiants : Weenat répond 400.
      if (e instanceof StationError && e.status === 400) throw new StationError("Weenat refuse l'accès : vérifiez l'e-mail et le mot de passe.", 400);
      throw e;
    });
    if (!r.token) throw new StationError("Weenat : jeton absent de la réponse.");
    this.token = r.token;
    return r.token;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.auth();
    return call<T>(this.fetchImpl, `${this.base}${path}`, { headers: { authorization: `JWT ${token}`, accept: "application/json" } }, "Weenat");
  }

  async stations(): Promise<StationInfo[]> {
    const plots = await this.get<{ id: number | string; name?: string; latitude?: number; longitude?: number }[]>("/v2/access/plots/");
    return (Array.isArray(plots) ? plots : []).map((p) => ({ externalId: String(p.id), name: p.name?.trim() || `Weenat ${p.id}`, lat: num(p.latitude), lon: num(p.longitude) }));
  }

  /** Mesures horaires (`{ "<epoch s>": { RR, T, U, FF, FXY, … } }`), par fenêtres de 30 jours (35 au plus chez Weenat). */
  async measures(externalId: string, from: Date, to: Date): Promise<StationMeasure[]> {
    const out: StationMeasure[] = [];
    for (const w of windows(from, to, 30)) {
      const s = Math.floor(w.from.getTime() / 1000);
      const e = Math.floor(w.to.getTime() / 1000);
      const data = await this.get<Record<string, Record<string, unknown>>>(`/v2/access/plots/${encodeURIComponent(externalId)}/measures/?start=${s}&end=${e}`);
      for (const [epoch, v] of Object.entries(data ?? {})) {
        const t = Number(epoch);
        if (!Number.isFinite(t) || !v || typeof v !== "object") continue;
        out.push({
          at: new Date(t * 1000).toISOString(),
          temperatureC: num(v.T),
          temperatureMinC: num(v.T_MIN),
          temperatureMaxC: num(v.T_MAX),
          humidityPct: num(v.U),
          windKmh: num(v.FF),
          gustKmh: num(v.FXY),
          windDirectionDeg: num(v.DD),
          precipitationMm: num(v.RR),
          leafWetnessMin: num(v.LW),
          raw: v,
        });
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }
}

// --- Sencrop -------------------------------------------------------------------

export const SENCROP_URL = "https://api.sencrop.com/v1";
const SENCROP_MEASURES = "RAIN_FALL,TEMPERATURE,TEMPERATURE_MIN,TEMPERATURE_MAX,RELATIVE_HUMIDITY,WIND_SPEED,WIND_GUST,WIND_DIRECTION,LEAF_WETNESS";

/** Sencrop : jeton OAuth2 (client credentials, ~1 h), renouvelé une minute avant expiration. */
export class SencropClient implements StationClient {
  private token: { value: string; until: number } | null = null;
  private userId: string | null = null;
  constructor(
    private readonly applicationId: string,
    private readonly applicationSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base = SENCROP_URL,
  ) {}

  private async auth(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const basic = Buffer.from(`${this.applicationId}:${this.applicationSecret}`).toString("base64");
    const r = await call<{ access_token?: string; expires_in?: number }>(
      this.fetchImpl,
      `${this.base}/oauth2/token`,
      {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", scope: "user" }),
      },
      "Sencrop",
    ).catch((e: unknown) => {
      if (e instanceof StationError && e.status === 400) throw new StationError("Sencrop refuse l'accès : vérifiez l'identifiant et le secret d'application.", 400);
      throw e;
    });
    if (!r.access_token) throw new StationError("Sencrop : jeton absent de la réponse.");
    this.token = { value: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 60) * 1000 };
    return r.access_token;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.auth();
    return call<T>(this.fetchImpl, `${this.base}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }, "Sencrop");
  }

  private async me(): Promise<string> {
    if (this.userId) return this.userId;
    const r = await this.get<{ item?: number | string }>("/me");
    if (r.item === undefined || r.item === null) throw new StationError("Sencrop : utilisateur introuvable (/me).");
    this.userId = String(r.item);
    return this.userId;
  }

  async stations(): Promise<StationInfo[]> {
    const uid = await this.me();
    const r = await this.get<{ items?: (number | string)[]; devicesStatuses?: Record<string, { contents?: { name?: string; latitude?: number; longitude?: number } }> }>(
      `/users/${encodeURIComponent(uid)}/devices?includeHistory=false`,
    );
    return (r.items ?? []).map((id) => {
      const c = r.devicesStatuses?.[String(id)]?.contents ?? {};
      return { externalId: String(id), name: c.name?.trim() || `Sencrop ${id}`, lat: num(c.latitude), lon: num(c.longitude) };
    });
  }

  /** Mesures horaires (`measures.data[{ key: ms, CODE: { value } }]`), par fenêtres de 7 jours avant `beforeDate`. */
  async measures(externalId: string, from: Date, to: Date): Promise<StationMeasure[]> {
    const uid = await this.me();
    const out = new Map<string, StationMeasure>();
    for (const w of windows(from, to, 7)) {
      const days = Math.max(1, Math.ceil((w.to.getTime() - w.from.getTime()) / DAY));
      const r = await this.get<{ measures?: { data?: Record<string, unknown>[] } }>(
        `/users/${encodeURIComponent(uid)}/devices/${encodeURIComponent(externalId)}/data/hourly?beforeDate=${encodeURIComponent(w.to.toISOString())}&days=${days}&measures=${SENCROP_MEASURES}`,
      );
      for (const p of r.measures?.data ?? []) {
        const key = num(p.key);
        if (key === null || key < from.getTime() || key > to.getTime()) continue;
        const v = (code: string) => num((p[code] as { value?: unknown } | undefined)?.value);
        const at = new Date(key).toISOString();
        out.set(at, {
          at,
          temperatureC: v("TEMPERATURE"),
          temperatureMinC: v("TEMPERATURE_MIN"),
          temperatureMaxC: v("TEMPERATURE_MAX"),
          humidityPct: v("RELATIVE_HUMIDITY"),
          windKmh: v("WIND_SPEED"),
          gustKmh: v("WIND_GUST"),
          windDirectionDeg: v("WIND_DIRECTION"),
          precipitationMm: v("RAIN_FALL"),
          leafWetnessMin: v("LEAF_WETNESS"),
          raw: p,
        });
      }
    }
    return [...out.values()].sort((a, b) => a.at.localeCompare(b.at));
  }
}
