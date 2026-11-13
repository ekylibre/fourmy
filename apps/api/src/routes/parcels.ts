import { Hono } from "hono";
import { landParcelWrite, parcelCreateFromMap } from "@fourmy/contracts";
import { createParcelFromMap, identifyPoint, parcelSheet, refreshReferences } from "../repos/parcel-sheet.js";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { listParcelsAt, listParcelNames, createParcel, versionParcel } from "../repos/parcels.js";
import { parcelItinerary } from "../repos/itinerary.js";
import { atOrNow, BadRequest, domainCtx, intQuery, problem, uuidParam } from "./helpers.js";

/** Parcellaire versionné (FR-PARC-1/2). Écritures réservées au rôle owner. */
export const parcelRoutes = new Hono<Env>()
  .get("/land-parcels", async (c) => {
    const items = await listParcelsAt(db(), c.get("farmId"), atOrNow(c));
    return c.json({ items, nextCursor: null });
  })
  .get("/land-parcels/names", async (c) => c.json({ items: await listParcelNames(db(), c.get("farmId")) }))
  // Point de la carte : parcelle PAC (RPG) et parcelles cadastrales (API Carto de l'IGN).
  .get("/land-parcels/identify", async (c) => {
    const lat = Number(c.req.query("lat"));
    const lon = Number(c.req.query("lon"));
    const year = Number(c.req.query("year") ?? new Date().getFullYear());
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || !Number.isInteger(year)) throw new BadRequest("lat, lon, year attendus");
    return c.json(await identifyPoint(db(), c.get("farmId"), lat, lon, year));
  })
  // Création depuis la carte : parcelle, production de l'activité, références PAC et cadastre.
  .post("/land-parcels/from-map", requireOwner, async (c) => {
    const parsed = parcelCreateFromMap.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const farmId = c.get("farmId");
    const created = await createParcelFromMap(db(), farmId, domainCtx(c), parsed.data);
    // Références : au mieux (l'API Carto peut être injoignable ; « Actualiser » sur la fiche).
    await refreshReferences(db(), farmId, created.id).catch(() => null);
    return c.json(created, 201);
  })
  .get("/land-parcels/:id/sheet", async (c) => c.json(await parcelSheet(db(), c.get("farmId"), uuidParam(c, "id"))))
  // Itinéraire technique (lot T1) : `year` (campagne, défaut l'année en cours), `years` (1 à 20).
  .get("/land-parcels/:id/itinerary", async (c) => {
    const year = intQuery(c.req.query("year"), new Date().getFullYear(), 1900, 2200, "year");
    const years = intQuery(c.req.query("years"), 1, 1, 20, "years");
    return c.json(await parcelItinerary(db(), c.get("farmId"), uuidParam(c, "id"), year, years));
  })
  .post("/land-parcels/:id/references/refresh", requireOwner, async (c) => {
    try {
      return c.json(await refreshReferences(db(), c.get("farmId"), uuidParam(c, "id")));
    } catch (e) {
      if (e instanceof Error && /API Carto/.test(e.message)) return problem(c, 502, "API Carto indisponible", e.message);
      throw e;
    }
  })
  .post("/land-parcels", requireOwner, async (c) => {
    const parsed = landParcelWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const ctx = domainCtx(c);
    const version = await createParcel(db(), c.get("farmId"), ctx, {
      ...parsed.data,
      id: parsed.data.id ?? ctx.newId(),
    });
    return c.json(version, 201);
  })
  .patch("/land-parcels/:id", requireOwner, async (c) => {
    const parsed = landParcelWrite.omit({ id: true }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const version = await versionParcel(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data);
    return c.json(version);
  });
