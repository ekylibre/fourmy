import type { VegetationIndex } from "@fourmy/contracts";
import { INDICES_EVALSCRIPT, NDVI_IMAGE_EVALSCRIPT, RGB_IMAGE_EVALSCRIPT, VALIDITY_EVALSCRIPT } from "./evalscripts.js";

export const CDSE_BASE_URL = "https://sh.dataspace.copernicus.eu";
export const CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";

export type Bbox = [west: number, south: number, east: number, north: number];

/** Polygone ou multipolygone GeoJSON. */
export interface PolygonGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}

/** Géométrie projetée (UTM, mètres) : la résolution de 10 m s'y exprime en mètres. */
export interface ProjectedGeometry {
  epsg: number;
  geometry: PolygonGeometry;
}

export interface SentinelCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SentinelUsage {
  kind: "token" | "catalog" | "statistics" | "process";
  /** Unités de traitement décomptées (en-tête x-processingunits-spent ; 0 si absent). */
  pu: number;
  ok: boolean;
}

export interface SentinelClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  tokenUrl?: string;
  /** Plafond d'unités de traitement par minute (le compte gratuit en permet 300). */
  puPerMinute?: number;
  /** Appelé après chaque requête facturable (catalogue, statistiques, rendu), réussie ou non. */
  onUsage?: (u: SentinelUsage) => void | Promise<void>;
  /** Appelé avant chaque requête facturable : lever une erreur l'empêche (budget). */
  beforeRequest?: () => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class SentinelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SentinelError";
  }
}

export interface Acquisition {
  date: string;
  cloudCover: number | null;
}

export interface IndexStatRow {
  date: string;
  index: VegetationIndex;
  mean: number | null;
  std: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Pixels valides dans la géométrie (sampleCount − noDataCount ; sampleCount couvre le rectangle englobant). */
  validPx: number;
}

const INDICES: VegetationIndex[] = ["ndvi", "ndre", "ndmi"];
const crsUrl = (epsg: number) => `http://www.opengis.net/def/crs/EPSG/0/${epsg}`;
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

type StatBand = { stats?: Record<string, unknown> & { percentiles?: Record<string, unknown> } };
type StatInterval = {
  interval: { from: string; to: string };
  outputs?: Record<string, { bands: Record<string, StatBand> }>;
  error?: unknown;
};

/**
 * Client Copernicus Data Space (Sentinel Hub) : jeton OAuth2
 * (client_credentials) mis en cache, catalogue, Statistical API et Process
 * API. Aucun état hors du jeton ; aucune dépendance à Fourmy hors des contrats.
 */
export class SentinelClient {
  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly spent: { at: number; pu: number }[] = [];

