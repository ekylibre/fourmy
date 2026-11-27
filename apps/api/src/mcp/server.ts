import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_MODULE_LABELS, accessModules } from "@fourmy/contracts";
import { resolveFarmAccess, type Principal } from "../context.js";
import { API_KEY_PREFIX, getAuth, OAUTH_SCOPES, publicOrigin } from "../auth.js";
import { looksLikeJwt, verifyOAuthToken } from "../external/oauth.js";
import { db } from "../db.js";
import { FarmApi, ToolError, type Fetch, type McpFarm } from "./client.js";
import { fold } from "./format.js";
import { TOOLS, type ToolDef } from "./tools.js";

/**
 * Serveur MCP de Fourmy (lot AM6, conception_api_mcp.md §7.2) : Streamable
 * HTTP sans état, un serveur par requête. Accès par un jeton OAuth (audience
 * `/mcp` ou `/api/v1`) ou une clé d'API. Les outils proposés sont ceux des
 * modules ouverts sur au moins une ferme ; chaque outil appelle `/api/v1`.
 */

const VERSION = process.env.FOURMY_VERSION ?? "dev";

/** 401 avec l'adresse des métadonnées de la ressource (RFC 9728) : point de départ d'un client MCP. */
function challenge(error?: "invalid_token") {
  const meta = `${publicOrigin()}/.well-known/oauth-protected-resource/mcp`;
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Connexion à Fourmy requise." }, id: null }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${meta}", scope="${OAUTH_SCOPES.read}"${error ? `, error="${error}"` : ""}`,
    },
  });
}

/** Qui appelle : jeton OAuth ou clé d'API ; null sans identifiant valable. */
async function principalOf(headers: Headers): Promise<Principal | null | "invalid"> {
  const bearer = headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const key = headers.get("x-api-key") ?? (bearer?.startsWith(API_KEY_PREFIX) ? bearer : undefined);
  if (key) {
    const v = await getAuth().api.verifyApiKey({ body: { key } }).catch(() => null);
    return v?.valid && v.key ? { kind: "api_key", userId: v.key.referenceId, apiKeyId: v.key.id, accessId: null, clientId: null } : "invalid";
  }
  if (!bearer) return null;
  if (!looksLikeJwt(bearer)) return "invalid";
  const t = await verifyOAuthToken(bearer);
  return t ? { kind: "oauth", userId: t.userId, clientId: t.clientId, scopes: [...t.scopes], accessId: null } : "invalid";
}

/** Fermes ouvertes à ce principal, avec ses droits effectifs. */
async function farmsOf(principal: Principal): Promise<McpFarm[]> {
  const rows = await db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return (await tx.execute(sql`SELECT farm_id AS id, name FROM fourmy_user_farms(${principal.userId})`)) as unknown as { id: string; name: string }[];
  });
  const out: McpFarm[] = [];
  for (const f of rows) {
    const a = await resolveFarmAccess(f.id, principal);
    if (a.ok) out.push({ id: f.id, name: f.name, grant: a.grant });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, "fr"));
}

const opened = (f: McpFarm) => accessModules.filter((m) => f.grant.modules[m] === "read" || f.grant.modules[m] === "write");

/** Ferme visée par un outil : celle nommée, sinon la seule accessible. */
function pickFarm(farms: McpFarm[], ref: unknown): McpFarm {
  if (ref !== undefined && ref !== null && ref !== "") {
    const r = String(ref);
    const found = farms.filter((f) => f.id === r || fold(f.name) === fold(r));
    if (found.length === 1) return found[0]!;
    throw new ToolError(`Ferme « ${r} » introuvable parmi les fermes autorisées : ${farms.map((f) => f.name).join(", ")}.`);
  }
  if (farms.length === 1) return farms[0]!;
  throw new ToolError(`Plusieurs fermes autorisées (${farms.map((f) => f.name).join(", ")}) : précisez le paramètre « ferme ». L'outil fermes les liste.`);
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

function buildServer(fetch: Fetch, credentials: Headers, farms: McpFarm[]) {
  const server = new McpServer(
    { name: "fourmy", title: "Fourmy", version: VERSION },
    {
      instructions:
        "Fourmy est un logiciel de gestion d'exploitation agricole. Ces outils consultent, en lecture seule, les fermes que l'utilisateur a autorisées : " +
        "parcelles, interventions, assolement, stocks, matériels, registres et contrôles. Les surfaces sont en hectares, les dates en heure de Paris. " +
        "Avec plusieurs fermes, l'outil fermes les liste et le paramètre « ferme » choisit la ferme.",
    },
  );
  const ferme = z.string().optional().describe("Nom ou identifiant de la ferme ; facultatif s'il n'y en a qu'une.");

  server.registerTool(
    "fermes",
    {
      title: "Fermes",
      description: "Fermes accessibles avec cette connexion, et ce que chacune ouvre (modules, activités).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const data = farms.map((f) => ({
        id: f.id,
        nom: f.name,
        modules: opened(f).map((m) => ACCESS_MODULE_LABELS[m]),
        activites: f.grant.activities === "all" ? "toutes" : `${f.grant.activities.length} activité(s)`,
      }));
      return { ...text(`${farms.length} ferme(s) : ${farms.map((f) => f.name).join(", ")}.\n\n${JSON.stringify(data, null, 1)}`), structuredContent: { fermes: data } };
    },
  );

  const available = (t: ToolDef) => farms.some((f) => opened(f).includes(t.module));
  for (const tool of TOOLS.filter(available)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${tool.description} Module : ${ACCESS_MODULE_LABELS[tool.module]}.`,
        inputSchema: { ...tool.input, ferme },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const farm = pickFarm(farms, args.ferme);
          if (!opened(farm).includes(tool.module)) {
            throw new ToolError(`Cet accès n'ouvre pas le module « ${ACCESS_MODULE_LABELS[tool.module]} » sur la ferme ${farm.name}.`);
          }
          const r = await tool.run(new FarmApi(fetch, credentials, tool.name, farm), args);
          const head = farms.length > 1 ? `[${farm.name}] ` : "";
          return { ...text(`${head}${r.summary}\n\n${JSON.stringify(r.data, null, 1)}`), structuredContent: { ferme: farm.name, ...r.data } };
        } catch (e) {
          if (e instanceof ToolError) return text(e.message, true);
          console.error(`[mcp] ${tool.name} :`, e);
          return text("Erreur interne de Fourmy.", true);
        }
      },
    );
  }
  return server;
}

/** Point `/mcp` : `fetch` est celui de l'application (appels internes des outils). */
export function mcpHandler(fetch: Fetch) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      // Sans état : ni flux d'événements (GET) ni session à fermer (DELETE).
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Méthode non prise en charge : POST seulement." }, id: null }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "POST" },
      });
    }
    const principal = await principalOf(request.headers);
    if (!principal) return challenge();
    if (principal === "invalid") return challenge("invalid_token");
    const farms = await farmsOf(principal);
    // Identifiants transmis tels quels aux appels internes.
    const credentials = new Headers();
    for (const h of ["authorization", "x-api-key"]) if (request.headers.get(h)) credentials.set(h, request.headers.get(h)!);
    const server = buildServer(fetch, credentials, farms);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
}
