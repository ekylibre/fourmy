import type { TraccarDevice, TraccarPosition } from "./parse.js";

/**
 * Client HTTP Traccar en lecture. Authentification par jeton (Bearer) ou, en
 * repli, HTTP Basic (ce qu'utilisait Ekylibre). Les identifiants viennent de
 * l'environnement, jamais du dépôt.
 */
export type TraccarAuth = { token: string } | { user: string; password: string };

export class TraccarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class TraccarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly auth: TraccarAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Construit le client depuis l'environnement (TRACCAR_URL, TRACCAR_TOKEN ou BASIC). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): TraccarClient {
    const url = env.TRACCAR_URL;
    if (!url) throw new TraccarError("TRACCAR_URL manquant");
    if (env.TRACCAR_TOKEN) return new TraccarClient(url, { token: env.TRACCAR_TOKEN });
    if (env.TRACCAR_BASIC_USER && env.TRACCAR_BASIC_PASSWORD) {
      return new TraccarClient(url, { user: env.TRACCAR_BASIC_USER, password: env.TRACCAR_BASIC_PASSWORD });
    }
    throw new TraccarError("TRACCAR_TOKEN ou TRACCAR_BASIC_USER/TRACCAR_BASIC_PASSWORD manquant");
  }

  private headers(): Record<string, string> {
    const authorization =
      "token" in this.auth
        ? `Bearer ${this.auth.token}`
        : `Basic ${Buffer.from(`${this.auth.user}:${this.auth.password}`).toString("base64")}`;
    return { authorization, accept: "application/json" };
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          headers: this.headers(),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 401 || res.status === 403) {
          throw new TraccarError(`Traccar refuse l'accès (${res.status}) à ${url.pathname}`, res.status);
        }
        if (!res.ok) throw new TraccarError(`Traccar ${res.status} sur ${url.pathname}`, res.status);
        return (await res.json()) as T;
      } catch (e) {
        lastError = e;
        if (e instanceof TraccarError && (e.status === 401 || e.status === 403)) throw e;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  devices(): Promise<TraccarDevice[]> {
    return this.get<TraccarDevice[]>("api/devices");
  }

  positions(deviceId: number, from: Date, to: Date): Promise<TraccarPosition[]> {
    return this.get<TraccarPosition[]>("api/positions", {
      deviceId: String(deviceId),
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
}
