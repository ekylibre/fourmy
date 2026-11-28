import type { AccessModule } from "@fourmy/contracts";
import type { EffectiveGrant } from "@fourmy/domain";
import { MCP_CALL_HEADER, mcpCallHeader } from "../external/audit.js";

/**
 * Appels internes d'un outil MCP (conception_api_mcp.md §7.2) : l'outil est
 * un client de `/api/v1`, avec le jeton ou la clé de l'appelant. Droits, RLS,
 * périmètre d'activités, prorata, débit et journal s'appliquent donc sans
 * rien réécrire.
 */

export type Fetch = (request: Request) => Promise<Response>;

/** Erreur montrée telle quelle à l'assistant. */
export class ToolError extends Error {}

export type McpFarm = { id: string; name: string; grant: EffectiveGrant };

export class FarmApi {
  private cache = new Map<string, Promise<unknown>>();
  private primaryDone = false;

  constructor(
    private readonly fetch: Fetch,
    private readonly credentials: Headers,
    private readonly tool: string,
    readonly farm: McpFarm,
  ) {}

  /** Le module est-il ouvert sur cette ferme ? */
  allows(module: AccessModule) {
    const l = this.farm.grant.modules[module];
    return l === "read" || l === "write";
  }

  /** Écriture de l'appel principal (dépôt d'une proposition, lot AM8) : comptée et journalisée sous le nom de l'outil. */
  post<T>(path: string, body: unknown): Promise<T> {
    const primary = !this.primaryDone;
    this.primaryDone = true;
    return this.call<T>(path, primary, body);
  }

  /** GET de l'appel principal d'un outil : compté et journalisé sous le nom de l'outil (une fois par appel). */
  get<T>(path: string): Promise<T> {
    const primary = !this.primaryDone;
    this.primaryDone = true;
    return this.call<T>(path, primary);
  }

  private async call<T>(path: string, primary: boolean, body?: unknown): Promise<T> {
    const headers = new Headers(this.credentials);
    headers.set(MCP_CALL_HEADER, mcpCallHeader(this.tool, primary));
    if (body !== undefined) headers.set("content-type", "application/json");
    const init: RequestInit = body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) };
    const res = await this.fetch(new Request(`http://fourmy.internal/api/v1/farms/${this.farm.id}${path}`, init));
    if (res.ok) return (await res.json()) as T;
    const problem = (await res.json().catch(() => null)) as { detail?: string; title?: string } | null;
    if (res.status === 429) throw new ToolError(`Trop d'appels : ${problem?.detail ?? "réessayez dans une minute."}`);
    if (res.status === 404) throw new ToolError(problem?.detail && problem.detail !== "Not Found" ? problem.detail : "Introuvable.");
    if (res.status === 400 || res.status === 422) throw new ToolError(`Refusé par Fourmy : ${problem?.detail ?? problem?.title ?? "contenu invalide"}`);
    throw new ToolError(problem?.detail ?? problem?.title ?? `Erreur ${res.status}.`);
  }

  /** Libellés (noms de parcelles, d'articles…) : relus une fois par appel d'outil, vides si le module est fermé. */
  lookup<T>(module: AccessModule, path: string, map: (data: never) => T, empty: T, key = path): Promise<T> {
    if (!this.allows(module)) return Promise.resolve(empty);
    if (!this.cache.has(key)) this.cache.set(key, this.call<never>(path, false).then(map, () => empty));
    return this.cache.get(key) as Promise<T>;
  }

  /** Liste secondaire (référentiel) : vide si le module est fermé. */
  lookupList<T>(module: AccessModule, path: string): Promise<{ items: T[] }> {
    return this.lookup(module, path, (d: { items: T[] }) => d, { items: [] as T[] }, `liste ${path}`);
  }

  parcelNames() {
    return this.lookup("parcels", "/land-parcels/names", (d: { items: { id: string; name: string }[] }) => new Map(d.items.map((p) => [p.id, p.name])), new Map<string, string>());
  }
  activities(year = new Date().getFullYear()) {
    type A = { id: string; name: string; cultivationLabel: string | null; family: string; parcelIds: string[]; areaM2: number; suspended: boolean };
    return this.lookup("activities", `/activities?year=${year}`, (d: { items: A[] }) => d.items, [] as A[]);
  }
  articleNames() {
    return this.lookup("stocks", "/articles", (d: { items: { id: string; name: string }[] }) => new Map(d.items.map((a) => [a.id, a.name])), new Map<string, string>());
  }
  equipmentNames() {
    return this.lookup("equipments", "/equipments", (d: { items: { id: string; name: string }[] }) => new Map(d.items.map((e) => [e.id, e.name])), new Map<string, string>());
  }
  procedureLabels() {
    return this.lookup("interventions", "/procedures", (d: { items: { code: string; label: string }[] }) => new Map(d.items.map((p) => [p.code, p.label])), new Map<string, string>());
  }
}
