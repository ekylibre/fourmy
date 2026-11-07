import { Hono } from "hono";
import { syncPushRequest } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { pull, push } from "../repos/sync.js";
import { BadRequest, domainCtx, problem } from "./helpers.js";

/** Synchro mobile (ADR-13) : pull des changements, push des interventions. */
export const syncRoutes = new Hono<Env>()
  .get("/sync/pull", async (c) => {
    const raw = c.req.query("lastPulledAt");
    let last: string | null = null;
    if (raw) {
      const t = Date.parse(raw);
      if (Number.isNaN(t)) throw new BadRequest("lastPulledAt : date ISO-8601 attendue");
      last = new Date(t).toISOString();
    }
    return c.json(await pull(db(), c.get("farmId"), last));
  })
  .post("/sync/push", async (c) => {
    const parsed = syncPushRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await push(db(), c.get("farmId"), domainCtx(c, "mobile"), parsed.data));
  });
