import { z } from "zod";
import { uuid, farmId, isoDateTime, geoJsonGeometry, auditFields } from "../primitives.js";
import { treatmentPurpose } from "../procedures.js";
import { complianceResult, complianceWrite, iftResult, interventionWeather } from "../phyto.js";
import { mixtureDoses } from "../seeds.js";

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

export const interventionOrigin = z.enum(["web", "mobile", "migration", "plugin", "import"]);

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

/** Relevé du compteur d'un matériel à la fin de l'intervention (entretien, fin de chantier). */
export const meterWrite = z
  .object({
    value: z.number().min(0).max(1_000_000),
    correction: z.enum(["fix", "replacement"]).nullable().optional(),
    correctionReason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((m) => !m.correction || !!m.correctionReason, { message: "Une correction de compteur doit être motivée." });
export type MeterWrite = z.infer<typeof meterWrite>;

export const interventionTarget = z.object({
  kind: targetKind,
  id: uuid,
  /** Matériel entretenu : relevé de son compteur. */
  meter: meterWrite.optional(),
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
  /**
   * Unité de saisie, si elle diffère de celle de l'article : un fertilisant
   * stocké en tonnes se saisit en kg, ou en litres si sa densité est connue.
   * Le stock est converti dans l'unité de l'article.
   */
  unit: z.string().trim().min(1).max(40).optional(),
  /** Lot consommé ; à défaut, le lot le mieux pourvu à la date. */
  lotId: uuid.optional(),
  /** Lieu de prélèvement ; à défaut, celui du lot. */
  from: location.optional(),
  /** Entretien de plusieurs matériels : celui qui reçoit la pièce ou le fluide. */
  equipmentId: uuid.optional(),
  /** Mélange de semences : dose de chaque espèce en kg/ha ; la quantité en est la somme (lot SE6, S7). */
  mixture: mixtureDoses.optional(),
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

export const interventionTool = z.object({
  equipmentId: uuid,
  /** Heures relevées en fin de chantier (FR-MAT-60). */
  meter: meterWrite.optional(),
});
export const interventionDoer = z.object({ personId: uuid });

/**
 * Déclaration des moyens (docs/parcours-attelages.md FR-ATT-1) :
 * - `free` : matériels, intervenants et périodes indépendants (`tools`,
 *   `doers`, `periods` de premier niveau) ;
 * - `crews` : attelages, chacun avec ses matériels (≥ 1), ses intervenants
 *   (0..n, conducteur inconnu accepté) et ses périodes (≥ 1). Les `tools`,
 *   `doers` et `periods` de premier niveau sont alors vides à l'écriture, et
 *   à la lecture ils valent la réunion des attelages (anciens clients).
 */
export const staffing = z.enum(["free", "crews"]);
export type Staffing = z.infer<typeof staffing>;

export const interventionCrew = z.object({
  /** Identifiant stable entre deux modifications (rattachement des parcours GPS). */
  id: uuid.optional(),
  label: z.string().trim().max(80).optional(),
  /** Attelage type d'origine (information : la composition est copiée). */
  templateId: uuid.optional(),
  tools: z.array(interventionTool).min(1, "Un attelage a au moins un matériel."),
  doers: z.array(interventionDoer).default([]),
  periods: z.array(workPeriod).min(1, "Un attelage a au moins une période."),
});
export type InterventionCrew = z.infer<typeof interventionCrew>;

/** Attelage tel que lu. */
export const interventionCrewRead = z.object({
  id: uuid,
  rank: z.number().int(),
  label: z.string().nullable(),
  templateId: uuid.nullable(),
  tools: z.array(interventionTool),
  doers: z.array(interventionDoer),
  periods: z.array(workPeriod),
});
export type InterventionCrewRead = z.infer<typeof interventionCrewRead>;

/** Entretien (FR-MAT-30 à 33, 50 à 55) : nature, problème, atelier, opérations du plan réalisées. */
export const maintenanceNature = z.enum(["preventive", "corrective"]);
export type MaintenanceNature = z.infer<typeof maintenanceNature>;
export const operationResult = z.enum(["done", "ok", "anomaly"]);
export const maintenanceBlock = z.object({
  nature: maintenanceNature.optional(),
  problem: z.string().trim().max(2000).nullable().optional(),
  workshop: z.object({ name: z.string().trim().min(1).max(160), reference: z.string().trim().max(80).nullable().optional() }).nullable().optional(),
  operations: z
    .array(z.object({ equipmentId: uuid, operationId: uuid, result: operationResult.default("done"), note: z.string().trim().max(500).nullable().optional() }))
    .default([]),
});
export type MaintenanceBlock = z.infer<typeof maintenanceBlock>;

/**
 * Irrigation (procédures `IRRIGATION_PROCEDURES`) : dose d'eau apportée,
 * en mm sur la surface ciblée (1 mm = 10 m³/ha), et matériel d'irrigation.
 * La dose alimente le bilan hydrique du modèle de croissance.
 */
export const irrigationMethod = z.enum(["reel", "pivot", "sprinkler", "drip", "other"]);
export type IrrigationMethod = z.infer<typeof irrigationMethod>;
export const IRRIGATION_METHOD_LABELS: Record<IrrigationMethod, string> = {
  reel: "Enrouleur",
  pivot: "Pivot ou rampe",
  sprinkler: "Couverture intégrale",
  drip: "Goutte-à-goutte",
  other: "Autre",
};
export const IRRIGATION_DEPTH_MAX_MM = 100;

/**
 * Origine de l'eau (HVE 7.1 et 7.6) : prélèvement direct dans le milieu
 * (cours d'eau, nappe), réseau collectif, ou retenue (eau stockée, comptée au
 * remplissage).
 */
export const irrigationOrigin = z.enum(["surface", "groundwater", "network", "reservoir"]);
export type IrrigationOrigin = z.infer<typeof irrigationOrigin>;
export const IRRIGATION_ORIGIN_LABELS: Record<IrrigationOrigin, string> = {
  surface: "Cours d'eau ou plan d'eau",
  groundwater: "Nappe (puits, forage)",
  network: "Réseau collectif",
  reservoir: "Retenue (eau stockée)",
};
/** Facteur déclenchant de l'apport (HVE 7.1). */
export const irrigationTrigger = z.enum(["probe", "model", "weather", "advice", "observation", "schedule"]);
export type IrrigationTrigger = z.infer<typeof irrigationTrigger>;
export const IRRIGATION_TRIGGER_LABELS: Record<IrrigationTrigger, string> = {
  probe: "Sonde ou tensiomètre",
  model: "Outil de pilotage (bilan hydrique)",
  weather: "Météo (ETP, pluviométrie)",
  advice: "Bulletin ou conseil",
  observation: "Observation de la culture ou du sol",
  schedule: "Tour d'eau ou calendrier",
};

export const irrigationBlock = z.object({
  depthMm: z.number().positive("La dose d'eau doit être positive.").max(IRRIGATION_DEPTH_MAX_MM, `Dose d'eau de ${IRRIGATION_DEPTH_MAX_MM} mm au plus.`),
  method: irrigationMethod.nullable().optional(),
  origin: irrigationOrigin.nullable().optional(),
  trigger: irrigationTrigger.nullable().optional(),
  /** Matériel mobile (enrouleur déplacé, rampe) plutôt que fixe. */
  mobile: z.boolean().nullable().optional(),
});
export type IrrigationBlock = z.infer<typeof irrigationBlock>;

/** Technique de semis (forme `sowing`) : semis direct, de précision, classique, plantation, à la volée. */
export const sowingTechnique = z.enum(["direct", "precision", "conventional", "planting", "broadcast"]);
export type SowingTechnique = z.infer<typeof sowingTechnique>;
export const SOWING_TECHNIQUE_LABELS: Record<SowingTechnique, string> = {
  direct: "Semis direct",
  precision: "Semis de précision",
  conventional: "Semis classique",
  planting: "Plantation",
  broadcast: "Semis à la volée",
};
export const sowingBlock = z.object({ technique: sowingTechnique });

/**
 * Précision des périodes : `day` quand seule la date est connue (intervention
 * importée d'un autre logiciel) — la période couvre le jour, ses durées ne
 * comptent ni dans les temps de travaux ni dans les heures des matériels.
 */
export const periodPrecision = z.enum(["time", "day"]);
export type PeriodPrecision = z.infer<typeof periodPrecision>;

/** Corps commun de saisie (planification ou réalisation). */
const interventionBody = z.object({
  procedure: z.string().min(1),
  /** Mode de déclaration des moyens ; `free` par défaut (clients antérieurs aux attelages). */
  staffing: staffing.default("free"),
  /** Mode `crews` : les attelages ; vide en mode `free`. */
  crews: z.array(interventionCrew).default([]),
  periods: z.array(workPeriod).default([]),
  targets: z.array(interventionTarget).default([]),
  inputs: z.array(interventionInput).default([]),
  outputs: z.array(interventionOutput).default([]),
  tools: z.array(interventionTool).default([]),
  doers: z.array(interventionDoer).default([]),
  purposes: z.array(treatmentPurpose).default([]),
  notes: z.string().trim().max(2000).optional(),
  /** Justification d'un traitement ou d'un apport (Agriculture biologique, annexe II partie I 1.10.2). */
  justification: z.string().trim().max(2000).optional(),
  /** Stade BBCH (référentiel du ministère, ex. SP_55501_15) ; absent : inchangé, null : effacé. */
  bbch: z.string().trim().max(20).nullable().optional(),
  /** Contrôle réglementaire : cible choisie par produit, motif d'un passage outre un feu rouge. */
  compliance: complianceWrite.optional(),
  /** Météo pendant l'intervention (pré-remplie depuis le fournisseur, modifiable). */
  weather: interventionWeather.optional(),
  /** Forme `maintenance` : nature, problème, atelier, opérations du plan. */
  maintenance: maintenanceBlock.optional(),
  /** Procédures d'irrigation : dose d'eau (obligatoire à la réalisation) et matériel. */
  irrigation: irrigationBlock.optional(),
  /** Semis : technique (facultative). */
  sowing: sowingBlock.optional(),
  /**
   * Parcours GPS à rattacher à l'enregistrement (FR-GPS-23), en plus de ceux
   * déjà rattachés : absent ou vide, les rattachements existants restent.
   */
  trackSessionIds: z.array(uuid).max(50).optional(),
  /**
   * Tâche reçue d'agrirouter dont l'intervention est tirée (lot AR4) : le
   * fichier de la boîte de réception passe « validé » à l'enregistrement.
   */
  agrirouterInbox: z.object({ id: uuid, task: z.number().int().min(0).max(999) }).optional(),
});

/** Planification (POST /interventions). `id` client → idempotent. */
export const interventionPlanWrite = interventionBody.extend({
  id: uuid.optional(),
  /** Date prévue (début) si aucune période n'est encore connue. */
  plannedAt: isoDateTime.optional(),
});
export type InterventionPlanWrite = z.infer<typeof interventionPlanWrite>;

/**
 * Réalisation (POST /interventions/:id/complete) : au moins une période — de
 * premier niveau en mode libre, dans les attelages sinon (au moins un attelage).
 */
export const interventionCompleteWrite = interventionBody.omit({ procedure: true }).superRefine((b, ctx) => {
  if (b.staffing === "free" && b.periods.length === 0) {
    ctx.addIssue({ code: "too_small", minimum: 1, origin: "array", inclusive: true, input: b.periods, path: ["periods"], message: "Au moins une période de travail." });
  }
  if (b.staffing === "crews" && b.crews.length === 0) {
    ctx.addIssue({ code: "too_small", minimum: 1, origin: "array", inclusive: true, input: b.crews, path: ["crews"], message: "Au moins un attelage." });
  }
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

export const maintenanceRead = z.object({
  nature: maintenanceNature,
  problem: z.string().nullable(),
  workshop: z.object({ name: z.string(), reference: z.string().nullable().optional() }).nullable(),
  operations: z.array(
    z.object({ equipmentId: uuid, operationId: uuid, label: z.string(), kind: z.string(), result: operationResult, note: z.string().nullable() }),
  ),
});
export type MaintenanceRead = z.infer<typeof maintenanceRead>;

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
    /** Mode `crews` : réunion des matériels, intervenants et périodes (fusionnées) des attelages. */
    tools: z.array(interventionTool),
    doers: z.array(interventionDoer),
    staffing: staffing.default("free"),
    crews: z.array(interventionCrewRead).default([]),
    /** Du premier début à la dernière fin (secondes). */
    spanS: z.number().nullable().optional(),
    /** Somme des périodes de chaque attelage, ou des périodes en mode libre (secondes). */
    workDurationS: z.number().nullable().optional(),
    purposes: z.array(treatmentPurpose),
    notes: z.string().nullable(),
    /** Stade BBCH du traitement (registre réglementaire) et son libellé. */
    bbch: z.object({ code: z.string(), label: z.string() }).nullable().optional(),
    origin: interventionOrigin,
    clientId: z.string().nullable(),
    /** Contrôle réglementaire enregistré (traitements saisis dans Fourmy). */
    compliance: complianceResult.nullable().optional(),
    /** Contrôle nitrates à l'enregistrement (lot AI) : calendrier, plan, premier apport ; motif d'un passage outre. */
    nitrateCheck: z.custom<import("../fertilization.js").NitrateCheckRecord>().nullable().optional(),
    /** Contrôles HVE et AB à l'enregistrement (parcelles certifiées), motif d'un passage outre. */
    certificationCheck: z.custom<import("../certification.js").CertificationCheck>().nullable().optional(),
    justification: z.string().nullable().optional(),
    /** IFT (traitements réalisés). */
    ift: iftResult.nullable().optional(),
    /** Météo pendant l'intervention. */
    weather: interventionWeather.nullable().optional(),
    /** Entretien : nature, problème, atelier, opérations réalisées (libellés compris). */
    maintenance: maintenanceRead.nullable().optional(),
    /** Irrigation : dose d'eau et matériel. */
    irrigation: z
      .object({
        depthMm: z.number(),
        method: irrigationMethod.nullable(),
        origin: irrigationOrigin.nullable().optional(),
        trigger: irrigationTrigger.nullable().optional(),
        mobile: z.boolean().nullable().optional(),
      })
      .nullable()
      .optional(),
    /** Semis : technique. */
    sowing: sowingBlock.nullable().optional(),
    /** `day` : seule la date est connue (intervention importée). */
    periodPrecision: periodPrecision.optional(),
    /** false : intervention importée, sans mouvement de stock. */
    affectsStock: z.boolean().optional(),
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
  changes: z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() })).nullable(),
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
  /**
   * Applicateur(s) : intervenants de l'attelage qui porte le pulvérisateur,
   * tous les intervenants en mode libre (FR-ATT-12). Vide : non renseigné.
   */
  applicators: z.array(z.string()),
});
export type PhytoRegisterEntry = z.infer<typeof phytoRegisterEntry>;

/** Personne de la ferme (intervenant), avec ou sans compte Fourmy. */
export const person = z
  .object({
    id: uuid,
    farmId,
    name: z.string().min(1),
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

/**
 * Attelage type (FR-ATT-6) : composition habituelle de la ferme, reprise en
 * un clic à la saisie (l'intervention la copie et garde `templateId` à titre
 * d'information). `equipmentIds` et `personIds` dans l'ordre saisi.
 */
export const crewTemplate = z.object({
  id: uuid,
  name: z.string(),
  active: z.boolean(),
  equipmentIds: z.array(uuid),
  personIds: z.array(uuid),
  updatedAt: z.string(),
});
export type CrewTemplate = z.infer<typeof crewTemplate>;

export const crewTemplateWrite = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Nom obligatoire.").max(80),
  active: z.boolean().optional(),
  equipmentIds: z.array(uuid).min(1, "Un attelage type a au moins un matériel.").max(20),
  personIds: z.array(uuid).max(20).default([]),
});
export type CrewTemplateWrite = z.input<typeof crewTemplateWrite>;

/** Membre d'une ferme : un compte et son rôle, avec la personne qui lui est rattachée. */
export const farmMember = z.object({
  userId: uuid,
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(["owner", "worker"]),
  personId: uuid.nullable(),
});
export type FarmMember = z.infer<typeof farmMember>;
