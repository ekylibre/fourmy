import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { sql } from "drizzle-orm";
import { runWithActivityScope, withFarm } from "@fourmy/db";
import { ACCESS_MODULE_LABELS, accessGrant, accessModules } from "@fourmy/contracts";
import { intersectGrants, isEmptyGrant, levelAllows, memberGrant, normalizeGrant, type EffectiveGrant } from "@fourmy/domain";
import { openRoute } from "./external/routes.js";
import { db } from "./db.js";
import { API_KEY_PREFIX, getAuth, OAUTH_SCOPES } from "./auth.js";
import { looksLikeJwt, verifyOAuthToken } from "./external/oauth.js";

export type Role = "owner" | "worker" | "reader" | "guest";

/**
 * Qui appelle (conception_api_mcp.md §3.3) : une session (web, mobile), ou
 * une clé d'API (lot AM4) ou un jeton OAuth (lot AM5). `accessId` : l'accès
 * externe de la ferme, posé par `farmScope`.
 */
export type Principal =
  | { kind: "session"; userId: string; accessId: null; clientId: null }
  | { kind: "api_key"; userId: string; apiKeyId: string; accessId: string | null; clientId: null }
  | { kind: "oauth"; userId: string; clientId: string; scopes: string[]; accessId: string | null };

/** Variables de contexte posées par les middlewares et lues par les routes. */
export type Env = {
  Variables: {
    userId: string;
    /** Session better-auth (web, mobile) ; absente pour une clé ou un jeton OAuth. */
    sessionId: string | null;
    user: { id: string; email: string; name: string | null };
    farmId: string;
    role: Role;
    principal: Principal;
    /** Droits effectifs sur la ferme : membre ∩ accès. */
    grant: EffectiveGrant;
    /** Accès restreint : seules les routes ouvertes (external/routes.ts) répondent. */
    external: boolean;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined): v is string => !!v && UUID_RE.test(v);

const deny = (status: 400 | 401 | 403, title: string, detail?: string) =>
  new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

/**
 * Authentification : session better-auth (cookie pour le web, jeton signé
 * `Authorization: Bearer` pour le mobile). L'autorisation par ferme suit.
 */
export const auth: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  const h = c.req.raw.headers;
  // Clé d'API (lot AM4) : `x-api-key`, ou `Authorization: Bearer fmy_…`.
  const bearer = h.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const key = h.get("x-api-key") ?? (bearer?.startsWith(API_KEY_PREFIX) ? bearer : undefined);
  if (key) {
    const v = await getAuth().api.verifyApiKey({ body: { key } }).catch(() => null);
    if (!v?.valid || !v.key) return deny(401, "Unauthorized", "Clé d'API invalide, expirée ou révoquée.");
    // Une clé n'ouvre que les routes d'une ferme (pas « Mes fermes », ni le compte).
    if (!/^\/api\/v1\/farms\/[^/]+\//.test(c.req.path)) return deny(403, "Accès refusé", "Une clé d'API n'ouvre que les routes de sa ferme.");
    const [u] = (await db().execute(sql`SELECT id, email, name FROM users WHERE id = ${v.key.referenceId}::uuid`)) as unknown as { id: string; email: string; name: string | null }[];
    if (!u) return deny(401, "Unauthorized", "Clé d'API invalide, expirée ou révoquée.");
    c.set("userId", u.id);
    c.set("sessionId", null);
    c.set("user", { id: u.id, email: u.email, name: u.name || null });
    c.set("principal", { kind: "api_key", userId: u.id, apiKeyId: v.key.id, accessId: null, clientId: null });
    return next();
  }
  // Jeton d'accès OAuth (lot AM5) : un JWT signé par Fourmy, pour /api/v1 ou /mcp.
  if (bearer && looksLikeJwt(bearer)) {
    const t = await verifyOAuthToken(bearer);
    if (!t) return deny(401, "Unauthorized", "Jeton OAuth invalide ou expiré.");
    if (!/^\/api\/v1\/farms\/[^/]+\//.test(c.req.path)) return deny(403, "Accès refusé", "Un jeton OAuth n'ouvre que les routes des fermes consenties.");
    const [u] = (await db().execute(sql`SELECT id, email, name FROM users WHERE id = ${t.userId}::uuid`)) as unknown as { id: string; email: string; name: string | null }[];
    if (!u) return deny(401, "Unauthorized", "Jeton OAuth invalide ou expiré.");
    c.set("userId", u.id);
    c.set("sessionId", null);
    c.set("user", { id: u.id, email: u.email, name: u.name || null });
    c.set("principal", { kind: "oauth", userId: u.id, clientId: t.clientId, scopes: [...t.scopes], accessId: null });
    return next();
  }
  // Ni cookie ni jeton : inutile d'interroger la base.
  if (!h.get("cookie") && !h.get("authorization")) return deny(401, "Unauthorized", "Connexion requise.");
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return deny(401, "Unauthorized", "Connexion requise.");
  const { id, email, name } = session.user;
  c.set("userId", id);
  c.set("sessionId", session.session.id);
  c.set("user", { id, email, name: name || null });
  await next();
});

/**
 * Autorisation par ferme : l'utilisateur doit en être membre. La RLS isole
 * les fermes entre elles ; ce contrôle décide **qui** peut entrer dans une
 * ferme. Le rôle est exposé aux routes (`requireOwner`).
 */
export const farmScope: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  const farmId = c.req.param("farmId");
  if (!isUuid(farmId)) return deny(400, "Ferme invalide", "farmId doit être un UUID.");
  const rows = (await withFarm(db(), farmId, (tx) =>
    tx.execute(sql`SELECT role, access_grant FROM memberships WHERE farm_id = ${farmId} AND user_id = ${c.get("userId")}`),
  )) as unknown as { role: Role; access_grant: unknown }[];
  const role = rows[0]?.role;
  if (!role) return deny(403, "Accès refusé", "Vous n'êtes pas membre de cette ferme.");
  // Membre restreint (B7) : ses droits enregistrés ; illisibles = aucun droit.
  const stored = role === "guest" ? accessGrant.safeParse(rows[0]!.access_grant) : null;
  let grant = memberGrant(role, stored?.success ? stored.data : null);
  const principal = c.get("principal") ?? { kind: "session", userId: c.get("userId"), accessId: null, clientId: null };
  if (principal.kind === "api_key") {
    // Clé d'API : son accès sur cette ferme, ni révoqué ni expiré ; droits = membre ∩ clé (API-4).
    const [a] = (await withFarm(db(), farmId, (tx) =>
      tx.execute(sql`SELECT id, access_grant FROM farm_accesses
                     WHERE api_key_id = ${principal.apiKeyId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`),
    )) as unknown as { id: string; access_grant: unknown }[];
    const keyGrant = a ? accessGrant.safeParse(a.access_grant) : null;
    if (!a || !keyGrant?.success) return deny(403, "Accès refusé", "Cette clé d'API n'ouvre pas cette ferme.");
    grant = intersectGrants(grant, normalizeGrant(keyGrant.data));
    c.set("principal", { ...principal, accessId: a.id });
  } else if (principal.kind === "oauth") {
    // Jeton OAuth : le consentement de cet utilisateur à cette application, pour cette ferme (§7.1).
    const [a] = (await withFarm(db(), farmId, (tx) =>
      tx.execute(sql`SELECT id, access_grant FROM farm_accesses
                     WHERE kind = 'oauth' AND oauth_client_id = ${principal.clientId} AND user_id = ${principal.userId} AND revoked_at IS NULL`),
    )) as unknown as { id: string; access_grant: unknown }[];
    const consented = a ? accessGrant.safeParse(a.access_grant) : null;
    if (!a || !consented?.success) return deny(403, "Accès refusé", "Cette application n'a pas été autorisée sur cette ferme.");
    grant = intersectGrants(grant, normalizeGrant(consented.data));
    // Sans le scope d'écriture, la lecture seulement, quel que soit le consentement.
    if (!principal.scopes.includes(OAUTH_SCOPES.write)) grant = intersectGrants(grant, READ_ONLY);
    c.set("principal", { ...principal, accessId: a.id });
  } else {
    c.set("principal", principal);
  }
  const external = role === "guest" || principal.kind !== "session";
  if (external && isEmptyGrant(grant)) return deny(403, "Accès refusé", "Cet accès à la ferme ne couvre aucun module.");
  c.set("farmId", farmId);
  // Un accès externe est vu des routes comme un invité restreint : jamais les privilèges du
  // responsable (données privées des personnes, routes réservées), quel que soit son auteur.
  c.set("role", external ? "guest" : role);
  c.set("grant", grant);
  c.set("external", external);
  // Lecture seule (conseiller, comptable) : aucune écriture, sauf sur sa propre
  // fiche (coordonnées, photo), que la route vérifie (docs/equipe-personnes-design.md §3.2).
  // Ses propres clés d'API aussi (Q4 : en lecture seulement, plafonnées par ses droits).
  if (role === "reader" && !external && !READ_METHODS.has(c.req.method) && !OWN_PROFILE_RE.test(c.req.path) && !OWN_ACCESS_RE.test(c.req.path)) {
    return deny(403, "Accès refusé", "Compte en lecture seule : consultation et exports seulement.");
  }
  // Périmètre d'activités (lot AM2) : toutes les requêtes en base de la suite le portent (RLS).
  if (grant.activities !== "all") return runWithActivityScope(grant.activities, () => next());
  await next();
});

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Plafond « lecture partout » (jeton sans `fourmy:write`). */
const READ_ONLY: EffectiveGrant = { modules: Object.fromEntries(accessModules.map((m) => [m, "read"])) as EffectiveGrant["modules"], activities: "all" };
const OWN_PROFILE_RE = /\/people\/[0-9a-f-]{36}(\/photo)?$/i;
const OWN_ACCESS_RE = /\/accesses(\/[0-9a-f-]{36})?$/i;

