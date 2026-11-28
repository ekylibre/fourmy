import { Hono, type Context } from "hono";
import { z } from "zod";
import { interventionPlanWrite, interventionCompleteWrite, interventionUpdateWrite } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";
import {
  listInterventions,
  planIntervention,
  completeIntervention,
  cancelIntervention,
  updateIntervention,
  readInterventionDetail,
  campaignWindow,
} from "../repos/interventions.js";
import { BadRequest, domainCtx, problem, uuidParam, window } from "./helpers.js";

/** Accepter une proposition en enregistrant l'intervention : le responsable seulement (B9). */
const proposalDenied = (c: Context<Env>, body: { proposal?: string }) =>
  body.proposal && c.get("role") !== "owner" ? problem(c, 403, "Accès refusé", "Seul le responsable de la ferme accepte une proposition.") : null;

const cancelWrite = z.object({ reason: z.string().trim().min(3, "Motif d'annulation requis.") });

/**
 * Interventions (docs/interventions.md). Ouvertes aux rôles owner et worker :
 * le salarié de terrain planifie, réalise, corrige et annule ses saisies.
 */
export const interventionRoutes = new Hono<Env>()
  .get("/interventions", async (c) => {
    const status = c.req.query("status");
    if (status && !["planned", "done", "cancelled"].includes(status)) throw new BadRequest("status : planned, done ou cancelled");
    // ?campaign=2026 : toute la campagne (vues de la semaine, kanban, recherche) ; sinon ?from&to.
    const campaign = c.req.query("campaign");
    let range: { from: string; to: string };
    if (campaign !== undefined) {
      const year = Number(campaign);
      if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new BadRequest("campaign : année de campagne attendue (ex. 2026)");
      range = await campaignWindow(db(), c.get("farmId"), year);
    } else {
      range = window(c, 366);
    }
    const items = await listInterventions(db(), c.get("farmId"), {
      ...range,
      status: status as "planned" | "done" | "cancelled" | undefined,
    });
    return c.json({ items, nextCursor: null });
  })
  .post("/interventions", async (c) => {
    const parsed = interventionPlanWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const denied = proposalDenied(c, parsed.data);
    if (denied) return denied;
    const { intervention, created, warnings } = await planIntervention(db(), c.get("farmId"), domainCtx(c), parsed.data);
    // Alertes non bloquantes (cultures qui se recoupent…) à côté de l'intervention.
    return c.json({ ...intervention, warnings }, created ? 201 : 200);
  })
  .get("/interventions/:id", async (c) => c.json(await readInterventionDetail(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/interventions/:id", async (c) => {
    const parsed = interventionUpdateWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await updateIntervention(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data));
  })
  .post("/interventions/:id/complete", async (c) => {
    const parsed = interventionCompleteWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const denied = proposalDenied(c, parsed.data);
    if (denied) return denied;
    return c.json(await completeIntervention(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data));
  })
  .post("/interventions/:id/cancel", async (c) => {
    const parsed = cancelWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", "reason : motif d'annulation requis");
    return c.json(await cancelIntervention(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data.reason));
  });
