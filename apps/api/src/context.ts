import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { ACCESS_MODULE_LABELS, accessGrant } from "@fourmy/contracts";
import { isEmptyGrant, levelAllows, memberGrant, type EffectiveGrant } from "@fourmy/domain";
import { openRoute } from "./external/routes.js";
import { db } from "./db.js";
import { getAuth } from "./auth.js";

export type Role = "owner" | "worker" | "reader" | "guest";

/**
 * Qui appelle (conception_api_mcp.md §3.3). Lot AM1 : la session seulement ;
 * les clés d'API (AM4) et les jetons OAuth (AM5) viendront s'y ajouter.
 */
export type Principal = { kind: "session"; userId: string; accessId: null; clientId: null };

/** Variables de contexte posées par les middlewares et lues par les routes. */
export type Env = {
  Variables: {
    userId: string;
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
  // Ni cookie ni jeton : inutile d'interroger la base.
  if (!h.get("cookie") && !h.get("authorization")) return deny(401, "Unauthorized", "Connexion requise.");
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return deny(401, "Unauthorized", "Connexion requise.");
  const { id, email, name } = session.user;
  c.set("userId", id);
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
  const grant = memberGrant(role, stored?.success ? stored.data : null);
  if (role === "guest") {
    if (isEmptyGrant(grant)) return deny(403, "Accès refusé", "Votre accès à cette ferme ne couvre aucun module.");
    // Le périmètre d'activités n'est appliqué qu'au lot AM2 (RLS) : d'ici là, refus plutôt que fuite.
    if (grant.activities !== "all") return deny(403, "Accès refusé", "Les accès limités à certaines activités ne sont pas encore disponibles.");
  }
  c.set("farmId", farmId);
  c.set("role", role);
  c.set("principal", { kind: "session", userId: c.get("userId"), accessId: null, clientId: null });
  c.set("grant", grant);
  c.set("external", role === "guest");
  // Lecture seule (conseiller, comptable) : aucune écriture, sauf sur sa propre
  // fiche (coordonnées, photo), que la route vérifie (docs/equipe-personnes-design.md §3.2).
  if (role === "reader" && !READ_METHODS.has(c.req.method) && !OWN_PROFILE_RE.test(c.req.path)) {
    return deny(403, "Accès refusé", "Compte en lecture seule : consultation et exports seulement.");
  }
  await next();
});

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OWN_PROFILE_RE = /\/people\/[0-9a-f-]{36}(\/photo)?$/i;

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
