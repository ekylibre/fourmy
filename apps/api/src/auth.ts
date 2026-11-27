import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { jwt } from "better-auth/plugins/jwt";
import { apiKey } from "@better-auth/api-key";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import pg from "pg";

/**
 * Authentification (ADR-14) : better-auth, comptes locaux e-mail + mot de
 * passe. Le web utilise le cookie de session (même origine) ; le mobile
 * (zero-mobile) l'en-tête `Authorization: Bearer <jeton signé>` renvoyé dans
 * `set-auth-token` à la connexion. Plus tard : OIDC vers le SSO commun (SaaS).
 *
 * Inscription libre désactivée par défaut : en auto-hébergé, les comptes sont
 * créés par l'administrateur (`pnpm --filter @fourmy/api user:create`) puis
 * rattachés à une ferme par son responsable. `FOURMY_ALLOW_SIGNUP=true` l'ouvre.
 */

/**
 * Environnement local (développement, tests, CI) : base sur la machine même et
 * pas en production. Seul cas où un secret de développement et les origines
 * du serveur Vite sont acceptés — un déploiement qui oublie NODE_ENV mais
 * vise une base distante exige donc un vrai secret.
 */
function isLocalDev(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.DATABASE_URL ?? "").hostname);
  } catch {
    return false;
  }
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (!isLocalDev()) throw new Error("BETTER_AUTH_SECRET (32 caractères au moins) est requis hors développement local.");
  return "fourmy-developpement-local-uniquement-jamais-en-production";
}

/**
 * Origines autorisées : le web (`FOURMY_TRUSTED_ORIGINS`), l'application
 * mobile (son schéma d'URL, envoyé en `Origin` par zero-mobile — un navigateur
 * n'émet jamais une telle origine pour une page web) et, en local, Vite.
 */
function trustedOrigins(): string[] {
  const list = (v: string | undefined) => (v ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const configured = list(process.env.FOURMY_TRUSTED_ORIGINS);
  const mobile = list(process.env.FOURMY_MOBILE_ORIGINS ?? "zeromobile://");
  return [...configured, ...mobile, ...(isLocalDev() ? ["http://localhost:5173", "http://localhost:4173"] : [])];
}

const snake = <K extends string>(...keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)])) as Record<K, string>;

/** Champs d'un plugin en snake_case (majuscules consécutives comprises : requirePKCE → require_pkce). */
const snakeFields = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(fields).map((f) => [f, f.replace(/([a-z0-9])([A-Z]+)/g, (_m, a: string, b: string) => `${a}_${b.toLowerCase()}`)]));

/**
 * Clés d'API (lot AM4, claudedocs/essai_api_mcp.md §1) : préfixe `fmy_`,
 * seul le haché est stocké ; ferme et droits dans `farm_accesses`. La limite
 * de débit du plugin (10 requêtes par jour par défaut) est coupée : l'API
 * compte elle-même par accès (external/rate-limit.ts).
 */
export const API_KEY_PREFIX = "fmy_";
function apiKeys() {
  const options = { defaultPrefix: API_KEY_PREFIX, enableMetadata: true, apiKeyHeaders: ["x-api-key"], rateLimit: { enabled: false } };
  const probe = apiKey(options);
  const schema = { apikey: { modelName: "auth_api_keys", fields: snakeFields(probe.schema.apikey.fields) } };
  return apiKey({ ...options, schema } as typeof options);
}

/**
 * Adresse publique de Fourmy (web et API sur la même origine, docker/nginx.conf).
 * L'émetteur des jetons OAuth et les ressources protégées en dépendent.
 */
