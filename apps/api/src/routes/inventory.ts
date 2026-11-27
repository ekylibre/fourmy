import { Hono } from "hono";
import { containerCorrectionWrite, containerPlacementWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { listPlacesAt } from "../repos/places.js";
import { listContainersAt, containerContentsAt, placeContainer, correctContainer } from "../repos/containers.js";
import { stockAt } from "../repos/stock.js";
import { snapshotAt } from "../repos/snapshot.js";
import { atOrNow, domainCtx, problem, uuidParam } from "./helpers.js";

/** Snapshot, bâtiments, cuves et stocks (FR-TIME-1, FR-STK-1, US-3, US-9). */
export const inventoryRoutes = new Hono<Env>()
  .get("/snapshot", async (c) => {
    const snap = await snapshotAt(db(), c.get("farmId"), atOrNow(c));
    if (!c.get("external")) return c.json(snap);
    // Accès restreint (lot AM3) : ouvert avec le parcellaire ; les autres modules seulement s'ils sont ouverts.
    const m = c.get("grant").modules;
    return c.json({
      ...snap,
      places: m.farm === "none" ? [] : snap.places,
      containers: m.stocks === "none" ? [] : snap.containers,
      equipments: m.equipments === "none" ? [] : snap.equipments,
    });
  })
  .get("/places", async (c) => {
    const items = await listPlacesAt(db(), c.get("farmId"), atOrNow(c));
    return c.json({ items, nextCursor: null });
  })
  .get("/containers", async (c) => {
    const items = await listContainersAt(db(), c.get("farmId"), atOrNow(c));
    return c.json({ items, nextCursor: null });
  })
  .get("/containers/:id/contents", async (c) =>
    c.json(await containerContentsAt(db(), c.get("farmId"), uuidParam(c, "id"), atOrNow(c))),
  )
  .patch("/containers/:id/placement", requireOwner, async (c) => {
    const parsed = containerPlacementWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await placeContainer(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data));
  })
  .post("/containers/:id/corrections", requireOwner, async (c) => {
    const parsed = containerCorrectionWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await correctContainer(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data));
  })
  .get("/stock", async (c) => {
    const items = await stockAt(db(), c.get("farmId"), {
      at: atOrNow(c),
      articleId: c.req.query("article") ? uuidParam(c, "article", "query") : undefined,
      locationId: c.req.query("place") ? uuidParam(c, "place", "query") : undefined,
    });
    return c.json({ items, nextCursor: null });
  });
