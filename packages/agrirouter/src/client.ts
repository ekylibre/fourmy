/**
 * Client agrirouter, API G4 (REST, https://agrirouter.com/en/docs ;
 * spécification : https://agrirouter.com/api/openapi.yaml). L'application
 * s'authentifie par client_credentials ; chaque ferme (tenant) l'autorise par
 * un consentement dans agrirouter, qui renvoie son `tenant_id`. Les appels
 * propres à une ferme portent l'en-tête `x-agrirouter-tenant-id`.
 */

export const AGRIROUTER_URLS = {
  production: { api: "https://api.agrirouter.com", authorize: "https://app.agrirouter.com/api/authorize" },
  // QA : réservée à l'équipe agrirouter (on développe sur la production, avec l'IO-Tool).
  qa: { api: "https://api.qa.agrirouter.farm", authorize: "https://app.qa.agrirouter.farm/api/authorize" },
} as const;
export type AgrirouterEnvironment = keyof typeof AGRIROUTER_URLS;

/** Types de message (technical message types) utilisés par Fourmy. */
export const MESSAGE_TYPES = {
  taskdata: "iso:11783:-10:taskdata:zip",
  shape: "shp:shape:zip",
  timeLog: "iso:11783:-10:time_log:protobuf",
  deviceDescription: "iso:11783:-10:device_description:protobuf",
} as const;

export interface AgrirouterApp {
  clientId: string;
  clientSecret: string;
  applicationId: string;
  softwareVersionId: string;
  environment: AgrirouterEnvironment;
  /** Surcharges des adresses (environnement de test, simulation). */
  apiUrl?: string;
  authorizeUrl?: string;
}

export interface AgrirouterOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class AgrirouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgrirouterError";
  }
}

export type EndpointCapability = { message_type: string; direction: "SEND" | "RECEIVE" | "SEND_RECEIVE" };

export interface TenantEndpoint {
  id: string;
  external_id?: string;
  name: string;
  endpoint_type: string;
  application_id: string;
  tenant_id: string;
  owned_by_your_application: boolean;
  capabilities: { can_send: string[]; can_receive: string[] };
  routed_endpoints?: { can_send_to?: Record<string, string[]>; can_receive_from?: Record<string, string[]> };
}

export interface TenantInfo {
  tenant_id: string;
  company_name?: string;
  state?: string;
  endpoints: TenantEndpoint[];
}

export interface Endpoint {
  id: string;
  external_id: string;
  endpoint_type: string;
  tenant_id: string;
  capabilities: EndpointCapability[];
}

