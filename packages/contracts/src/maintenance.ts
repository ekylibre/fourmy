import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/** Plan d'entretien et échéances, lot J (docs/materiels-entretien-design.md). */

export const operationKind = z.enum(["inspection", "cleaning", "greasing", "replacement", "oil_change", "adjustment", "bleeding", "visit"]);
export type OperationKind = z.infer<typeof operationKind>;

export const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  inspection: "Contrôle",
  cleaning: "Nettoyage",
  greasing: "Graissage",
  replacement: "Remplacement",
  oil_change: "Vidange",
  adjustment: "Réglage",
  bleeding: "Purge",
  visit: "Visite initiale",
};

export const performer = z.enum(["member", "workshop"]);
export const PERFORMER_LABELS: Record<z.infer<typeof performer>, string> = { member: "Exploitant", workshop: "Atelier agréé" };

export const dueStatus = z.enum(["overdue", "soon", "ok", "unknown", "on_demand", "done", "not_applicable"]);
export type DueStatus = z.infer<typeof dueStatus>;
export const DUE_STATUS_LABELS: Record<DueStatus, string> = {
  overdue: "En retard",
  soon: "Bientôt",
  ok: "À jour",
  unknown: "À renseigner",
  on_demand: "Selon besoin",
  done: "Réalisée",
  not_applicable: "Non applicable",
};

export const due = z.object({
  operationId: z.string(),
  status: dueStatus,
  last: z.object({ at: isoDateTime, usage: z.number().nullable(), source: z.enum(["intervention", "baseline", "commissioning"]) }).nullable(),
  nextUsage: z.number().nullable(),
  nextDate: isoDateTime.nullable(),
  remainingHours: z.number().nullable(),
  remainingDays: z.number().nullable(),
  usageNow: z.number().nullable(),
  reason: z.string().nullable(),
});
export type DueView = z.infer<typeof due>;

const source = z.object({ id: z.string(), page: z.unknown() }).nullable();

export const planOperation = z.object({
  id: uuid,
  code: z.string().nullable(),
  label: z.string(),
  kind: operationKind,
  everyHours: z.number().nullable(),
  everyMonths: z.number().nullable(),
  firstHours: z.number().nullable(),
  performer,
  requiresOption: z.string().nullable(),
  condition: z.string().nullable(),
  source,
  baselineAt: isoDateTime.nullable(),
  baselineHours: z.number().nullable(),
  archivedAt: isoDateTime.nullable(),
  archivedReason: z.string().nullable(),
  /** Copiée d'un modèle (sinon ajoutée par la ferme). */
  fromModel: z.boolean(),
  parts: z.array(z.object({ articleId: uuid, name: z.string(), reference: z.string().nullable(), quantity: z.number(), unit: z.string() })),
});
export type PlanOperation = z.infer<typeof planOperation>;

export const planOperationWrite = z
  .object({
    label: z.string().trim().min(1).max(200),
    kind: operationKind,
    everyHours: z.number().positive().max(100_000).nullable().optional(),
    everyMonths: z.number().int().positive().max(240).nullable().optional(),
    firstHours: z.number().positive().max(100_000).nullable().optional(),
    performer: performer.default("member"),
    condition: z.string().trim().max(500).nullable().optional(),
    archived: z.boolean().default(false),
  })
  .refine((o) => o.everyHours || o.everyMonths || o.firstHours || o.kind !== "visit", { message: "Une visite initiale a un nombre d'heures." });
export type PlanOperationWrite = z.infer<typeof planOperationWrite>;

/** « Dernière fois connue » : amorce une échéance sans intervention. */
export const baselineWrite = z.object({ at: isoDateTime.nullable(), hours: z.number().min(0).max(1_000_000).nullable() });
export type BaselineWrite = z.infer<typeof baselineWrite>;

export const maintenanceSettings = z.object({
  soonHours: z.number().min(0).max(1000).default(50),
  soonMonths: z.number().min(0).max(12).default(1),
  /** Membres prévenus par e-mail des échéances « bientôt » et « en retard » (FR-MAT-25). */
  notify: z.array(uuid).max(50).default([]),
});
export type MaintenanceSettings = z.infer<typeof maintenanceSettings>;

