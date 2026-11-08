import { Hono } from "hono";
import { baselineWrite, equipmentBundleWrite, maintenanceSettings, planOperationWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  applyModel,
  baselineAll,
  createOperation,
  farmDues,
  getSettings,
  importBundle,
  listModels,
  maintenanceView,
  putSettings,
  setBaseline,
  updateOperation,
} from "../repos/maintenance.js";
import { atOrNow, domainCtx, problem, uuidParam } from "./helpers.js";

/**
 * Plan d'entretien et échéances (lot J). Lecture et « dernière fois connue »
 * pour tout membre ; plan, modèles, import et réglages pour le responsable.
 */
export const maintenanceRoutes = new Hono<Env>()
  .get("/maintenance/due", async (c) => c.json(await farmDues(db(), c.get("farmId"), atOrNow(c))))
  .get("/equipments/:id/maintenance", async (c) => c.json(await maintenanceView(db(), c.get("farmId"), uuidParam(c, "id"), atOrNow(c))))
  .post("/equipments/:id/plan", requireOwner, async (c) => {
    const parsed = planOperationWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" ; "));
    return c.json(await createOperation(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data), 201);
  })
  .put("/plan-operations/:id", requireOwner, async (c) => {
    const parsed = planOperationWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" ; "));
    await updateOperation(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data);
    return c.body(null, 204);
  })
  .put("/plan-operations/:id/baseline", async (c) => {
    const parsed = baselineWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    await setBaseline(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data);
    return c.body(null, 204);
  })
  .post("/equipments/:id/plan/baseline", async (c) => {
    const parsed = baselineWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !parsed.data.at) return problem(c, 400, "Corps invalide", "at attendu");
    return c.json(await baselineAll(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), { at: parsed.data.at, hours: parsed.data.hours }));
  })
  .get("/equipment-models", async (c) => c.json({ items: await listModels(db(), c.get("farmId")) }))
  .post("/equipments/:id/plan/apply-model", requireOwner, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { modelId?: string } | null;
    if (!body?.modelId) return problem(c, 400, "Corps invalide", "modelId attendu");
    return c.json(await applyModel(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), body.modelId));
  })
  .post("/imports/equipment-bundle", requireOwner, async (c) => {
    const parsed = equipmentBundleWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" ; "));
    return c.json(await importBundle(db(), c.get("farmId"), domainCtx(c), parsed.data.files, parsed.data.equipmentId ?? null), 201);
  })
  .get("/settings/maintenance", async (c) => c.json(await getSettings(db(), c.get("farmId"))))
  .put("/settings/maintenance", requireOwner, async (c) => {
    const parsed = maintenanceSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await putSettings(db(), c.get("farmId"), parsed.data));
  });
