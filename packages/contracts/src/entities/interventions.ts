import { z } from "zod";
import { uuid, farmId, isoDateTime, geoJsonGeometry, auditFields } from "../primitives.js";
import { treatmentPurpose } from "../procedures.js";

/**
 * Interventions (docs/interventions.md §4). Modèle simplifié par rapport à
 * Ekylibre : pas de `reference_name`, pas de « handlers » de quantité, pas de
 * formules. Une quantité est totale ou par hectare ; la procédure (sa forme)
 * dit ce que les cibles, intrants et sorties doivent être.
 */

export const interventionStatus = z.enum(["planned", "done", "cancelled"]);
export type InterventionStatus = z.infer<typeof interventionStatus>;

/**
 * Statut affiché (kanban) : « en cours » n'est pas stocké, il est calculé —
 * intervention planifiée dont la première période a commencé.
 */
export const interventionDisplayStatus = z.enum(["planned", "in_progress", "done", "cancelled"]);
export type InterventionDisplayStatus = z.infer<typeof interventionDisplayStatus>;

export const interventionOrigin = z.enum(["web", "mobile", "migration", "plugin"]);

/** Rôle d'une ligne de paramètre en base (stockage) ; l'API expose la forme structurée. */
export const parameterRole = z.enum(["target", "input", "output", "tool", "doer"]);
export type ParameterRole = z.infer<typeof parameterRole>;

/** Une quantité est totale, ou par hectare (× surface traitée à la date). */
export const quantityPer = z.enum(["total", "hectare"]);
export type QuantityPer = z.infer<typeof quantityPer>;

export const workPeriod = z.object({ startedAt: isoDateTime, stoppedAt: isoDateTime });
export type WorkPeriod = z.infer<typeof workPeriod>;

export const targetKind = z.enum(["land_parcel", "equipment", "place", "container"]);
export type TargetKind = z.infer<typeof targetKind>;

export const interventionTarget = z.object({
  kind: targetKind,
  id: uuid,
  /** Surface réellement traitée si l'intervention ne couvre qu'une partie de la parcelle. */
  workedAreaM2: z.number().positive().optional(),
  /** Zone de travail (ex. tirée de la trace GPS). */
  workingZone: geoJsonGeometry.optional(),
});
export type InterventionTarget = z.infer<typeof interventionTarget>;

const location = z
  .object({ placeId: uuid.optional(), containerId: uuid.optional() })
  .refine((l) => !(l.placeId && l.containerId), { message: "Un lieu OU une cuve, pas les deux." });

export const interventionInput = z.object({
  articleId: uuid,
  quantity: z.number().positive(),
  per: quantityPer,
  /** Lot consommé ; à défaut, le lot le mieux pourvu à la date. */
  lotId: uuid.optional(),
  /** Lieu de prélèvement ; à défaut, celui du lot. */
  from: location.optional(),
});
export type InterventionInput = z.infer<typeof interventionInput>;

export const interventionOutput = z.object({
  articleId: uuid,
  quantity: z.number().positive(),
  per: quantityPer,
  lotId: uuid.optional(),
  /** Destination (lieu ou cuve) : obligatoire à la réalisation. */
  to: location.optional(),
});
export type InterventionOutput = z.infer<typeof interventionOutput>;

export const interventionTool = z.object({ equipmentId: uuid });
export const interventionDoer = z.object({ personId: uuid });

/** Corps commun de saisie (planification ou réalisation). */
const interventionBody = z.object({
  procedure: z.string().min(1),
  periods: z.array(workPeriod).default([]),
  targets: z.array(interventionTarget).default([]),
  inputs: z.array(interventionInput).default([]),
  outputs: z.array(interventionOutput).default([]),
  tools: z.array(interventionTool).default([]),
  doers: z.array(interventionDoer).default([]),
  purposes: z.array(treatmentPurpose).default([]),
  notes: z.string().trim().max(2000).optional(),
});