export const equipmentFluid = z.object({
  id: uuid,
  organ: z.string(),
  fluid: z.string(),
  standard: z.string().nullable(),
  viscosity: z.string().nullable(),
  capacity: z.string().nullable(),
  capacityMaxL: z.number().nullable(),
  note: z.string().nullable(),
  source,
});
export type EquipmentFluid = z.infer<typeof equipmentFluid>;

export const equipmentPart = z.object({
  id: uuid,
  articleId: uuid,
  name: z.string(),
  reference: z.string().nullable(),
  family: z.string().nullable(),
  quantity: z.number().nullable(),
  catalog: z.record(z.string(), z.string().nullable()).nullable(),
  note: z.string().nullable(),
  operations: z.array(z.string()),
});
export type EquipmentPart = z.infer<typeof equipmentPart>;

/** Entretien d'un matériel à une date : plan, échéances triées par urgence, fluides, pièces. */
export const equipmentMaintenance = z.object({
  equipmentId: uuid,
  at: isoDateTime,
  settings: maintenanceSettings,
  usageNow: z.number().nullable(),
  /** Heures du jour = dernier relevé + heures estimées par Traccar. */
  usageEstimated: z.boolean().default(false),
  model: z.object({ id: uuid, label: z.string(), warning: z.string().nullable(), sources: z.array(z.unknown()) }).nullable(),
  operations: z.array(planOperation.extend({ due })),
  fluids: z.array(equipmentFluid),
  parts: z.array(equipmentPart),
});
export type EquipmentMaintenance = z.infer<typeof equipmentMaintenance>;

/** Ligne du tableau de bord de l'entretien (FR-MAT-24). */
export const farmDueItem = z.object({
  equipmentId: uuid,
  equipmentName: z.string(),
  equipmentKind: z.string(),
  operationId: uuid,
  label: z.string(),
  kind: operationKind,
  performer,
  due,
});
export type FarmDueItem = z.infer<typeof farmDueItem>;

export const equipmentModelSummary = z.object({
  id: uuid,
  brand: z.string(),
  model: z.string(),
  manufacturerType: z.string().nullable(),
  operations: z.number(),
  own: z.boolean(),
});
export type EquipmentModelSummary = z.infer<typeof equipmentModelSummary>;

/** Import d'un dossier de la base matériel : chemins relatifs → contenu texte. */
export const equipmentBundleWrite = z.object({
  equipmentId: uuid.nullable().optional(),
  files: z.record(z.string(), z.string().max(5_000_000)).refine((f) => Object.keys(f).length <= 20, "20 fichiers au plus."),
});
export type EquipmentBundleWrite = z.infer<typeof equipmentBundleWrite>;

export const equipmentBundleResult = z.object({
  runId: uuid,
  equipmentId: uuid,
  modelId: uuid,
  created: z.boolean(),
  report: z.object({
    model: z.string(),
    operationsAdded: z.number(),
    operationsKept: z.number(),
    notApplicable: z.array(z.string()),
    fluids: z.number(),
    parts: z.number(),
    articlesCreated: z.number(),
    warnings: z.array(z.string()),
  }),
});
export type EquipmentBundleResult = z.infer<typeof equipmentBundleResult>;

/** Pièces à commander pour un horizon (FR-MAT-42). */
export const partsToOrder = z.object({
  at: isoDateTime,
  horizon: z.object({ hours: z.number().nullable(), months: z.number().nullable() }),
  items: z.array(
    z.object({
      articleId: uuid,
      name: z.string(),
      reference: z.string().nullable(),
      family: z.string().nullable(),
      unit: z.string(),
      needed: z.number(),
      inStock: z.number(),
      toOrder: z.number(),
      operations: z.array(z.string()),
      equipments: z.array(z.string()),
    }),
  ),
});
export type PartsToOrder = z.infer<typeof partsToOrder>;
