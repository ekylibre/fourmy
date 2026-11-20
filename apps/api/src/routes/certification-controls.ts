import { Hono } from "hono";
import { z } from "zod";
import { certificationSettings, controlKind, interventionPlanWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  checkInterventionCertificationFor,
  controlAvailability,
  controlReport,
  getCertificationSettings,
  putCertificationSettings,
} from "../repos/certification-controls.js";
import { BadRequest, intQuery, problem } from "./helpers.js";

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
    const { interventionId: _id, ...body } = parsed.data;
    return c.json({ check: await checkInterventionCertificationFor(db(), c.get("farmId"), body) });
  })
  .get("/settings/certification", async (c) => c.json(await getCertificationSettings(db(), c.get("farmId"))))
  .put("/settings/certification", requireOwner, async (c) => {
    const parsed = certificationSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    return c.json(await putCertificationSettings(db(), c.get("farmId"), parsed.data));
  })
  // Rapport d'une campagne : `hve` ou `ab`.
  .get("/control/:kind", async (c) => {
    const kind = controlKind.safeParse(c.req.param("kind"));
    if (!kind.success) throw new BadRequest("Contrôle inconnu : hve ou ab.");
    return c.json(await controlReport(db(), c.get("farmId"), kind.data, campaignOf(c.req.query("campaign"))));
  });
