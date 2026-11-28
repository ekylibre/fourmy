import { z } from "zod";
import { ACCESS_MODULE_LABELS, accessModules } from "@fourmy/contracts";
import * as R from "@fourmy/contracts/responses";
import { OAUTH_SCOPES, publicOrigin } from "../auth.js";
import { OPEN_ROUTES, type OpenRoute } from "./routes.js";
import { RATE_LIMITS } from "./audit.js";

/**
 * Document OpenAPI 3.1 de l'API ouverte (lot AM7, conception_api_mcp.md §6.3),
 * servi sur `GET /api/v1/openapi.json`. Généré à partir de la liste des routes
 * ouvertes : une route documentée est une route réellement accessible avec une
 * clé ou un jeton, et seulement celles-là.
 */

type Json = Record<string, unknown>;

/** Nom de composant de chaque schéma de réponse (l'export de @fourmy/contracts/responses). */
const NAMES = new Map<unknown, string>(Object.entries(R).map(([name, schema]) => [schema, name.replace(/Response$/, "")]));

/** Schéma JSON (2020-12, celui d'OpenAPI 3.1) d'un schéma zod, sans l'en-tête `$schema`. */
function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): Json {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  return rest;
}

const problem: Json = {
  type: "object",
  description: "Erreur au format RFC 9457 (application/problem+json).",
  properties: { type: { type: "string" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" } },
  required: ["title", "status"],
};

const errorResponses = {
  "400": { $ref: "#/components/responses/BadRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "429": { $ref: "#/components/responses/TooManyRequests" },
};

/** Paramètres de chemin : `:id` devient `{id}`. */
function pathParams(path: string): Json[] {
  return [...path.matchAll(/:([a-zA-Z]+)/g)].map(([, name]) => {
    const schema =
      name === "year"
        ? { type: "integer", description: "Campagne (année)" }
        : name === "kind"
          ? { type: "string", enum: ["hve", "ab"] }
          : name === "layer" || name === "z" || name === "x" || name === "y"
            ? { type: "string" }
            : { type: "string", format: "uuid" };
    return { name, in: "path", required: true, schema };
  });
}

/** Formats autres que JSON proposés par `?format=`. */
const OTHER_FORMATS: Record<string, string> = { csv: "text/csv", pdf: "text/html" };

function operation(r: OpenRoute): Json {
  const name = r.response ? NAMES.get(r.response) : undefined;
  if (r.response && !name) throw new Error(`Schéma de réponse sans nom pour ${r.path}`);
  const formats = r.query.find((p) => p.name === "format");
  const content: Json = r.binary
    ? { [r.binary]: { schema: { type: "string", format: "binary" } } }
    : { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } };
  if (formats) {
    for (const f of (jsonSchema(formats.schema, "input").enum as string[]) ?? []) {
      if (OTHER_FORMATS[f]) content[OTHER_FORMATS[f]] = { schema: { type: "string" } };
    }
  }
  return {
    operationId: name ?? r.path.replace(/[^a-zA-Z]+/g, "_").replace(/^_|_$/g, ""),
    summary: r.summary,
    tags: [r.module],
    "x-fourmy-module": r.module,
    "x-fourmy-level": "read",
    parameters: [
      { $ref: "#/components/parameters/farmId" },
      ...pathParams(r.path),
      ...r.query.map((p) => ({ name: p.name, in: "query", required: p.required, description: p.description, schema: jsonSchema(p.schema, "input") })),
    ],
    responses: {
      "200": { description: r.summary, content },
      ...errorResponses,
    },
  };
}

function build(): Json {
  const origin = publicOrigin();
  const paths: Json = {};
  const schemas: Json = { Problem: problem };
  for (const r of OPEN_ROUTES) {
    const path = `/farms/{farmId}${r.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`;
    paths[path] = { get: operation(r) };
    const name = r.response ? NAMES.get(r.response) : undefined;
    if (r.response && name && !schemas[name]) schemas[name] = jsonSchema(r.response);
  }
  const problemResponse = (description: string) => ({ description, content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } });
  return {
    openapi: "3.1.0",
    info: {
      title: "API Fourmy",
      version: process.env.FOURMY_VERSION ?? "dev",
      description: [
        "API de lecture des fermes Fourmy, ouverte aux clés d'API et aux applications autorisées par OAuth.",
        "",
        "Chaque accès est lié à une ferme : il ouvre une liste de modules, en lecture, et éventuellement un périmètre d'activités. " +
          "Une route d'un module fermé répond 403 ; une route qui n'est pas dans ce document répond 404.",
        "Les données hors du périmètre d'activités sont absentes des réponses ; une intervention partagée avec une autre activité est ramenée au prorata de sa surface.",
        "",
        `Débit : ${RATE_LIMITS.perMinute} requêtes par minute et ${RATE_LIMITS.perDay.toLocaleString("fr-FR")} par jour et par accès ; au-delà, 429 avec l'en-tête Retry-After.`,
        "Surfaces en m² (`areaM2`), dates en ISO 8601, montants en euros hors taxes.",
      ].join("\n"),
      license: { name: "AGPL-3.0", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ apiKey: [] }, { oauth2: [OAUTH_SCOPES.read] }],
    tags: accessModules.map((m) => ({ name: m, description: ACCESS_MODULE_LABELS[m] })),
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: "Clé d'API créée par le responsable de la ferme (Réglages → Accès externes). Elle commence par fmy_ ; elle peut aussi passer par Authorization: Bearer.",
        },
        oauth2: {
          type: "oauth2",
          description:
            "Application autorisée par un utilisateur, avec PKCE. Demander la ressource " +
            `${origin}/api/v1 (paramètre resource) pour recevoir un jeton JWT ; la ferme choisie à l'autorisation est dans la revendication fourmy_farm.`,
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/api/auth/oauth2/authorize`,
              tokenUrl: `${origin}/api/auth/oauth2/token`,
              refreshUrl: `${origin}/api/auth/oauth2/token`,
              scopes: { [OAUTH_SCOPES.read]: "Lire les modules ouverts de la ferme", offline_access: "Jeton de rafraîchissement" },
            },
          },
        },
      },
      parameters: {
        farmId: { name: "farmId", in: "path", required: true, description: "Identifiant de la ferme de l'accès", schema: { type: "string", format: "uuid" } },
      },
      responses: {
        BadRequest: problemResponse("Paramètre invalide"),
        Unauthorized: problemResponse("Clé ou jeton absent, invalide, expiré ou révoqué"),
        Forbidden: problemResponse("Ferme non couverte par l'accès, ou module non ouvert"),
        NotFound: problemResponse("Élément introuvable, ou route non ouverte aux accès externes"),
        TooManyRequests: problemResponse("Débit dépassé : réessayer après Retry-After secondes"),
      },
      schemas,
    },
  };
}

let cached: Json | null = null;

/** Document OpenAPI (calculé une fois par processus). */
export function openApiDocument(): Json {
  return (cached ??= build());
}
