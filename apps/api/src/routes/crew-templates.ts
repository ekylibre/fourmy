import { Hono } from "hono";
import { withFarm } from "@fourmy/db";
import { crewTemplateWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { createCrewTemplate, deleteCrewTemplate, listCrewTemplates, updateCrewTemplate } from "../repos/crew-templates.js";
import { domainCtx, problem, uuidParam } from "./helpers.js";

/** Attelages types (FR-ATT-6) : lecture pour tous les membres, écriture owner. */
export const crewTemplateRoutes = new Hono<Env>()
  .get("/crew-templates", async (c) => {
    const items = await withFarm(db(), c.get("farmId"), (tx) => listCrewTemplates(tx));
    return c.json({ items });
  })
  .post("/crew-templates", requireOwner, async (c) => {
    const parsed = crewTemplateWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" "));
    const id = parsed.data.id ?? domainCtx(c).newId();
    const item = await withFarm(db(), c.get("farmId"), (tx) => createCrewTemplate(tx, c.get("farmId"), id, parsed.data));
    return c.json(item, 201);
  })
  .put("/crew-templates/:id", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    const parsed = crewTemplateWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" "));
    const item = await withFarm(db(), c.get("farmId"), (tx) => updateCrewTemplate(tx, id, parsed.data));
    return c.json(item);
  })
  .delete("/crew-templates/:id", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    await withFarm(db(), c.get("farmId"), (tx) => deleteCrewTemplate(tx, id));
    return c.body(null, 204);
  });
