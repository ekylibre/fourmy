import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withFarm, type Tx } from "@fourmy/db";
import { requireOwner, type Env, type Role } from "../context.js";
import { db } from "../db.js";

type Member = { userId: string; email: string; name: string | null; role: Role; personId: string | null };

const list = (tx: Tx) =>
  tx.execute(sql`
    SELECT m.user_id AS "userId", u.email, u.name, m.role, p.id AS "personId"
    FROM memberships m JOIN users u ON u.id = m.user_id
    LEFT JOIN people p ON p.user_id = m.user_id
    ORDER BY m.role, u.email`) as unknown as Promise<Member[]>;

/**
 * Comptes ayant accès à la ferme, en lecture (destinataires des alertes
 * d'entretien). Depuis le lot P5, les accès se gèrent sur la fiche de la
 * personne : invitation (POST /people/:id/invitations), rôle et retrait
 * (PATCH|DELETE /people/:id/account).
 */
export const memberRoutes = new Hono<Env>().get("/members", requireOwner, async (c) =>
  c.json({ items: await withFarm(db(), c.get("farmId"), list), nextCursor: null }),
);
