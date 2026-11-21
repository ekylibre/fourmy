import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { equipmentRates, itkWorkContext, searchMachineryRates, setMachineryRate } from "../repos/itk-work.js";
import { itkInputsContext } from "../repos/itk-inputs.js";
import { intQuery, problem, uuidParam } from "./helpers.js";

/**
 * Temps de travaux (lot IT4) : contexte de l'assolement, barème BCMA (recherche),
 * rattachement d'un matériel à une ligne du barème.
 */
const yearOf = (c: Context<Env>) => intQuery(c.req.param("year"), 0, 2000, 2100, "year");
const rateWrite = z.object({ machineryRateId: z.string().max(120).nullable() });

export const itkWorkRoutes = new Hono<Env>()
  .get("/crop-plans/:year/itk-context", async (c) => c.json(await itkWorkContext(db(), c.get("farmId"), yearOf(c), { routes: c.req.query("routes") !== "0" })))
  // Lot IT5 : besoins en intrants.
  .get("/crop-plans/:year/inputs-context", async (c) => c.json(await itkInputsContext(db(), c.get("farmId"), yearOf(c))))
  .get("/machinery-rates", (c) => c.json({ items: searchMachineryRates(c.req.query("procedure") || null, c.req.query("q") ?? "") }))
  .get("/equipments-rates", async (c) => c.json({ items: await equipmentRates(db(), c.get("farmId")) }))
  .put("/equipments/:id/machinery-rate", requireOwner, async (c) => {
    const id = uuidParam(c, "id");
    const parsed = rateWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await setMachineryRate(db(), c.get("farmId"), id, parsed.data.machineryRateId));
  });