  constructor(
    private readonly creds: SentinelCredentials,
    private readonly opts: SentinelClientOptions = {},
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.baseUrl = (opts.baseUrl ?? CDSE_BASE_URL).replace(/\/+$/, "");
    this.tokenUrl = opts.tokenUrl ?? CDSE_TOKEN_URL;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  /** Jeton réutilisé jusqu'à une minute avant son expiration. */
  async token(force = false): Promise<string> {
    if (!force && this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const res = await this.fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.creds.clientId, client_secret: this.creds.clientSecret }),
    });
    if (!res.ok) {
      throw new SentinelError(res.status, res.status === 400 || res.status === 401 ? "Identifiants Copernicus refusés (client OAuth ou secret)." : `Jeton Copernicus indisponible (${res.status}).`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new SentinelError(502, "Réponse de jeton Copernicus inattendue.");
    this.cached = { token: body.access_token, expiresAt: this.now() + (body.expires_in ?? 600) * 1000 };
    return body.access_token;
  }

  /** Respecte le plafond de PU par minute en attendant que la fenêtre glisse. */
  private async throttle(): Promise<void> {
    const limit = this.opts.puPerMinute ?? 200;
    for (;;) {
      const cut = this.now() - 60_000;
      while (this.spent.length && this.spent[0]!.at <= cut) this.spent.shift();
      const used = this.spent.reduce((s, e) => s + e.pu, 0);
      if (used < limit || this.spent.length === 0) return;
      await this.sleep(this.spent[0]!.at - cut + 50);
    }
  }

  /** Requête facturable : budget, débit, jeton (renouvelé une fois sur 401), réessais sur 429 et 5xx. */
  private async call(kind: SentinelUsage["kind"], path: string, body: unknown, accept = "application/json"): Promise<Response> {
    await this.opts.beforeRequest?.();
    await this.throttle();
    let renewed = false;
    let forceToken = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(forceToken);
      forceToken = false;
      const res = await this.fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept },
        body: JSON.stringify(body),
      });
      const pu = num(res.headers.get("x-processingunits-spent")) ?? 0;
      if (res.status === 401 && !renewed) {
        renewed = true;
        forceToken = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = num(res.headers.get("retry-after"));
        await this.sleep(retryAfter !== null ? retryAfter * 1000 : 5_000 * (attempt + 1));
        continue;
      }
      this.spent.push({ at: this.now(), pu });
      await this.opts.onUsage?.({ kind, pu, ok: res.ok });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        throw new SentinelError(res.status, `Copernicus ${kind} : ${res.status}${text ? ` ${text}` : ""}`);
      }
      return res;
    }
  }

  /** Acquisitions Sentinel-2 L2A sur une emprise WGS84, une par jour (la moins nuageuse), triées. */
  async acquisitions(bbox: Bbox, from: string, to: string): Promise<Acquisition[]> {
    const byDate = new Map<string, number | null>();
    let next: number | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await this.call("catalog", "/api/v1/catalog/1.0.0/search", {
        collections: ["sentinel-2-l2a"],
        bbox,
        datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
        limit: 100,
        fields: { include: ["properties.datetime", "properties.eo:cloud_cover"], exclude: [] },
        ...(next !== undefined ? { next } : {}),
      }, "application/geo+json");
      const body = (await res.json()) as {
        features?: { properties?: { datetime?: string; "eo:cloud_cover"?: number } }[];
        context?: { next?: number };
      };
      for (const f of body.features ?? []) {
        const date = f.properties?.datetime?.slice(0, 10);
        if (!date) continue;
        const cc = num(f.properties?.["eo:cloud_cover"]);
        const prev = byDate.get(date);
        byDate.set(date, prev === undefined ? cc : prev === null ? cc : cc === null ? prev : Math.min(prev, cc));
      }
      next = body.context?.next;
      if (next === undefined) break;
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cloudCover]) => ({ date, cloudCover }));
  }

  private async statistics(geom: ProjectedGeometry, from: string, to: string, evalscript: string, percentiles: boolean, resolution = 10): Promise<{ data: StatInterval[]; pu: number }> {
    const res = await this.call("statistics", "/api/v1/statistics", {
      input: {
        bounds: { geometry: geom.geometry, properties: { crs: crsUrl(geom.epsg) } },
        data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 100 } }],
      },
      aggregation: {
        timeRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
        aggregationInterval: { of: "P1D", lastIntervalBehavior: "SHORTEN" },
        resx: resolution,
        resy: resolution,
        evalscript,
      },
      ...(percentiles ? { calculations: { idx: { statistics: { default: { percentiles: { k: [10, 50, 90] } } } } } } : {}),
    });
    const body = (await res.json()) as { data?: StatInterval[] };
    return { data: body.data ?? [], pu: num(res.headers.get("x-processingunits-spent")) ?? 0 };
  }

  /** Indices NDVI, NDRE et NDMI d'une géométrie projetée, une ligne par date et par indice. */
  async parcelStats(geom: ProjectedGeometry, from: string, to: string): Promise<{ rows: IndexStatRow[]; pu: number }> {
    const { data, pu } = await this.statistics(geom, from, to, INDICES_EVALSCRIPT, true);
    const rows: IndexStatRow[] = [];
    for (const item of data) {
      if (item.error || !item.outputs?.idx) continue;
      const date = item.interval.from.slice(0, 10);
      for (const index of INDICES) {
        const s = item.outputs.idx.bands[index]?.stats;
        if (!s) continue;
        const validPx = Math.max(0, (num(s.sampleCount) ?? 0) - (num(s.noDataCount) ?? 0));
        const pct = s.percentiles ?? {};
        const keep = (v: unknown) => (validPx > 0 ? num(v) : null);
        rows.push({
          date,
          index,
          mean: keep(s.mean),
          std: keep(s.stDev),
          p10: keep(pct["10.0"]),
          p50: keep(pct["50.0"]),
          p90: keep(pct["90.0"]),
          validPx,
        });
      }
    }
    return { rows, pu };
  }

  /**
   * Pixels sans nuage d'une géométrie projetée, par date, à rapporter à sa
   * surface / résolution². Copernicus facture le rectangle englobant : pour une
   * ferme aux parcelles dispersées, 60 m (au lieu de 10) divise le coût par 36
   * et suffit à estimer une part de nuages (le masque SCL est à 20 m).
   */
  async validPixels(geom: ProjectedGeometry, from: string, to: string, resolution = 60): Promise<{ rows: { date: string; validPx: number }[]; pu: number }> {
    const { data, pu } = await this.statistics(geom, from, to, VALIDITY_EVALSCRIPT, false, resolution);
    const rows = data
      .filter((item) => !item.error && item.outputs?.valid)
      .map((item) => {
        const s = Object.values(item.outputs!.valid!.bands)[0]?.stats ?? {};
        return { date: item.interval.from.slice(0, 10), validPx: Math.max(0, (num(s.sampleCount) ?? 0) - (num(s.noDataCount) ?? 0)) };
      });
    return { rows, pu };
  }

  /** PNG RGBA d'une géométrie WGS84 pour une date : NDVI colorié ou couleurs naturelles. L'image couvre le rectangle englobant. */
  async render(geometry: PolygonGeometry, date: string, kind: "ndvi" | "rgb", size: { width: number; height: number }): Promise<{ png: Uint8Array; pu: number }> {
    const res = await this.call(
      "process",
      "/api/v1/process",
      {
        input: {
          bounds: { geometry, properties: { crs: CRS84 } },
          data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }, mosaickingOrder: "leastCC" } }],
        },
        output: { width: size.width, height: size.height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
        evalscript: kind === "ndvi" ? NDVI_IMAGE_EVALSCRIPT : RGB_IMAGE_EVALSCRIPT,
      },
      "image/png",
    );
    return { png: new Uint8Array(await res.arrayBuffer()), pu: num(res.headers.get("x-processingunits-spent")) ?? 0 };
  }
}