export class AgrirouterClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly api: string;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    readonly app: AgrirouterApp,
    opts: AgrirouterOptions = {},
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.api = (app.apiUrl ?? AGRIROUTER_URLS[app.environment].api).replace(/\/+$/, "");
  }

  /**
   * Adresse du consentement : la ferme se connecte à agrirouter et autorise
   * Fourmy ; agrirouter revient sur `redirectUri` avec `state` et `tenant_id`
   * (ou `error=access_denied`).
   */
  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ client_id: this.app.clientId, scope: "endpoints:manage", state, redirect_uri: redirectUri });
    return `${this.app.authorizeUrl ?? AGRIROUTER_URLS[this.app.environment].authorize}?${q}`;
  }

  /** Jeton d'application (client_credentials), réutilisé jusqu'à une minute avant son expiration ; pas de jeton de rafraîchissement. */
  async token(force = false): Promise<string> {
    if (!force && this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;
    const res = await this.fetch(`${this.api}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.app.clientId, client_secret: this.app.clientSecret }),
    });
    if (!res.ok) {
      throw new AgrirouterError(res.status, res.status === 400 || res.status === 401 ? "Identifiants de l'application agrirouter refusés." : `Jeton agrirouter indisponible (${res.status}).`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new AgrirouterError(502, "Réponse de jeton agrirouter inattendue.");
    this.cached = { token: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  /**
   * Appel authentifié : jeton renouvelé une fois sur 401, réessais avec
   * attente croissante sur 429 et 5xx (agrirouter n'envoie pas de Retry-After).
   */
  private async call(method: string, path: string, opts: { tenantId?: string; json?: unknown; body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    let renewed = false;
    let force = false;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { authorization: `Bearer ${await this.token(force)}`, ...opts.headers };
      force = false;
      if (opts.tenantId) headers["x-agrirouter-tenant-id"] = opts.tenantId;
      let body: string | Uint8Array | undefined;
      if (opts.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(opts.json);
      } else if (opts.body) {
        headers["content-type"] = "application/octet-stream";
        body = opts.body;
      }
      const res = await this.fetch(`${this.api}${path}`, { method, headers, body });
      if (res.status === 401 && !renewed) {
        renewed = true;
        force = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        const message = await res
          .json()
          .then((b) => (b as { message?: string }).message ?? "")
          .catch(() => "");
        throw new AgrirouterError(res.status, `agrirouter ${method} ${path.split("?")[0]} : ${res.status}${message ? ` ${message}` : ""}`);
      }
      return res;
    }
  }

  /** Fermes (tenants) qui ont autorisé l'application, avec l'état passé au consentement. */
  async tenants(): Promise<TenantInfo[]> {
    const res = await this.call("GET", "/tenants");
    return ((await res.json()) as { tenants?: TenantInfo[] }).tenants ?? [];
  }

  /** Points de terminaison visibles dans une ferme (ceux des autres applications : dès que Fourmy y a le sien). */
  async tenantEndpoints(tenantId: string): Promise<{ companyName: string | null; endpoints: TenantEndpoint[] }> {
    const res = await this.call("GET", `/tenants/${encodeURIComponent(tenantId)}/endpoints`, { tenantId });
    const body = (await res.json()) as { company_name?: string; endpoints?: TenantEndpoint[] };
    return { companyName: body.company_name ?? null, endpoints: body.endpoints ?? [] };
  }

  /** Crée ou met à jour un point de terminaison ; chaque appel remplace toutes ses capacités et abonnements. */
  async putEndpoint(
    tenantId: string,
    externalId: string,
    e: {
      name: string;
      endpointType: "cloud_software" | "virtual_communication_unit";
      capabilities: EndpointCapability[];
      subscriptions: string[];
      /** L'utilisateur peut supprimer le point de terminaison dans agrirouter (Fourmy doit alors le constater). */
      allowDeleteByUser?: boolean;
    },
  ): Promise<Endpoint> {
    const res = await this.call("PUT", `/endpoints/${encodeURIComponent(externalId)}`, {
      tenantId,
      json: {
        name: e.name,
        application_id: this.app.applicationId,
        software_version_id: this.app.softwareVersionId,
        endpoint_type: e.endpointType,
        capabilities: e.capabilities,
        subscriptions: e.subscriptions.map((message_type) => ({ message_type })),
        ...(e.allowDeleteByUser !== undefined ? { allow_delete_by_user: e.allowDeleteByUser } : {}),
      },
    });
    return (await res.json()) as Endpoint;
  }

  async deleteEndpoint(tenantId: string, externalId: string): Promise<void> {
    try {
      await this.call("DELETE", `/endpoints/${encodeURIComponent(externalId)}`, { tenantId });
    } catch (e) {
      if (!(e instanceof AgrirouterError && e.status === 404)) throw e;
    }
  }

  /**
   * Retire l'autorisation de l'application pour ce compte agrirouter, à faire
   * après la suppression de ses points de terminaison. Renvoie `false` sans
   * erreur si l'autorisation est gardée : 409, l'application a encore un point
   * de terminaison dans ce compte (une autre ferme Fourmy y est reliée), ou
   * 404, il n'y a plus d'autorisation.
   */
  async revoke(tenantId: string): Promise<boolean> {
    try {
      await this.call("DELETE", "/authorizations", { tenantId });
      return true;
    } catch (e) {
      if (e instanceof AgrirouterError && (e.status === 409 || e.status === 404)) return false;
      throw e;
    }
  }

  /**
   * Envoie un fichier à des destinataires choisis (envoi direct). 200 veut dire
   * « accepté pour routage », pas « livré ». agrirouter découpe lui-même les
   * gros fichiers (256 Mo au plus).
   */
  async sendFile(
    tenantId: string,
    m: { senderEndpointId: string; messageType: string; recipients: string[]; filename: string; payload: Uint8Array; sentAt?: Date },
  ): Promise<void> {
    if (m.payload.byteLength > 256 * 1024 * 1024) throw new AgrirouterError(413, "Fichier trop gros pour agrirouter (256 Mo au plus).");
    await this.call("POST", "/messages", {
      tenantId,
      body: m.payload,
      headers: {
        "content-length": String(m.payload.byteLength),
        "x-agrirouter-is-publish": "false",
        "x-agrirouter-direct-recipients": m.recipients.join(","),
        "x-agrirouter-sent-timestamp": (m.sentAt ?? new Date(this.now())).toISOString(),
        "x-agrirouter-endpoint-id": m.senderEndpointId,
        "x-agrirouter-message-type": m.messageType,
        "x-agrirouter-filename": m.filename.slice(0, 100),
      },
    });
  }
}
