import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Env } from "../context.js";
import { db } from "../db.js";

/** Routes de l'utilisateur courant (hors ferme) : son compte, ses fermes et son rôle. */
export const meRoutes = new Hono<Env>().get("/farms", async (c) => {
  const items = await db().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return (await tx.execute(sql`SELECT farm_id AS id, name, role FROM fourmy_user_farms(${c.get("userId")})`)) as unknown as {
      id: string;
      name: string;
      role: "owner" | "worker" | "reader";
    }[];
  });
  return c.json({ userId: c.get("userId"), user: c.get("user"), items });
});
