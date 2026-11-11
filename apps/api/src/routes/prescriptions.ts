import { Hono } from "hono";
import { prescriptionRates, prescriptionSendRequest, prescriptionWrite, zoningRequest, type PrescriptionFormat } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { connectedAgrirouter, agrirouterRecipients } from "../integrations/agrirouter.js";
import { isVegetationIndex } from "../repos/remote-sensing.js";
import {
  createPrescription,
  deletePrescription,
  getPrescription,
  listPrescriptions,
  modulationDates,
  prescriptionFile,
  sendPrescription,
  updatePrescriptionRates,
  zoning,
} from "../repos/prescriptions.js";
import { withFarm } from "@fourmy/db";
import { BadRequest, problem, uuidParam } from "./helpers.js";

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ");

/**
 * Cartes de modulation (lot AD, docs/modulation.md). Lecture et
 * téléchargement pour les membres ; zonage (requêtes Copernicus de la ferme),
 * enregistrement et envoi aux machines pour le responsable.
 */
export const prescriptionRoutes = new Hono<Env>()
  .get("/land-parcels/:id/modulation-dates", async (c) => {
    const index = c.req.query("index") ?? "ndvi";
    if (!isVegetationIndex(index)) throw new BadRequest("Indice inconnu (ndvi, ndre ou ndmi).");
    return c.json({ items: await modulationDates(db(), c.get("farmId"), uuidParam(c, "id"), index) });
  })
  .post("/prescriptions/zoning", requireOwner, async (c) => {
    const parsed = zoningRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await zoning(db(), c.get("farmId"), parsed.data));
  })
  .get("/prescriptions", async (c) => {
    const parcel = c.req.query("parcel");
    return c.json({ items: await listPrescriptions(db(), c.get("farmId"), parcel ? uuidParam(c, "parcel", "query") : undefined) });
  })
  .post("/prescriptions", requireOwner, async (c) => {
    const parsed = prescriptionWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await createPrescription(db(), c.get("farmId"), c.get("userId"), parsed.data), 201);
  })
  // Destinataires agrirouter joignables (machines, logiciels), lus en direct.
  .get("/prescriptions/recipients", async (c) => {
    const { tenantId, settings } = await withFarm(db(), c.get("farmId"), connectedAgrirouter);
    return c.json(await agrirouterRecipients(tenantId, settings.endpointId));
  })
  .get("/prescriptions/:id", async (c) => c.json(await getPrescription(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/prescriptions/:id/rates", requireOwner, async (c) => {
    const parsed = prescriptionRates.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await updatePrescriptionRates(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data.rates));
  })
  .delete("/prescriptions/:id", requireOwner, async (c) => {
    await deletePrescription(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  })
  .get("/prescriptions/:id/files/:format", async (c) => {
    const format = c.req.param("format") as PrescriptionFormat;
    if (format !== "isoxml" && format !== "shape") throw new BadRequest("Format inconnu (isoxml ou shape).");
    const file = await prescriptionFile(db(), c.get("farmId"), uuidParam(c, "id"), format);
    return c.body(file.bytes as unknown as ArrayBuffer, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "no-store",
    });
  })
  .post("/prescriptions/:id/send", requireOwner, async (c) => {
    const parsed = prescriptionSendRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await sendPrescription(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data));
  });
