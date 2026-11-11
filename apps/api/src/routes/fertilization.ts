import { Hono } from "hono";
import { coverCropWrite, DOCUMENT_OWNER_TYPES, type DocumentOwnerType } from "@fourmy/contracts";
import { fertilizationCheckRequest, fertilizationSettingsWrite, nitrateZoneWrite, planDraft, planEstablish, soilAnalysisWrite, soilProfileWrite, waterSourceWrite } from "@fourmy/contracts";
import { establishPlan, getPlan, listPlans, preparePlans, saveDraft } from "../repos/fertilization-plans.js";
import { checkApplication, fertilizationRecord } from "../repos/fertilization-record.js";
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
import { deleteCoverCrop, saveCoverCrop } from "../repos/cover-crops.js";
import { addDocument, deleteDocument, listDocuments, readDocument } from "../repos/regulatory-documents.js";
import { BadRequest, problem, uuidParam } from "./helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ownerOf = (type: unknown, id: unknown): { ownerType: DocumentOwnerType; ownerId: string } => {
  if (typeof type !== "string" || !(DOCUMENT_OWNER_TYPES as readonly string[]).includes(type)) throw new BadRequest(`ownerType : ${DOCUMENT_OWNER_TYPES.join(", ")}.`);
  if (typeof id !== "string" || !UUID.test(id)) throw new BadRequest("ownerId : identifiant attendu.");
  return { ownerType: type as DocumentOwnerType, ownerId: id };
};

/** Météo (Open-Meteo) des plans de fumure, remplaçable dans les tests. */
export const fertilizationDeps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const campaignOf = (v: string | undefined) => {
  const n = Number(v ?? new Date().getFullYear());
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new BadRequest("campaign : année attendue.");
  return n;
};

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
  // Plans prévisionnels de fumure (lot AG).
  .get("/fertilization/plans", async (c) => c.json({ items: await listPlans(db(), c.get("farmId"), campaignOf(c.req.query("campaign")), fertilizationDeps.fetch) }))
  .post("/fertilization/plans/prepare", requireOwner, async (c) => c.json(await preparePlans(db(), c.get("farmId"), campaignOf(c.req.query("campaign")))))
  .get("/fertilization/plans/:id", async (c) => c.json(await getPlan(db(), c.get("farmId"), uuidParam(c, "id"), fertilizationDeps.fetch)))
  .put("/fertilization/plans/:id/draft", requireOwner, async (c) => {
    const parsed = planDraft.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    await saveDraft(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data);
    return c.json(await getPlan(db(), c.get("farmId"), uuidParam(c, "id"), fertilizationDeps.fetch));
  })
  .post("/fertilization/plans/:id/establish", requireOwner, async (c) => {
    const parsed = planEstablish.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await establishPlan(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data.reason, fertilizationDeps.fetch));
  })
  // Contrôles à la saisie et cahier d'enregistrement (lot AH).
  .post("/fertilization/check", async (c) => {
    const parsed = fertilizationCheckRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await checkApplication(db(), c.get("farmId"), parsed.data));
  })
  .get("/fertilization/record", async (c) => {
    const record = await fertilizationRecord(db(), c.get("farmId"), campaignOf(c.req.query("campaign")));
    if (c.req.query("format") !== "csv") return c.json(record);
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Parcelle", "Surface (ha)", "Culture", "Variété", "Semis", "Date d'apport", "Surface épandue (ha)", "Produit", "Teneur", "Type", "Dose", "N total (kg/ha)", "N efficace (kg/ha)", "Saisi le", "Récolte", "Rendement (q/ha)", "Dose prévue (kg N/ha)"].map(q).join(";"),
      ...record.parcels.flatMap((p) =>
        (p.applications.length ? p.applications : [null]).map((a) =>
          [p.name, p.areaHa, p.crop, p.variety, p.sownOn, a?.date, a?.areaHa, a?.product, a?.content, a?.nitrateType, a?.doseLabel, a?.nTotalKgHa, a?.nEfficientKgHa, a?.recordedOn, p.harvestedOn.join(" "), p.yieldQHa, p.plannedDose]
            .map((v) => (typeof v === "number" ? q(String(v).replace(".", ",")) : q(v)))
            .join(";"),
        ),
      ),
    ];
    return c.body(`\ufeff${lines.join("\r\n")}\r\n`, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cahier-fertilisation-${record.campaign}.csv"`,
    });
  })
  // Couverts d'interculture (lot AI)
  .put("/land-parcels/:id/cover-crop", requireOwner, async (c) => {
    const parsed = coverCropWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveCoverCrop(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  .delete("/land-parcels/:id/cover-crop", requireOwner, async (c) => {
    await deleteCoverCrop(db(), c.get("farmId"), uuidParam(c, "id"), campaignOf(c.req.query("campaign")));
    return c.body(null, 204);
  })
  // Justificatifs (lot AI) : envoi multipart `file`, `ownerType`, `ownerId`.
  .get("/fertilization/documents", async (c) => {
    const o = ownerOf(c.req.query("ownerType"), c.req.query("ownerId"));
    return c.json({ items: await listDocuments(db(), c.get("farmId"), o.ownerType, o.ownerId) });
  })
  .post("/fertilization/documents", requireOwner, async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    if (!(body?.file instanceof File)) throw new BadRequest("Fichier « file » attendu (multipart/form-data).");
    const o = ownerOf(body.ownerType, body.ownerId);
    return c.json(await addDocument(db(), c.get("farmId"), c.get("userId"), { ...o, name: body.file.name, bytes: new Uint8Array(await body.file.arrayBuffer()) }), 201);
  })
  .get("/fertilization/documents/:id", async (c) => {
    const d = await readDocument(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(new Uint8Array(d.bytes), 200, {
      "content-type": d.contentType,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
    });
  })
  .delete("/fertilization/documents/:id", requireOwner, async (c) => {
    await deleteDocument(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  })
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
