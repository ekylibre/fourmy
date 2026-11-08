import { Hono } from "hono";
import { certificationWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { createCertification, deleteCertification, listCertifications, updateCertification } from "../repos/certifications.js";
import { problem, uuidParam } from "./helpers.js";

/** Certifications des parcelles : lecture pour tous, écriture pour le responsable. */
export const certificationRoutes = new Hono<Env>()
  .get("/certifications", async (c) => c.json({ items: await listCertifications(db(), c.get("farmId")) }))
  .get("/land-parcels/:id/certifications", async (c) => c.json({ items: await listCertifications(db(), c.get("farmId"), uuidParam(c, "id")) }))
  .post("/land-parcels/:id/certifications", requireOwner, async (c) => {
    const parsed = certificationWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await createCertification(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data), 201);
  })
  .put("/certifications/:id", requireOwner, async (c) => {
    const parsed = certificationWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    return c.json(await updateCertification(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  .delete("/certifications/:id", requireOwner, async (c) => {
    await deleteCertification(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
