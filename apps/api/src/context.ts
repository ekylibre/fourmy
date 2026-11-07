import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { db } from "./db.js";
import { getAuth } from "./auth.js";

export type Role = "owner" | "worker";

/** Variables de contexte posées par les middlewares et lues par les routes. */
export type Env = {
  Variables: {
    userId: string;
    user: { id: string; email: string; name: string | null };
    farmId: string;
    role: Role;
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
    tx.execute(sql`SELECT role FROM memberships WHERE farm_id = ${farmId} AND user_id = ${c.get("userId")}`),
  )) as unknown as { role: Role }[];
  const role = rows[0]?.role;
  if (!role) return deny(403, "Accès refusé", "Vous n'êtes pas membre de cette ferme.");
  c.set("farmId", farmId);
  c.set("role", role);
  await next();
});

/** Réserve une route au rôle `owner` (parcellaire, corrections, imports…). */
export const requireOwner: MiddlewareHandler<Env> = createMiddleware<Env>(async (c, next) => {
  if (c.get("role") !== "owner") {
    return deny(403, "Accès refusé", "Opération réservée au responsable de la ferme (owner).");
  }
  await next();
});
