import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { apiKey } from "@better-auth/api-key";
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

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");
  return betterAuth({
    appName: "Fourmy",
    basePath: "/api/auth",
    baseURL: process.env.BETTER_AUTH_URL,
    secret: secret(),
    database: new pg.Pool({ connectionString: url, max: 5 }),
    // Tables et colonnes Fourmy (snake_case, identifiants UUID générés par Postgres).
    user: { modelName: "users", fields: snake("emailVerified", "createdAt", "updatedAt") },
    session: {
      modelName: "auth_sessions",
      fields: snake("userId", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt"),
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
    plugins: [bearer({ requireSignature: true }), apiKeys()],
    // Une clé refusée (fausse, expirée, désactivée) est un cas attendu : pas d'erreur au journal.
    logger: {
      log: (level, message, ...args) => {
        if (/API key/i.test(message) && level === "error") return;
        (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[better-auth] ${message}`, ...args);
      },
    },
    telemetry: { enabled: false },
  });
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
    getSession(args: { headers: Headers }): Promise<{ user: { id: string; email: string; name: string | null } } | null>;
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
