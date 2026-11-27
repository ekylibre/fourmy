import { Hono } from "hono";
import { farmAccessCreate, farmAccessUpdate } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { accessLog, createAccessKey, listAccesses, revokeAccess, updateAccess } from "../repos/accesses.js";
import { BadRequest, intQuery, problem, uuidParam } from "./helpers.js";

/**
 * Accès externes de la ferme (lot AM4) : clés d'API. Tout membre gère ses
 * clés (un lecteur : en lecture, Q4) ; le responsable voit et révoque celles
 * de tous. Fermées aux accès externes eux-mêmes (external/routes.ts).
 */
const viewer = (c: { get: (k: "userId" | "role") => string }) => ({ userId: c.get("userId"), role: c.get("role") as "owner" | "worker" | "reader" | "guest" });

export const accessRoutes = new Hono<Env>()
  .get("/accesses", async (c) => c.json({ items: await listAccesses(db(), c.get("farmId"), viewer(c)), nextCursor: null }))
  .post("/accesses", async (c) => {
    const parsed = farmAccessCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await createAccessKey(db(), c.get("farmId"), viewer(c), parsed.data), 201);
  })
  .patch("/accesses/:id", async (c) => {
    const parsed = farmAccessUpdate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await updateAccess(db(), c.get("farmId"), viewer(c), uuidParam(c, "id"), parsed.data));
  })
  .delete("/accesses/:id", async (c) => {
    await revokeAccess(db(), c.get("farmId"), viewer(c), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  .get("/accesses/:id/log", async (c) => {
    const before = c.req.query("before");
    if (before && Number.isNaN(Date.parse(before))) throw new BadRequest("before : date ISO attendue");
    const items = await accessLog(db(), c.get("farmId"), viewer(c), uuidParam(c, "id"), { limit: intQuery(c.req.query("limit"), 100, 1, 500, "limit"), before });
    return c.json({ items, nextCursor: items.length ? items.at(-1)!.at : null });
  });