/** Planification (POST /interventions). `id` client → idempotent. */
export const interventionPlanWrite = interventionBody.extend({
  id: uuid.optional(),
  /** Date prévue (début) si aucune période n'est encore connue. */
  plannedAt: isoDateTime.optional(),
});
export type InterventionPlanWrite = z.infer<typeof interventionPlanWrite>;

/** Réalisation (POST /interventions/:id/complete) : au moins une période. */
export const interventionCompleteWrite = interventionBody.omit({ procedure: true }).extend({
  periods: z.array(workPeriod).min(1, "Au moins une période de travail."),
});
export type InterventionCompleteWrite = z.infer<typeof interventionCompleteWrite>;

/**
 * Modification (PUT /interventions/:id). Planifiée : mise à jour directe.
 * Réalisée : correction tracée — mouvements contre-passés puis repassés,
 * historique conservé. Annulée : refusée. `correctionId` (UUID client) rend
 * la modification idempotente ; le motif est facultatif.
 */
export const interventionUpdateWrite = interventionBody.extend({
  correctionId: uuid.optional(),
  reason: z.string().trim().max(500).optional(),
  /** Date prévue (planifiée sans période). */
  plannedAt: isoDateTime.optional(),
});
export type InterventionUpdateWrite = z.infer<typeof interventionUpdateWrite>;

/** Intervention telle que lue (quantités accompagnées de l'unité de l'article). */
export const intervention = z
  .object({
    id: uuid,
    farmId,
    procedure: z.string(),
    status: interventionStatus,
    startedAt: isoDateTime.nullable(),
    stoppedAt: isoDateTime.nullable(),
    periods: z.array(workPeriod),
    targets: z.array(interventionTarget),
    inputs: z.array(interventionInput.extend({ unit: z.string() })),
    outputs: z.array(interventionOutput.extend({ unit: z.string() })),
    tools: z.array(interventionTool),
    doers: z.array(interventionDoer),
    purposes: z.array(treatmentPurpose),
    notes: z.string().nullable(),
    origin: interventionOrigin,
    clientId: z.string().nullable(),
  })
  .merge(auditFields);
export type Intervention = z.infer<typeof intervention>;

/** Entrée de l'historique d'une intervention (journal d'audit). */
export const interventionHistoryEntry = z.object({
  id: uuid,
  at: isoDateTime,
  action: z.string(), // planned | completed | updated | corrected | cancelled
  actor: z.string(),
  actorName: z.string().nullable(),
  origin: z.string(),
  reason: z.string().nullable(),
  /** Champ modifié → valeur avant / après (modifications et corrections). */
  changes: z.record(z.object({ before: z.unknown(), after: z.unknown() })).nullable(),
});
export type InterventionHistoryEntry = z.infer<typeof interventionHistoryEntry>;

/** Fiche (GET /interventions/:id) : l'intervention et son historique. */
export const interventionDetail = intervention.extend({ history: z.array(interventionHistoryEntry) });
export type InterventionDetail = z.infer<typeof interventionDetail>;

/** Résultat d'une modification : alertes non bloquantes (campagne close, stock négatif…). */
export const interventionUpdateResult = z.object({
  intervention,
  warnings: z.array(z.string()),
});
export type InterventionUpdateResult = z.infer<typeof interventionUpdateResult>;

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

/** Personne de la ferme (intervenant), avec ou sans compte Fourmy. */
export const person = z
  .object({
    id: uuid,
    farmId,
    name: z.string().min(1),
    role: z.string().nullable(),
    userId: uuid.nullable(),
    active: z.boolean(),
  })
  .merge(auditFields);
export type Person = z.infer<typeof person>;

export const personWrite = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(100).optional(),
  userId: uuid.optional(),
  active: z.boolean().optional(),
});
export type PersonWrite = z.infer<typeof personWrite>;

/** Membre d'une ferme : un compte et son rôle, avec la personne qui lui est rattachée. */
export const farmMember = z.object({
  userId: uuid,
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(["owner", "worker"]),
  personId: uuid.nullable(),
});
export type FarmMember = z.infer<typeof farmMember>;
