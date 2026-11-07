import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
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

/** Origines du web autorisées ; en local, aussi le serveur Vite (dev, preview). */
function trustedOrigins(): string[] {
  const configured = (process.env.FOURMY_TRUSTED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return isLocalDev() ? [...configured, "http://localhost:5173", "http://localhost:4173"] : configured;
}

const snake = <K extends string>(...keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)])) as Record<K, string>;

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
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.FOURMY_ALLOW_SIGNUP !== "true",
      minPasswordLength: 10,
    },
    trustedOrigins: trustedOrigins(),
    plugins: [bearer({ requireSignature: true })],
    telemetry: { enabled: false },
  });
}

let instance: ReturnType<typeof create> | null = null;

/** Instance unique, créée au premier usage (les tests sans base n'en ont pas besoin). */
export function getAuth() {
  instance ??= create();
  return instance;
}
