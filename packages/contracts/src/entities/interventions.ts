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

/**
 * Indications de stock d'un intrant / d'une sortie. Toutes facultatives pour
 * un intrant (le serveur choisit lot et lieu) ; le lieu est obligatoire pour
 * une sortie (on ne range pas une récolte « nulle part »).
 */
export const stockHint = z.object({
  lotId: uuid.optional(),
  placeId: uuid.optional(),
  containerId: uuid.optional(),
  /** Quantité absolue, dans l'unité de l'article (prime sur le calcul dose × surface). */
  quantity: z.number().positive().optional(),
});
export type StockHint = z.infer<typeof stockHint>;

/** Paramètre saisi (sans identifiants serveur), avec indications de stock. */
export const interventionParameterWrite = interventionParameter
  .omit({ id: true, interventionId: true })
  .extend({ stock: stockHint.optional() });
export type InterventionParameterWrite = z.infer<typeof interventionParameterWrite>;

/** Planification d'une intervention (POST). `id` client → idempotent. */
export const interventionPlanWrite = z.object({
  id: uuid.optional(),
  procedure: z.string().min(1),
  startedAt: isoDateTime.optional(),
  parameters: z.array(interventionParameterWrite),
});
export type InterventionPlanWrite = z.infer<typeof interventionPlanWrite>;

/** Réalisation (POST /:id/complete) : paramètres réels, mouvements de stock. */
export const interventionCompleteWrite = z.object({
  startedAt: isoDateTime,
  stoppedAt: isoDateTime,
  parameters: z.array(interventionParameterWrite),
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
