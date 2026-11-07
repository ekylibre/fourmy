import { Hono } from "hono";
import { interventionPlanWrite, interventionCompleteWrite } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { listInterventions, planIntervention, completeIntervention } from "../repos/interventions.js";
import { BadRequest, domainCtx, problem, uuidParam, window } from "./helpers.js";

/**
 * Interventions (FR-INT-1/3, US-2). Ouvertes aux rôles owner et worker :
 * le salarié de terrain planifie et réalise.
 */
export const interventionRoutes = new Hono<Env>()
  .get("/interventions", async (c) => {
    const status = c.req.query("status");
    if (status && status !== "planned" && status !== "done") throw new BadRequest("status : planned ou done");
    const items = await listInterventions(db(), c.get("farmId"), {
      ...window(c, 366),
      status: status as "planned" | "done" | undefined,
    });
    return c.json({ items, nextCursor: null });
  })
  .post("/interventions", async (c) => {
    const parsed = interventionPlanWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const { intervention, created } = await planIntervention(db(), c.get("farmId"), domainCtx(c), parsed.data);
    return c.json(intervention, created ? 201 : 200);
  })
  .post("/interventions/:id/complete", async (c) => {
    const parsed = interventionCompleteWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    if (Date.parse(parsed.data.stoppedAt) < Date.parse(parsed.data.startedAt)) {
      throw new BadRequest("stoppedAt précède startedAt");
    }
    const result = await completeIntervention(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data);
    return c.json(result);
  });
