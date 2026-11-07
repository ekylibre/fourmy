import { z } from "zod";
import {
  uuid,
  farmId,
  isoDateTime,
  geoJsonGeometry,
  auditFields,
} from "../primitives.js";

/** Rôle d'un paramètre d'intervention (procédures Ekylibre simplifiées). */
export const parameterRole = z.enum([
  "target", // cible : parcelle, culture, zone
  "input", // intrant : phyto, engrais, semence
  "output", // sortie : récolte, moût
  "tool", // outil : matériel
  "doer", // intervenant
]);
export type ParameterRole = z.infer<typeof parameterRole>;

export const interventionParameter = z.object({
  id: uuid,
  interventionId: uuid,
  role: parameterRole,
  refType: z.string(), // land_parcel, article, equipment, worker…
  refId: uuid.nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  workingZone: geoJsonGeometry.optional(),
});
export type InterventionParameter = z.infer<typeof interventionParameter>;

export const interventionStatus = z.enum(["planned", "done"]);
export const interventionOrigin = z.enum([
  "web",
  "mobile",
  "migration",
  "plugin",
]);

export const intervention = z
  .object({
    id: uuid,
    farmId,
    procedure: z.string(), // référence au catalogue de procédures
    status: interventionStatus,
    startedAt: isoDateTime.nullable(),
    stoppedAt: isoDateTime.nullable(),
    origin: interventionOrigin,
    clientId: z.string().nullable(), // idempotence de la synchro mobile
    parameters: z.array(interventionParameter).default([]),
  })
  .merge(auditFields);
export type Intervention = z.infer<typeof intervention>;

/** Planification d'une intervention (POST). */
export const interventionPlanWrite = z.object({
  id: uuid.optional(),
  procedure: z.string(),
  startedAt: isoDateTime.optional(),
  parameters: z.array(interventionParameter.omit({ id: true, interventionId: true })),
});
export type InterventionPlanWrite = z.infer<typeof interventionPlanWrite>;

/** Réalisation (POST /:id/complete) : génère les mouvements de stock. */
export const interventionCompleteWrite = z.object({
  startedAt: isoDateTime,
  stoppedAt: isoDateTime,
  parameters: z.array(interventionParameter.omit({ id: true, interventionId: true })),
});
export type InterventionCompleteWrite = z.infer<typeof interventionCompleteWrite>;

/** Ligne du registre phytosanitaire — calculée, jamais saisie (§4.4). */
export const phytoRegisterEntry = z.object({
  interventionId: uuid,
  doneOn: isoDateTime,
  parcelName: z.string(),
  areaM2: z.number(),
  crop: z.string().optional(),
  productName: z.string(),
  amm: z.string().optional(),
  quantity: z.number(),
  unit: z.string(),
});
export type PhytoRegisterEntry = z.infer<typeof phytoRegisterEntry>;
