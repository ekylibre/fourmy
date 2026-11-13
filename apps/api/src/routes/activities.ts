import { Hono, type Context } from "hono";
import { activityParcelsWrite, activityWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { createActivity, deleteActivity, listActivities, searchReferences, setActivityParcels, updateActivity } from "../repos/activities.js";
import { BadRequest, problem, uuidParam } from "./helpers.js";
import { activityItinerary } from "../repos/itinerary.js";

/** Campagne demandée (`?year=`), l'année en cours par défaut. */
function yearOf(c: Context<Env>): number {
  const raw = c.req.query("year");
  if (!raw) return new Date().getFullYear();
  const y = Number(raw);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) throw new BadRequest("year : année attendue");
  return y;
}

/**
 * Activités de la ferme (lot C) : lecture pour tous les membres ; création,
 * modification, parcelles d'une campagne et suppression pour le responsable.
 */
export const activityRoutes = new Hono<Env>()
  .get("/activities", async (c) => c.json({ items: await listActivities(db(), c.get("farmId"), yearOf(c)) }))
  .get("/activities/:id/itinerary", async (c) => c.json(await activityItinerary(db(), c.get("farmId"), uuidParam(c, "id"), yearOf(c))))
  .get("/activities/references", async (c) =>
    c.json({ items: await searchReferences(db(), c.get("farmId"), c.req.query("q") ?? "", c.req.query("family") || null) }),
  )
  .post("/activities", requireOwner, async (c) => {
    const parsed = activityWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await createActivity(db(), c.get("farmId"), parsed.data, yearOf(c)), 201);
  })
  .put("/activities/:id", requireOwner, async (c) => {
    const parsed = activityWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await updateActivity(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data, yearOf(c)));
  })
  .put("/activities/:id/parcels", requireOwner, async (c) => {
    const parsed = activityParcelsWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await setActivityParcels(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  .delete("/activities/:id", requireOwner, async (c) => {
    await deleteActivity(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
