import { Hono } from "hono";
import { landParcelWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { listParcelsAt, listParcelNames, createParcel, versionParcel } from "../repos/parcels.js";
import { atOrNow, domainCtx, problem, uuidParam } from "./helpers.js";

/** Parcellaire versionné (FR-PARC-1/2). Écritures réservées au rôle owner. */
export const parcelRoutes = new Hono<Env>()
  .get("/land-parcels", async (c) => {
    const items = await listParcelsAt(db(), c.get("farmId"), atOrNow(c));
    return c.json({ items, nextCursor: null });
  })
  .get("/land-parcels/names", async (c) => c.json({ items: await listParcelNames(db(), c.get("farmId")) }))
  .post("/land-parcels", requireOwner, async (c) => {
    const parsed = landParcelWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const ctx = domainCtx(c);
    const version = await createParcel(db(), c.get("farmId"), ctx, {
      ...parsed.data,
      id: parsed.data.id ?? ctx.newId(),
    });
    return c.json(version, 201);
  })
  .patch("/land-parcels/:id", requireOwner, async (c) => {
    const parsed = landParcelWrite.omit({ id: true }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const version = await versionParcel(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data);
    return c.json(version);
  });
