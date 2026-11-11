import { Hono } from "hono";
import { fertilizationSettingsWrite, nitrateZoneWrite, soilAnalysisWrite, soilProfileWrite, waterSourceWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  addSoilAnalysis,
  confirmNitrateZone,
  deleteSoilAnalysis,
  deleteWaterSource,
  getSettings,
  listParcelContexts,
  listWaterSources,
  parcelContext,
  putSettings,
  putSoilProfile,
  refreshNitrateZones,
  saveWaterSource,
} from "../repos/fertilization-context.js";
import { BadRequest, problem, uuidParam } from "./helpers.js";

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Contexte de la fertilisation azotée (lot AF) : paramètres, zonage nitrates,
 * fiche sol, analyses de sol, points d'eau. Lecture pour les membres ;
 * écriture pour le responsable.
 */
export const fertilizationRoutes = new Hono<Env>()
  .get("/fertilization/settings", async (c) => c.json(await getSettings(db(), c.get("farmId"))))
  .put("/fertilization/settings", requireOwner, async (c) => {
    const parsed = fertilizationSettingsWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await putSettings(db(), c.get("farmId"), parsed.data));
  })
  .get("/fertilization/parcels", async (c) => {
    const at = c.req.query("at") ?? new Date().toISOString().slice(0, 10);
    if (!DAY.test(at)) throw new BadRequest("at : date AAAA-MM-JJ attendue.");
    return c.json({ items: await listParcelContexts(db(), c.get("farmId"), at) });
  })
  .post("/fertilization/zones/refresh", requireOwner, async (c) => c.json(await refreshNitrateZones(db(), c.get("farmId"))))
  .get("/land-parcels/:id/fertilization", async (c) => c.json(await parcelContext(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/land-parcels/:id/soil-profile", requireOwner, async (c) => {
    const parsed = soilProfileWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await putSoilProfile(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data));
  })
  .put("/land-parcels/:id/nitrate-zone", requireOwner, async (c) => {
    const parsed = nitrateZoneWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await confirmNitrateZone(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data));
  })
  .post("/land-parcels/:id/soil-analyses", requireOwner, async (c) => {
    const parsed = soilAnalysisWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await addSoilAnalysis(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data), 201);
  })
  .delete("/land-parcels/:id/soil-analyses/:analysisId", requireOwner, async (c) =>
    c.json(await deleteSoilAnalysis(db(), c.get("farmId"), uuidParam(c, "id"), uuidParam(c, "analysisId"))),
  )
  .get("/water-sources", async (c) => c.json({ items: await listWaterSources(db(), c.get("farmId")) }))
  .post("/water-sources", requireOwner, async (c) => {
    const parsed = waterSourceWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveWaterSource(db(), c.get("farmId"), null, parsed.data), 201);
  })
  .put("/water-sources/:id", requireOwner, async (c) => {
    const parsed = waterSourceWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveWaterSource(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  .delete("/water-sources/:id", requireOwner, async (c) => {
    await deleteWaterSource(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
