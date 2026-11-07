import { Hono } from "hono";
import { z } from "zod";
import { interventionPlanWrite, interventionCompleteWrite } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { listInterventions, planIntervention, completeIntervention, cancelIntervention } from "../repos/interventions.js";
import { BadRequest, domainCtx, problem, uuidParam, window } from "./helpers.js";

const cancelWrite = z.object({ reason: z.string().trim().min(3, "Motif d'annulation requis.") });

/**
 * Interventions (docs/interventions.md). Ouvertes aux rôles owner et worker :
 * le salarié de terrain planifie, réalise et annule ses saisies.
 */
export const interventionRoutes = new Hono<Env>()
  .get("/interventions", async (c) => {
    const status = c.req.query("status");
    if (status && !["planned", "done", "cancelled"].includes(status)) throw new BadRequest("status : planned, done ou cancelled");
    const items = await listInterventions(db(), c.get("farmId"), {
      ...window(c, 366),
      status: status as "planned" | "done" | "cancelled" | undefined,
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
    return c.json(await completeIntervention(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data));
  })
  .post("/interventions/:id/cancel", async (c) => {
    const parsed = cancelWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", "reason : motif d'annulation requis");
    return c.json(await cancelIntervention(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data.reason));
  });
