import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/**
 * Matériels, lot I (docs/materiels-entretien-design.md) : fiche d'identité,
 * compteur, relevés, marques de la ferme, logo 2D.
 */

/** Natures de matériel (codes Ekylibre conservés) et libellés. */
export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  tractor: "Tracteur",
  self_propelled_equipment: "Automoteur",
  trailed_equipment: "Outil traîné",
  equipment: "Matériel",
  fixed_equipment: "Équipement fixe",
  connected_object: "Objet connecté",
};
export const equipmentKindLabel = (kind: string) => EQUIPMENT_KIND_LABELS[kind] ?? kind;

export const EQUIPMENT_STATE_LABELS: Record<string, string> = { active: "En service", retired: "Réformé", sold: "Vendu" };
export const equipmentStateLabel = (state: string | null | undefined) => (state ? (EQUIPMENT_STATE_LABELS[state] ?? state) : "En service");

/** Natures qui ont un compteur d'heures par défaut. */
export const METERED_KINDS = ["tractor", "self_propelled_equipment"];

export const meterUnit = z.enum(["hours"]);
export const meterOrigin = z.enum(["manual", "intervention", "reference", "traccar"]);
export type MeterOrigin = z.infer<typeof meterOrigin>;
export const meterCorrection = z.enum(["fix", "replacement"]);

export const METER_ORIGIN_LABELS: Record<MeterOrigin, string> = {
  manual: "Saisi",
  intervention: "Intervention",
  reference: "Référence",
  traccar: "Traccar",
};

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur #RRGGBB attendue");

export const equipmentAggregate = z.object({
  organ: z.string().trim().min(1).max(80),
  designation: z.string().trim().max(120).optional(),
  serial: z.string().trim().max(120).optional(),
});
export type EquipmentAggregate = z.infer<typeof equipmentAggregate>;

export const equipmentOption = z.object({
  id: uuid,
  code: z.string(),
  label: z.string(),
  from: isoDateTime,
  to: isoDateTime.nullable(),
});
export type EquipmentOption = z.infer<typeof equipmentOption>;

export const equipmentOptionWrite = z.object({
  code: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "Code en minuscules, chiffres et _"),
  label: z.string().trim().min(1).max(120),
  from: isoDateTime,
  to: isoDateTime.nullable().optional(),
});
export type EquipmentOptionWrite = z.infer<typeof equipmentOptionWrite>;

const externalIds = z.record(z.string().max(120)).default({});

/** Création ou modification de la fiche (responsable). */
export const equipmentWrite = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(60),
  state: z.string().trim().max(30).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serialNumber: z.string().trim().max(80).nullable().optional(),
  manufacturerType: z.string().trim().max(80).nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  meterUnit: meterUnit.nullable().optional(),
  commissionedAt: isoDateTime.nullable().optional(),
  aggregates: z.array(equipmentAggregate).max(30).default([]),
  externalIds,
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type EquipmentWrite = z.infer<typeof equipmentWrite>;

export const lastReading = z.object({ readAt: isoDateTime, value: z.number(), origin: meterOrigin });

/** Ligne de la liste des matériels. */
export const equipmentSummary = z.object({
  id: uuid,
  name: z.string(),
  kind: z.string(),
  state: z.string().nullable(),
  brand: z.string().nullable(),
  brandId: uuid.nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  year: z.number().nullable(),
  meterUnit: meterUnit.nullable(),
  /** Logo affiché : celui du matériel, sinon celui de sa marque. */
  logoAssetId: uuid.nullable(),
  logoSource: z.enum(["equipment", "brand"]).nullable(),
  lastReading: lastReading.nullable(),
  tracked: z.boolean(),
  /** Échéances du plan d'entretien (null : pas de plan). */
  due: z.object({ overdue: z.number(), soon: z.number(), unknown: z.number() }).nullable().optional(),
});
export type EquipmentSummary = z.infer<typeof equipmentSummary>;

export const meterReading = z.object({
  id: uuid,
  equipmentId: uuid,
  readAt: isoDateTime,
  value: z.number(),
  /** Heures d'usage sur l'échelle continue (corrections et remplacements compris). */
  usage: z.number(),
  status: z.enum(["valid", "superseded"]),
  origin: meterOrigin,
  correction: meterCorrection.nullable(),
  correctionReason: z.string().nullable(),
  interventionId: uuid.nullable(),
  authorName: z.string().nullable(),
  note: z.string().nullable(),
});
export type MeterReading = z.infer<typeof meterReading>;

export const meterReadingWrite = z
  .object({
    /** UUID client (mobile, saisie hors ligne) : relevé idempotent. */
    id: uuid.optional(),
    readAt: isoDateTime,
    value: z.number().min(0).max(1_000_000),
    correction: meterCorrection.nullable().optional(),
    correctionReason: z.string().trim().max(500).nullable().optional(),
    origin: z.enum(["manual", "reference"]).default("manual"),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((r) => !r.correction || !!r.correctionReason, { message: "Une correction de compteur doit être motivée.", path: ["correctionReason"] });
export type MeterReadingWrite = z.input<typeof meterReadingWrite>;

export const meterReadingResult = z.object({
  reading: meterReading,
  /** Avertissement non bloquant (compteur qui avance plus vite que l'horloge). */
  warning: z.string().nullable(),
});
export type MeterReadingResult = z.infer<typeof meterReadingResult>;

export const farmBrand = z.object({ id: uuid, name: z.string(), color: z.string().nullable(), logoAssetId: uuid.nullable(), equipments: z.number() });
export type FarmBrand = z.infer<typeof farmBrand>;
export const farmBrandWrite = z.object({ name: z.string().trim().min(1).max(80), color: hexColor.nullable().optional() });
export type FarmBrandWrite = z.infer<typeof farmBrandWrite>;

export const equipmentHistoryEntry = z.object({
  interventionId: uuid,
  procedure: z.string(),
  status: z.string(),
  startedAt: isoDateTime.nullable(),
  /** Le matériel est la cible (entretien) ou un outil (chantier). */
  role: z.enum(["target", "tool"]),
  parcels: z.array(z.string()),
});
export type EquipmentHistoryEntry = z.infer<typeof equipmentHistoryEntry>;

/** Fiche complète d'un matériel. */
export const equipmentSheet = equipmentSummary.extend({
  manufacturerType: z.string().nullable(),
  commissionedAt: isoDateTime.nullable(),
  aggregates: z.array(equipmentAggregate),
  technical: z.unknown().nullable(),
  externalIds: z.record(z.string()),
  notes: z.string().nullable(),
  brandInfo: farmBrand.nullable(),
  options: z.array(equipmentOption),
  readings: z.array(meterReading),
  history: z.array(equipmentHistoryEntry),
  trackers: z.array(z.object({ deviceId: z.string(), from: isoDateTime, to: isoDateTime.nullable() })),
  /** Heures estimées aujourd'hui (Traccar) : dernier relevé + heures de fonctionnement des jours suivants. */
  estimate: z.object({ usage: z.number(), estimatedHours: z.number(), since: isoDateTime }).nullable().optional(),
  /** Heures de fonctionnement par jour (Traccar), 90 derniers jours. */
  usageDays: z.array(z.object({ day: z.string(), hours: z.number() })).optional(),
});
export type EquipmentSheet = z.infer<typeof equipmentSheet>;
