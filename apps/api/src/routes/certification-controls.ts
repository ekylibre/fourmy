import { Hono } from "hono";
import { z } from "zod";
import { articleCopperWrite, certificationSettings, controlKind, interventionPlanWrite, landscapeFeatureHveWrite, productionCertificationWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  abParcelStatuses,
  checkInterventionCertificationFor,
  hveIaeList,
  hveIrrigatedParcels,
  putLandscapeFeatureHve,
  controlAvailability,
  controlReport,
  getCertificationSettings,
  putArticleCopper,
  putCertificationSettings,
  putProductionCertification,
} from "../repos/certification-controls.js";
import { BadRequest, intQuery, problem, uuidParam } from "./helpers.js";

const checkWrite = interventionPlanWrite.extend({ interventionId: z.string().uuid().optional() });

/** Campagne demandée (`?campaign=`), l'année en cours par défaut. */
const campaignOf = (raw: string | undefined) => (raw === undefined ? new Date().getFullYear() : intQuery(raw, 0, 2000, 2100, "campaign"));

/**
 * Contrôles HVE et Agriculture biologique (lot CT1,
 * claudedocs/conception_controle_hve_ab.md §6) : lecture par les membres,
 * réglages par le responsable.
 */
export const certificationControlRoutes = new Hono<Env>()
  // Menu Réglementaire (D2) : certification de parcelle active pendant la campagne.
  .get("/control/availability", async (c) => c.json(await controlAvailability(db(), c.get("farmId"), campaignOf(c.req.query("campaign")))))
  // Constats de certification d'un brouillon d'intervention (formulaire), sans écriture.
  .post("/control/check", async (c) => {
    const parsed = checkWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const { interventionId, ...body } = parsed.data;
    return c.json({ check: await checkInterventionCertificationFor(db(), c.get("farmId"), body, interventionId ?? null) });
  })
  .get("/settings/certification", async (c) => c.json(await getCertificationSettings(db(), c.get("farmId"))))
  .put("/settings/certification", requireOwner, async (c) => {
    const parsed = certificationSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await putCertificationSettings(db(), c.get("farmId"), parsed.data));
  })
  // Cuivre métal d'un produit (contrôle AB) : quand E-Phy ne permet pas de la déduire.
  .put("/articles/:id/copper", requireOwner, async (c) => {
    const parsed = articleCopperWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    await putArticleCopper(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data);
    return c.body(null, 204);
  })
  // Cycle, date de plantation, mode de culture d'une production (conversion AB).
  .put("/productions/:id/certification", requireOwner, async (c) => {
    const parsed = productionCertificationWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await putProductionCertification(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data));
  })
  // IAE de la campagne HVE (onglet IAE) et leur validation.
  .get("/control/hve/iae", async (c) => c.json(await hveIaeList(db(), c.get("farmId"), campaignOf(c.req.query("campaign")))))
  .put("/landscape-features/:id/hve", requireOwner, async (c) => {
    const parsed = landscapeFeatureHveWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    await putLandscapeFeatureHve(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data);
    return c.body(null, 204);
  })
  // Parcelles irriguées de la campagne HVE (onglet Irrigation).
  .get("/control/hve/irrigated", async (c) => c.json(await hveIrrigatedParcels(db(), c.get("farmId"), campaignOf(c.req.query("campaign")))))
  // Statut de conversion des parcelles AB (onglet Parcelles).
  .get("/control/ab/parcels", async (c) => c.json(await abParcelStatuses(db(), c.get("farmId"), campaignOf(c.req.query("campaign")))))
  // Rapport d'une campagne : `hve` ou `ab`.
  .get("/control/:kind", async (c) => {
    const kind = controlKind.safeParse(c.req.param("kind"));
    if (!kind.success) throw new BadRequest("Contrôle inconnu : hve ou ab.");
    return c.json(await controlReport(db(), c.get("farmId"), kind.data, campaignOf(c.req.query("campaign"))));
  });