export function publicOrigin(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
/** Ressources protégées (RFC 8707) : le serveur MCP (AM6) et l'API REST. */
export const mcpResource = () => `${publicOrigin()}/mcp`;
export const apiResource = () => `${publicOrigin()}/api/v1`;
export const oauthIssuer = () => `${publicOrigin()}/api/auth`;
export const OAUTH_SCOPES = { read: "fourmy:read", write: "fourmy:write" } as const;

/** Tables des plugins OAuth, à nos noms (claudedocs/essai_api_mcp.md §1). */
const OAUTH_TABLES: Record<string, string> = {
  jwks: "auth_jwks",
  oauthClient: "auth_oauth_clients",
  oauthResource: "auth_oauth_resources",
  oauthClientResource: "auth_oauth_client_resources",
  oauthRefreshToken: "auth_oauth_refresh_tokens",
  oauthAccessToken: "auth_oauth_access_tokens",
  oauthConsent: "auth_oauth_consents",
  oauthClientAssertion: "auth_oauth_client_assertions",
};
type PluginWithSchema = { schema?: Record<string, { fields: Record<string, unknown> }> };
function tables(plugin: PluginWithSchema) {
  const out: Record<string, { modelName: string; fields: Record<string, string> }> = {};
  for (const [model, t] of Object.entries(plugin.schema ?? {})) {
    const modelName = OAUTH_TABLES[model];
    if (modelName) out[model] = { modelName, fields: snakeFields(t.fields) };
  }
  return out;
}

/**
 * Serveur d'autorisation OAuth (lot AM5, conception_api_mcp.md §7.1) :
 * code avec PKCE, rafraîchissement, enregistrement dynamique et CIMD. Les
 * scopes restent grossiers (lecture, écriture) ; la ferme se choisit après la
 * connexion (`/oauth/ferme`, étape postLogin) et devient la référence du
 * consentement ; modules et activités se choisissent au consentement
 * (`/oauth/consentement`) et vivent dans `farm_accesses`.
 */
function oauthPlugins() {
  const options = {
    loginPage: "/login",
    consentPage: "/oauth/consentement",
    resource: mcpResource(),
    resources: [{ identifier: apiResource(), name: "API Fourmy" }],
    clientRegistrationDefaultResources: [apiResource()],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    scopes: ["openid", "profile", "email", "offline_access", OAUTH_SCOPES.read, OAUTH_SCOPES.write],
    // Un client enregistré n'obtient que ce qu'il demande, lecture par défaut (essai AM0 §2).
    clientRegistrationDefaultScopes: [OAUTH_SCOPES.read, "offline_access"],
    clientRegistrationAllowedScopes: [OAUTH_SCOPES.read, OAUTH_SCOPES.write, "offline_access", "openid", "profile", "email"],
    accessTokenExpiresIn: 3600,
    postLogin: {
      page: "/oauth/ferme",
      consentReferenceId: ({ session }: { session: Record<string, unknown> }) => (session.activeFarmId as string | null | undefined) ?? undefined,
      // La ferme se choisit à chaque autorisation (une autre ferme = un autre consentement).
      shouldRedirect: ({ session, isContinuation }: { session: Record<string, unknown>; isContinuation: boolean }) => !isContinuation || !session.activeFarmId,
    },
    customAccessTokenClaims: ({ referenceId }: { referenceId?: string }) => ({ fourmy_farm: referenceId ?? null }),
  };
  const jwtProbe = jwt() as PluginWithSchema;
  const mcpProbe = mcp(options as never) as unknown as PluginWithSchema;
  return [
    jwt({ schema: tables(jwtProbe), jwt: { issuer: oauthIssuer() }, disableSettingJwtHeader: true } as never),
    mcp({ ...options, schema: tables(mcpProbe) } as never),
    // CIMD : Fourmy lit le document du client ; HTTPS, adresses publiques seulement, sans suivre de redirection.
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" } as never),
  ];
}

function options() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");
  return {
    appName: "Fourmy",
    basePath: "/api/auth",
    baseURL: publicOrigin(),
    secret: secret(),
    database: new pg.Pool({ connectionString: url, max: 5 }),
    // Tables et colonnes Fourmy (snake_case, identifiants UUID générés par Postgres).
    user: { modelName: "users", fields: snake("emailVerified", "createdAt", "updatedAt") },
    session: {
      modelName: "auth_sessions",
      fields: snake("userId", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt"),
      // Ferme choisie pendant une autorisation OAuth (référence du consentement, lot AM5).
      additionalFields: { activeFarmId: { type: "string", required: false, input: false, fieldName: "active_farm_id" } },
    },
    account: {
      modelName: "auth_accounts",
      fields: snake(
        "userId",
        "accountId",
        "providerId",
        "accessToken",
        "refreshToken",
        "idToken",
        "accessTokenExpiresAt",
        "refreshTokenExpiresAt",
        "createdAt",
        "updatedAt",
      ),
    },
    verification: { modelName: "auth_verifications", fields: snake("expiresAt", "createdAt", "updatedAt") },
    // Contrôle d'origine (CSRF) actif partout, tests compris : better-auth le
    // désactive par défaut sous NODE_ENV=test, les tests ne verraient pas sa règle.
    advanced: { database: { generateId: "uuid" }, disableOriginCheck: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.FOURMY_ALLOW_SIGNUP !== "true",
      minPasswordLength: 10,
    },
    trustedOrigins: trustedOrigins(),
    plugins: [bearer({ requireSignature: true }), apiKeys(), ...oauthPlugins()],
    // Une clé refusée (fausse, expirée, désactivée) est un cas attendu : pas d'erreur au journal.
    logger: {
      log: (level, message, ...args) => {
        if (/API key/i.test(message) && level === "error") return;
        (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[better-auth] ${message}`, ...args);
      },
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

/** Options complètes (génération du SQL des plugins : `getMigrations`). */
export const authOptionsForMigration = (): BetterAuthOptions => options();

function create() {
  return betterAuth(options());
}

/** Clé telle que le plugin la renvoie (création, vérification). */
export type ApiKeyRecord = { id: string; referenceId: string; start: string | null; expiresAt: Date | string | null; enabled: boolean | null };

/**
 * Ce que l'API utilise de better-auth. Type écrit à la main : le type inféré
 * avec les plugins dépasse ce que le compilateur sait écrire dans les
 * déclarations (TS7056).
 */
export type FourmyAuth = {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession(args: { headers: Headers }): Promise<{ user: { id: string; email: string; name: string | null }; session: { id: string; activeFarmId?: string | null } } | null>;
    getJwks(): Promise<{ keys: Record<string, unknown>[] }>;
    verifyApiKey(args: { body: { key: string } }): Promise<{ valid: boolean; key: ApiKeyRecord | null }>;
    createApiKey(args: { body: { userId: string; name: string; expiresIn?: number | null; metadata?: Record<string, unknown> } }): Promise<ApiKeyRecord & { key: string }>;
  };
};

let instance: FourmyAuth | null = null;

/** Instance unique, créée au premier usage (les tests sans base n'en ont pas besoin). */
export function getAuth(): FourmyAuth {
  instance ??= create() as unknown as FourmyAuth;
  return instance;
}
