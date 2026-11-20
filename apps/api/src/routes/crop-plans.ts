import { Hono, type Context } from "hono";
import { cropPlanDraftWrite, cropPlanSettings, cropPlanValidateWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  StaleCropPlan,
  createCropPlan,
  discardCropPlanDraft,
  getCropPlan,
  getCropPlanContext,
  getCropPlanSettings,
  getCropPlanVersion,
  listCropPlans,
  putCropPlanSettings,
  reopenCropPlan,
  saveCropPlanDraft,
  validateCropPlan,
} from "../repos/crop-plans.js";
import { intQuery, problem } from "./helpers.js";

/**
 * Assolement prévisionnel (lot AS2a, claudedocs/conception_assolement.md §5) :
 * lecture par les membres, préparation et validation par le responsable.
 */
const yearOf = (c: Context<Env>) => intQuery(c.req.param("year"), 0, 2000, 2100, "year");

/** 409 avec l'assolement du serveur, que l'écran propose de recharger. */
async function guard<T>(c: Context<Env>, run: () => Promise<T>) {
  try {
    return c.json(await run());
  } catch (err) {
    if (err instanceof StaleCropPlan) return c.json({ title: "Conflit", detail: err.message, current: err.current }, 409);
    throw err;
  }
}

export const cropPlanRoutes = new Hono<Env>()
  .get("/crop-plans", async (c) => c.json(await listCropPlans(db(), c.get("farmId"))))
  .get("/crop-plans/:year", async (c) => c.json(await getCropPlan(db(), c.get("farmId"), yearOf(c))))
  .post("/crop-plans/:year", requireOwner, async (c) => c.json(await createCropPlan(db(), c.get("farmId"), yearOf(c), c.get("userId")), 201))
  .get("/crop-plans/:year/context", async (c) => c.json(await getCropPlanContext(db(), c.get("farmId"), yearOf(c))))
  .put("/crop-plans/:year/draft", requireOwner, async (c) => {
    const parsed = cropPlanDraftWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return guard(c, () => saveCropPlanDraft(db(), c.get("farmId"), yearOf(c), parsed.data, c.get("userId")));
  })
  .delete("/crop-plans/:year/draft", requireOwner, async (c) => {
    const plan = await discardCropPlanDraft(db(), c.get("farmId"), yearOf(c), c.get("userId"));
    return plan ? c.json(plan) : c.body(null, 204);
  })
  .post("/crop-plans/:year/reopen", requireOwner, async (c) => c.json(await reopenCropPlan(db(), c.get("farmId"), yearOf(c), c.get("userId"))))
  .post("/crop-plans/:year/validate", requireOwner, async (c) => {
    const parsed = cropPlanValidateWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    const dryRun = c.req.query("dryRun") === "1";
    return guard(c, () => validateCropPlan(db(), c.get("farmId"), yearOf(c), parsed.data, { dryRun, userId: c.get("userId") }));
  })
  .get("/crop-plans/:year/versions/:version", async (c) =>
    c.json(await getCropPlanVersion(db(), c.get("farmId"), yearOf(c), intQuery(c.req.param("version"), 0, 1, 10_000, "version"))),
  )
  .get("/settings/crop-plan", async (c) => c.json(await getCropPlanSettings(db(), c.get("farmId"))))
  .put("/settings/crop-plan", requireOwner, async (c) => {
    const parsed = cropPlanSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await putCropPlanSettings(db(), c.get("farmId"), parsed.data));
  });
