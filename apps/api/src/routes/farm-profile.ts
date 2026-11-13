import { Hono } from "hono";
import type { ZodType } from "zod";
import { farmCertificationWrite, farmDisplay, farmProfileIdentity, farmSiteWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { GeocodeRateLimited, GeocodeUnavailable, geocodeReverse, geocodeSearch } from "../geocode.js";
import {
  createFarmCertification,
  createSite,
  deleteFarmCertification,
  deleteSite,
  getProfile,
  putDisplay,
  putIdentity,
  updateFarmCertification,
  updateSite,
} from "../repos/farm-profile.js";
import { setLogo } from "../repos/equipments.js";
import { logoUpload } from "./equipments.js";
import { BadRequest, domainCtx, problem, uuidParam } from "./helpers.js";

/**
 * « Ma ferme », lot F1 (claudedocs/conception_ma_ferme.md §5.1). Lecture
 * pour tout membre (E3), écriture et géocodage pour le responsable.
 */

async function body<T>(c: { req: { json: () => Promise<unknown> } }, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new BadRequest(parsed.error.issues.map((i) => i.message).join(" ; "));
  return parsed.data;
}

async function geocoding<T>(c: Parameters<typeof problem>[0], run: () => Promise<T>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof GeocodeRateLimited) {
      c.header("retry-after", "1");
      return problem(c, 429, "Trop de requêtes", "Patientez une seconde avant de relancer la recherche d'adresse.");
    }
    if (e instanceof GeocodeUnavailable) return problem(c, 503, "Géocodage indisponible", "Placez le point sur la carte : l'adresse sera enregistrée telle quelle.");
    throw e;
  }
}

export const farmProfileRoutes = new Hono<Env>()
  .get("/farm", async (c) => c.json(await getProfile(db(), c.get("farmId"), c.get("role") === "owner")))
  .put("/farm/identity", requireOwner, async (c) => c.json(await putIdentity(db(), c.get("farmId"), domainCtx(c), await body(c, farmProfileIdentity))))
  .post("/farm/certifications", requireOwner, async (c) =>
    c.json(await createFarmCertification(db(), c.get("farmId"), domainCtx(c), await body(c, farmCertificationWrite)), 201),
  )
  .put("/farm/certifications/:id", requireOwner, async (c) =>
    c.json(await updateFarmCertification(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), await body(c, farmCertificationWrite))),
  )
  .delete("/farm/certifications/:id", requireOwner, async (c) => {
    await deleteFarmCertification(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  .post("/farm/sites", requireOwner, async (c) => c.json(await createSite(db(), c.get("farmId"), domainCtx(c), await body(c, farmSiteWrite)), 201))
  .put("/farm/sites/:id", requireOwner, async (c) => c.json(await updateSite(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), await body(c, farmSiteWrite))))
  .delete("/farm/sites/:id", requireOwner, async (c) => {
    await deleteSite(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  .put("/farm/logo", requireOwner, async (c) => c.json(await setLogo(db(), c.get("farmId"), domainCtx(c), { farm: true }, await logoUpload(c))))
  .delete("/farm/logo", requireOwner, async (c) => c.json(await setLogo(db(), c.get("farmId"), domainCtx(c), { farm: true }, null)))
  .put("/settings/display", requireOwner, async (c) => c.json(await putDisplay(db(), c.get("farmId"), domainCtx(c), await body(c, farmDisplay))))
  .get("/geocode", requireOwner, async (c) =>
    geocoding(c, async () => c.json(await geocodeSearch(c.req.query("q") ?? "", Number(c.req.query("limit") ?? 5) || 5, c.get("userId")))),
  )
  .get("/geocode/reverse", requireOwner, async (c) => {
    const lat = Number(c.req.query("lat"));
    const lon = Number(c.req.query("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new BadRequest("lat et lon attendus");
    return geocoding(c, async () => {
      const r = await geocodeReverse(lat, lon, c.get("userId"));
      return r ? c.json(r) : c.body(null, 204);
    });
  });
