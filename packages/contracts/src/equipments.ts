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

/**
 * Types de matériel (fiche) : plus fins que la nature Ekylibre. Chacun porte
 * sa nature et, dans @fourmy/equipment-3d (TEMPLATE_FOR_TYPE), son avatar 3D
 * de base. Ajouter un type ici impose de lui donner un gabarit là-bas
 * (test apps/api/test/equipment-types.test.ts).
 */
export const EQUIPMENT_TYPES = {
  tractor: { label: "Tracteur", kind: "tractor" },
  self_propelled: { label: "Automoteur", kind: "self_propelled_equipment" },
  sower: { label: "Semoir", kind: "trailed_equipment" },
  rotary_harrow: { label: "Herse rotative", kind: "trailed_equipment" },
  plough: { label: "Charrue", kind: "trailed_equipment" },
  disc_harrow: { label: "Déchaumeur à disques", kind: "trailed_equipment" },
  cultivator: { label: "Cultivateur, vibroculteur", kind: "trailed_equipment" },
  roller: { label: "Rouleau", kind: "trailed_equipment" },
  shredder: { label: "Broyeur", kind: "trailed_equipment" },
  mounted_sprayer: { label: "Pulvérisateur porté", kind: "trailed_equipment" },
  trailed_sprayer: { label: "Pulvérisateur traîné", kind: "trailed_equipment" },
  fertilizer_spreader: { label: "Épandeur d'engrais", kind: "trailed_equipment" },
  trailer: { label: "Remorque", kind: "trailed_equipment" },
  other_tool: { label: "Autre outil", kind: "trailed_equipment" },
  fixed_equipment: { label: "Équipement fixe", kind: "fixed_equipment" },
  connected_object: { label: "Objet connecté", kind: "connected_object" },
} as const satisfies Record<string, { label: string; kind: keyof typeof EQUIPMENT_KIND_LABELS }>;
export type EquipmentType = keyof typeof EQUIPMENT_TYPES;
export const equipmentType = z.enum(Object.keys(EQUIPMENT_TYPES) as [EquipmentType, ...EquipmentType[]]);
export const equipmentTypeLabel = (type: string | null | undefined) => (type ? (EQUIPMENT_TYPES[type as EquipmentType]?.label ?? type) : null);

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

const externalIds = z.record(z.string(), z.string().max(120)).default({});

/** Création ou modification de la fiche (responsable). */
export const equipmentWrite = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(60),
  /** Type de matériel : il porte l'avatar 3D de base. */
  type: equipmentType.nullable().optional(),
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
  /** Type saisi ; null : non renseigné (l'avatar se déduit alors du nom). */
  type: equipmentType.nullable().optional(),
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
  externalIds: z.record(z.string(), z.string()),
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

// ---------------------------------------------------------------------------
// Avatar 3D (lot M)
// ---------------------------------------------------------------------------

/** Gabarits d'avatar : la liste AVATAR_TEMPLATES de @fourmy/equipment-3d (même test). */
export const avatarTemplate = z.enum([
  "tractor",
  "self_propelled",
  "sower",
  "rotary_harrow",
  "plough",
  "mounted_sprayer",
  "fertilizer_spreader",
  "disc_harrow",
  "roller",
  "mounted_tool",
  "trailed_tool",
  "trailed_sprayer",
  "trailer",
  "box",
]);
const meters = z.number().positive().max(60).nullable().optional();
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional();

/** Réglage de l'avatar : seulement les valeurs saisies (null = valeur déduite). */
export const avatarWrite = z.object({
  template: avatarTemplate.nullable().optional(),
  lengthM: meters,
  widthM: meters,
  heightM: meters,
  wheelbaseM: meters,
  frontWheelDiameterM: meters,
  rearWheelDiameterM: meters,
  workingWidthM: meters,
  hitchOffsetM: meters,
  colors: z.object({ body: color, cab: color, wheels: color, accent: color }).partial().nullable().optional(),
  logo: z.enum(["sides", "none"]).nullable().optional(),
});
export type AvatarWrite = z.infer<typeof avatarWrite>;

export const avatarInfo = z.object({
  /** Paramètres résolus (saisie > fiche technique > défaut). */
  params: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.enum(["input", "technical", "default"])),
  saved: avatarWrite.nullable(),
  hash: z.string(),
  /** Modèle GLB importé à la place de l'avatar généré. */
  imported: z.boolean(),
  /** Logo PNG utilisé comme texture (celui du matériel ou de sa marque). */
  logoAssetId: uuid.nullable(),
});
export type AvatarInfo = z.infer<typeof avatarInfo>;

/** Dernière position connue d'un matériel suivi, à une date (FR-MAT-86). */
export const latestPosition = z.object({
  equipmentId: uuid,
  name: z.string(),
  kind: z.string(),
  time: isoDateTime,
  lon: z.number(),
  lat: z.number(),
  /** Cap (degrés, 0 = nord, sens horaire), si connu. */
  heading: z.number().nullable(),
  speedKmh: z.number().nullable(),
  avatarHash: z.string(),
});
export type LatestPosition = z.infer<typeof latestPosition>;

/** Outil attelé à un matériel pendant une période (interventions réalisées, FR-MAT-85). */
export const hitch = z.object({ toolId: uuid, toolName: z.string(), from: isoDateTime, to: isoDateTime, hitchOffsetM: z.number(), avatarHash: z.string() });
export type Hitch = z.infer<typeof hitch>;
