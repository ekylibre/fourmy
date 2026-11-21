import { Hono, type Context } from "hono";
import { plannedConfirmWrite, plannedPreviewRequest } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { StalePlanned, confirmPlanned, previewPlanned } from "../repos/planned-interventions.js";
import { domainCtx, intQuery, problem } from "./helpers.js";

/**
 * Interventions prévues d'une campagne d'après les ITK (lot IT3, conception §7) :
 * aperçu pour les membres, confirmation par le responsable.
 */
const yearOf = (c: Context<Env>) => intQuery(c.req.param("year"), 0, 2000, 2100, "year");
const issues = (e: { issues: { message: string }[] }) => e.issues.map((i) => i.message).join(" ");

export const plannedInterventionRoutes = new Hono<Env>()
  .post("/planned-interventions/:year/preview", async (c) => {
    const parsed = plannedPreviewRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return problem(c, 400, "Corps invalide", issues(parsed.error));
    return c.json(await previewPlanned(db(), c.get("farmId"), yearOf(c), parsed.data.productionIds));
  })
  .post("/planned-interventions/:year", requireOwner, async (c) => {
    const parsed = plannedConfirmWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", issues(parsed.error));
    try {
      return c.json(await confirmPlanned(db(), c.get("farmId"), yearOf(c), domainCtx(c), parsed.data));
    } catch (err) {
      if (err instanceof StalePlanned) return c.json({ title: "Conflit", detail: err.message, current: err.current }, 409);
      throw err;
    }
  });
