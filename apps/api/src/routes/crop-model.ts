import { Hono } from "hono";
import { TAW_RANGE } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { cropModelAt, parcelCropModel, setParcelSoil } from "../repos/crop-model.js";
import { BadRequest, uuidParam } from "./helpers.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Injection pour les tests : Open-Meteo simulé. */
export const cropModelDeps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

function at(value: string | undefined): string {
  const v = value ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  if (!DAY.test(v) || Number.isNaN(Date.parse(v))) throw new BadRequest("at : date AAAA-MM-JJ attendue.");
  return v;
}

/** Modèle de croissance (lot AB, docs/modele-croissance.md). */
export const cropModelRoutes = new Hono<Env>()
  .get("/crop-model", async (c) => c.json(await cropModelAt(db(), c.get("farmId"), at(c.req.query("at")), cropModelDeps.fetch)))
  .get("/land-parcels/:id/crop-model", async (c) =>
    c.json(await parcelCropModel(db(), c.get("farmId"), uuidParam(c, "id"), at(c.req.query("at")), cropModelDeps.fetch)),
  )
  .put("/land-parcels/:id/soil", requireOwner, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { tawMm?: unknown; irrigated?: unknown };
    const taw = Number(body.tawMm);
    if (!Number.isFinite(taw) || typeof body.irrigated !== "boolean") throw new BadRequest("tawMm et irrigated attendus.");
    if (taw < TAW_RANGE.min || taw > TAW_RANGE.max) throw new BadRequest(`Réserve utile entre ${TAW_RANGE.min} et ${TAW_RANGE.max} mm.`);
    await setParcelSoil(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), { tawMm: Math.round(taw), irrigated: body.irrigated });
    return c.body(null, 204);
  })
  .delete("/land-parcels/:id/soil", requireOwner, async (c) => {
    await setParcelSoil(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), null);
    return c.body(null, 204);
  });