/** Réserve une route au rôle `owner` (parcellaire, corrections, imports…). */
export const requireOwner: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  if (c.get("role") !== "owner") {
    return deny(403, "Accès refusé", "Opération réservée au responsable de la ferme (owner).");
  }
  await next();
});

/**
 * Garde des accès restreints (conception_api_mcp.md §6.1) : la route qui va
 * répondre doit être ouverte (sinon 404, comme si elle n'existait pas) et le
 * module autorisé au niveau voulu (sinon 403). Sans effet pour les membres
 * `owner`, `worker` et `reader` en session.
 */
export const externalGuard: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  if (!c.get("external")) return next();
  // La première route non middleware est celle qui répondra (ordre de déclaration Hono).
  const route = matchedRoutes(c).find((r) => r.method !== "ALL");
  if (!route) return next(); // aucune route : le 404 habituel
  const open = openRoute(c.req.method, route.path);
  if (!open) return deny404();
  const level = c.get("grant").modules[open.module];
  if (!levelAllows(level, c.req.method)) {
    return deny(403, "Accès refusé", `Cet accès n'ouvre pas le module « ${ACCESS_MODULE_LABELS[open.module]} »${level === "read" ? " en écriture" : ""}.`);
  }
  await next();
});

const deny404 = () =>
  new Response(JSON.stringify({ type: "about:blank", title: "Not Found", status: 404 }), {
    status: 404,
    headers: { "content-type": "application/problem+json" },
  });
