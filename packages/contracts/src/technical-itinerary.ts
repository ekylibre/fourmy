import { z } from "zod";
import { uuid } from "./primitives.js";
import { PROCEDURE_LABELS, articleKind, getProcedure, treatmentPurpose, type ArticleKind } from "./procedures.js";

/**
 * Itinéraires techniques de la ferme (ITK), assolement temps 2
 * (claudedocs/conception_assolement_itk.md §4.2, lot IT1). Un ITK est une
 * suite d'étapes prévisionnelles datées par rapport au semis, à la récolte ou
 * à une date fixe, avec intrants et doses à l'hectare, matériels et débit.
 * Préfixe `Itk` : `ItineraryStep` désigne déjà l'étape de la frise TIKA.
 */

const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date au format MM-JJ");

/** Ancre d'une étape : J±n du semis ou de la récolte, ou date fixe (année de récolte, ou celle d'avant). */
export const itkAnchor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sowing"), offsetDays: z.number().int().min(-366).max(730) }),
  z.object({ kind: z.literal("harvest"), offsetDays: z.number().int().min(-366).max(366) }),
  z.object({ kind: z.literal("date"), monthDay, yearOffset: z.union([z.literal(-1), z.literal(0)]) }),
]);
export type ItkAnchor = z.infer<typeof itkAnchor>;

/** Unités de dose (par surface traitée). Grains, doses et milliers : semences seulement. */
export const ITK_DOSE_UNITS = [
  "kilogram_per_hectare",
  "liter_per_hectare",
  "quintal_per_hectare",
  "ton_per_hectare",
  "cubic_meter_per_hectare",
  "unity_per_hectare",
  "grain_per_square_meter",
  "grain_per_hectare",
  "thousand_per_hectare",
  "dose_per_hectare",
] as const;
const SEED_ONLY_UNITS = new Set(["grain_per_square_meter", "grain_per_hectare", "thousand_per_hectare", "dose_per_hectare"]);

export function itkUnitAllowed(unit: string, kind: ArticleKind): boolean {
  return (ITK_DOSE_UNITS as readonly string[]).includes(unit) && (kind === "seed" || !SEED_ONLY_UNITS.has(unit));
}

export const itkInput = z.object({
  /** Article de la ferme ; absent pour un intrant générique (« Azote 40 u »). */
  articleId: uuid.optional(),
  kind: articleKind,
  label: z.string().trim().min(1, "Libellé de l'intrant obligatoire.").max(120),
  dose: z.number().positive("Dose positive.").max(1_000_000),
  unit: z.enum(ITK_DOSE_UNITS),
});
export type ItkInput = z.infer<typeof itkInput>;

/** Preuves d'une étape proposée depuis l'historique (lot IT2), gardées pour l'affichage. */
export const itkEvidence = z.object({
  parcels: z.number().int().nonnegative(),
  ofParcels: z.number().int().nonnegative(),
  campaigns: z.array(z.number().int()),
  from: z.string().optional(),
  to: z.string().optional(),
  note: z.string().max(300).optional(),
  /** Débit observé (médiane, ha/h) et nombre de chantiers mesurés : information, pas un débit saisi. */
  observedRateHaH: z.number().positive().optional(),
  observedSamples: z.number().int().nonnegative().optional(),
});
export type ItkEvidence = z.infer<typeof itkEvidence>;

export const itkStep = z.object({
  /** Stable : sert à l'idempotence de la génération des interventions prévues (lot IT3). */
  id: uuid,
  procedure: z.string().min(1).max(80),
  label: z.string().trim().max(120).optional(),
  anchor: itkAnchor,
  /** Plage de réalisation ± n jours. */
  windowDays: z.number().int().min(0).max(90).optional(),
  repeat: z.object({ count: z.number().int().min(1).max(20), everyDays: z.number().int().min(1).max(365) }).optional(),
  /** Part de la surface concernée (0 à 1). */
  share: z.number().gt(0, "Part supérieure à 0.").max(1, "Part au plus 100 %.").default(1),
  /** « Si besoin » : proposée décochée, comptée à part. */
  optional: z.boolean().default(false),
  purposes: z.array(treatmentPurpose).max(10).optional(),
  inputs: z.array(itkInput).max(20).default([]),
  staffing: z
    .object({
      crewTemplateId: uuid.optional(),
      equipmentIds: z.array(uuid).max(20).default([]),
      personIds: z.array(uuid).max(20).default([]),
      /** Nombre de personnes quand aucune n'est nommée. */
      people: z.number().int().min(0).max(50).optional(),
      /** Type de matériel du barème BCMA quand aucun matériel de la ferme n'est désigné (lot IT4). */
      machineryRateId: z.string().max(80).optional(),
    })
    .default({ equipmentIds: [], personIds: [] }),
  /** Débit saisi, ha/h (décision A15) ; sinon observé ou barème (lot IT4). */
  workRateHaH: z.number().gt(0).max(200).optional(),
  notes: z.string().max(1000).optional(),
  evidence: itkEvidence.optional(),
});
export type ItkStep = z.infer<typeof itkStep>;
export type ItkStepInput = z.input<typeof itkStep>;

/** Procédure acceptée dans un ITK : connue (catalogue ou reprise d'Ekylibre), hors entretien du matériel. */
export function itkProcedureAllowed(code: string): boolean {
  const p = getProcedure(code);
  if (p.legacy && !(code in PROCEDURE_LABELS)) return false;
  return p.shape !== "maintenance" && p.category !== "equipment";
}

export const itkContent = z
  .object({
    schema: z.literal(1),
    /** Début du cycle d'un ITK sans semis (pérennes), comme le « Début (jour/mois) » de Lexicon. */
    startMonthDay: monthDay.optional(),
    steps: z.array(itkStep).max(80),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.steps.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: "Deux étapes portent le même identifiant." });
      ids.add(s.id);
      if (!itkProcedureAllowed(s.procedure)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "procedure"], message: `Procédure inconnue ou hors itinéraire : ${s.procedure}.` });
        return;
      }
      const p = getProcedure(s.procedure);
      s.inputs.forEach((input, j) => {
        if (!p.inputKinds.includes(input.kind))
          ctx.addIssue({ code: "custom", path: ["steps", i, "inputs", j, "kind"], message: `« ${input.label} » : intrant non accepté par « ${p.label} ».` });
        else if (!itkUnitAllowed(input.unit, input.kind))
          ctx.addIssue({ code: "custom", path: ["steps", i, "inputs", j, "unit"], message: `« ${input.label} » : unité réservée aux semences.` });
      });
    });
  });
export type ItkContent = z.infer<typeof itkContent>;

export const itkSystem = z.enum(["conventional", "organic"]);
export type ItkSystem = z.infer<typeof itkSystem>;
export const itkCycle = z.enum(["annual", "perennial"]);
export const itkOrigin = z.enum(["manual", "history", "copy"]);
export type ItkOrigin = z.infer<typeof itkOrigin>;

export const ITK_SYSTEM_LABELS: Record<ItkSystem, string> = { conventional: "Conventionnel", organic: "Biologique" };
export const ITK_ORIGIN_LABELS: Record<ItkOrigin, string> = { manual: "Saisi", history: "Depuis l'historique", copy: "Copie" };

/** Écriture d'un ITK : création (sans révision) ou modification (avec la révision lue). */
export const itkWrite = z.object({
  id: uuid.optional(),
  revision: z.number().int().nonnegative().optional(),
  name: z.string().trim().min(1, "Nom obligatoire.").max(120),
  activityId: uuid.nullable().default(null),
  production: z.string().trim().max(120).nullable().default(null),
  system: itkSystem.default("conventional"),
  cycle: itkCycle.default("annual"),
  origin: itkOrigin.default("manual"),
  source: z.record(z.string(), z.unknown()).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
  active: z.boolean().default(true),
  content: itkContent,
});
export type ItkWrite = z.input<typeof itkWrite>;
export type ItkWriteParsed = z.output<typeof itkWrite>;

/** Élément du document qui n'existe plus (ou plus actif) dans la ferme : à remplacer. */
export interface ItkMissing {
  stepId: string;
  kind: "article" | "equipment" | "person" | "crew_template";
  id: string;
  /** Libellé connu (intrant), sinon null. */
  label: string | null;
}

export interface ItkSummary {
  id: string;
  name: string;
  activityId: string | null;
  activityName: string | null;
  production: string | null;
  system: ItkSystem;
  cycle: "annual" | "perennial";
  origin: ItkOrigin;
  active: boolean;
  revision: number;
  steps: number;
  procedures: string[];
  missing: number;
  updatedAt: string;
}

export interface ItkDetail extends Omit<ItkSummary, "steps" | "procedures" | "missing"> {
  source: Record<string, unknown> | null;
  notes: string | null;
  content: ItkContent;
  missing: ItkMissing[];
  /** Dates d'exemple pour l'aperçu (dates types Lexicon de la production, ramenées à l'an prochain). */
  example: { sowingOn: string; harvestOn: string; year: number };
}

/** Réponse 409 : l'ITK a changé depuis sa lecture. */
export interface ItkConflict {
  title: string;
  detail: string;
  current: ItkDetail;
}

/** Proposition d'un ITK depuis les interventions passées d'une activité (lot IT2). */
export const itkDeriveRequest = z.object({
  activityId: uuid,
  campaigns: z.array(z.number().int().min(2000).max(2100)).min(1, "Au moins une campagne.").max(6),
});
export type ItkDeriveRequest = z.infer<typeof itkDeriveRequest>;

export interface ItkDeriveStats {
  /** Productions retenues (datées par un semis ou une récolte). */
  productions: number;
  /** Productions écartées : ni date de semis ni de récolte. */
  excluded: number;
  /** Interventions réalisées prises en compte. */
  interventions: number;
  /** Intrants dont la dose ne se ramène pas à l'hectare (unité illisible, surface inconnue). */
  unconvertedInputs: number;
  /** Étapes sans matériel ni intervenant dans l'historique (« à compléter »). */
  toComplete: number;
}

export interface ItkDeriveResult {
  name: string;
  activityId: string;
  activityName: string;
  production: string | null;
  system: ItkSystem;
  source: { activityId: string; campaigns: number[]; productions: number };
  content: ItkContent;
  stats: ItkDeriveStats;
}

/** Campagnes d'une activité où des interventions réalisées existent (choix de « Créer depuis l'historique »). */
export interface ItkHistoryCampaign {
  year: number;
  productions: number;
  interventions: number;
}

// ---------------------------------------------------------------------------
// Lot IT3 : interventions prévues d'une campagne, proposées puis confirmées (A10, A14).

/** Lien d'une intervention prévue avec l'étape d'ITK qui l'a proposée (`interventions.itinerary_ref`). */
export interface ItineraryRef {
  itineraryId: string;
  revision: number;
  stepId: string;
  occurrence: number;
  productionId: string;
  campaign: number;
  /** Empreinte de ce que la génération a écrit : différente ⇒ modifiée depuis par l'utilisateur. */
  hash: string;
}

/**
 * create : à créer ; update : générée, non modifiée, à refaire (ITK ou culture changés) ;
 * remove : générée, non modifiée, plus proposée (à annuler) ; same : déjà à jour ;
 * modified : générée puis modifiée à la main (conservée) ; done : réalisée ou annulée (jamais touchée) ;
 * undated : étape sans date (semis ou récolte inconnus), non proposée.
 */
export type PlannedState = "create" | "update" | "remove" | "same" | "modified" | "done" | "undated";

export interface PlannedItem {
  /** `<production>:<étape>:<passage>`. */
  key: string;
  state: PlannedState;
  productionId: string;
  parcelId: string;
  parcelName: string;
  activityName: string;
  itineraryId: string;
  itineraryName: string;
  procedure: string;
  label: string;
  /** Jour prévu (AAAA-MM-JJ), null : à préciser. */
  day: string | null;
  areaM2: number;
  optional: boolean;
  /** Intrants : article de la ferme (écrit dans l'intervention) ou générique (dans les notes). */
  inputs: { articleId: string | null; label: string; dose: number; unit: string }[];
  /** Intervention existante (mise à jour, retrait, conservée). */
  interventionId: string | null;
  /** L'ITK a changé depuis la génération de l'intervention existante. */
  itineraryChanged: boolean;
}

export interface PlannedPreview {
  year: number;
  items: PlannedItem[];
  /** Productions de la campagne sans ITK (rien à proposer). */
  withoutItinerary: number;
  /** Empreinte de l'aperçu : la confirmation est refusée (409) s'il a changé. */
  previewHash: string;
}

export const plannedPreviewRequest = z.object({ productionIds: z.array(uuid).max(2000).optional() });
export type PlannedPreviewRequest = z.infer<typeof plannedPreviewRequest>;

export const plannedConfirmWrite = z.object({
  productionIds: z.array(uuid).max(2000).optional(),
  previewHash: z.string().min(1).max(100),
  /** Clés acceptées (états create, update, remove) ; les autres sont ignorées. */
  accepted: z.array(z.string().max(200)).max(20_000),
  /** Dates modifiées dans l'aperçu (clé → AAAA-MM-JJ). */
  dateEdits: z.record(z.string().max(200), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default({}),
});
export type PlannedConfirmWrite = z.input<typeof plannedConfirmWrite>;

export interface PlannedConfirmResult {
  created: number;
  updated: number;
  removed: number;
  failed: { key: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Lot IT4 : temps de travaux (débits de chantier, trajets, pointes).

/** D'où vient un débit : saisi dans l'étape, observé sur la ferme, barème BCMA, largeur × barème de la famille. */
export type WorkRateSource = "input" | "observed" | "bcma" | "width";
export const WORK_RATE_SOURCE_LABELS: Record<WorkRateSource, string> = {
  input: "saisi",
  observed: "observé sur la ferme",
  bcma: "barème BCMA",
  width: "largeur × barème BCMA",
};

/** Ligne du barème utile au calcul (le référentiel complet reste côté serveur). */
export interface ItkMachineryRateInfo {
  id: string;
  label: string;
  family: string;
  widthM: number | null;
  /** ha/h ; null si la ligne n'est pas à l'hectare. */
  haH: number | null;
}

export interface ItkEquipmentInfo {
  id: string;
  name: string;
  /** Largeur de travail résolue (saisie, fiche, nom, gabarit). */
  widthM: number | null;
  machineryRateId: string | null;
  /** Ligne proposée d'après le type et la largeur (non enregistrée). */
  suggestedRateId: string | null;
  /** Tracteur ou automoteur porteur : son débit est celui de l'outil. */
  carrier: boolean;
}

export interface ItkObservedRate {
  procedure: string;
  equipmentId: string;
  haH: number;
  samples: number;
}

export interface ItkRoute {
  distanceM: number;
  durationS: number;
  method: "osrm" | "estimate";
}

export const itkWorkSettings = z.object({
  /** Heures de travail d'une journée (un aller-retour par journée de chantier). */
  workdayHours: z.number().min(1).max(24).default(8),
  /** Capacité d'une personne par semaine (pointes). */
  weeklyHoursPerPerson: z.number().min(1).max(100).default(45),
  /** Site de départ des trajets ; à défaut, le siège. */
  defaultSiteId: z.string().uuid().nullable().default(null),
});
export type ItkWorkSettings = z.infer<typeof itkWorkSettings>;

/** Contexte du temps de travaux d'un assolement, chargé une fois (`GET /crop-plans/:year/itk-context`). */
export interface ItkWorkContext {
  year: number;
  itineraries: Record<string, { id: string; name: string; revision: number; activityId: string | null; content: ItkContent }>;
  equipments: ItkEquipmentInfo[];
  people: { id: string; name: string }[];
  crewTemplates: Record<string, { equipmentIds: string[]; personIds: string[] }>;
  observed: ItkObservedRate[];
  machineryRates: Record<string, ItkMachineryRateInfo>;
  /** Débit par mètre de largeur de la première famille du barème de chaque procédure (ha/h/m). */
  familyPerMeter: Record<string, number>;
  /** Trajet aller du site à chaque parcelle de base (clé `p:<id>`). */
  routes: Record<string, ItkRoute>;
  site: { id: string; name: string } | null;
  settings: ItkWorkSettings;
  /** Citation du barème (affichée avec chaque débit qui en vient). */
  rateSource: string;
  /** Heures réalisées de la campagne précédente par activité (lot IT6, écart prévu / réalisé). */
  previousHoursByActivity?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Lot IT5 : besoins en intrants de l'assolement, comparés aux stocks.

/** Article cité par un ITK ou un plan de fumure, avec ce qui sert à convertir les doses. */
export interface ItkArticleInfo {
  id: string;
  name: string;
  kind: ArticleKind;
  /** Unité du stock. */
  unit: string;
  /** Densité (kg/L) d'un engrais, pour passer de la masse au volume. */
  density: number | null;
  /** Semence : PMG (g) et grains par dose. */
  tgwG: number | null;
  grainsPerDose: number | null;
  /** Engrais : teneurs (azote total, base) pour passer d'un apport d'azote à une quantité de produit. */
  fertilizer: { basis: "mass_percent" | "kg_per_t" | "kg_per_m3"; nTotal: number; density: number | null } | null;
}

/** Apports prévus d'un plan de fumure établi (prioritaires sur la fertilisation minérale de l'ITK, §9.2). */
export interface ItkPlanApplications {
  planId: string;
  applications: { articleId: string | null; stage: string; nTotalKgHa: number; plannedOn: string | null }[];
}

/** Contexte des besoins en intrants d'un assolement (`GET /crop-plans/:year/inputs-context`). */
export interface ItkInputsContext {
  year: number;
  /** Date du stock (aujourd'hui). */
  at: string;
  articles: Record<string, ItkArticleInfo>;
  /** Stock disponible, dans l'unité de l'article. */
  stock: Record<string, number>;
  /** Déjà réservé par des interventions prévues saisies à la main sur la campagne (pas celles des ITK). */
  reserved: Record<string, number>;
  /** Plans de fumure établis de la campagne, par parcelle (`p:<land_parcel_id>`). */
  plans: Record<string, ItkPlanApplications>;
}

export interface InputNeedLine {
  /** Article de la ferme ; null pour un intrant générique (« Azote 40 u ») ou un apport du plan sans engrais choisi. */
  articleId: string | null;
  label: string;
  kind: ArticleKind;
  /** Unité de la quantité : celle du stock pour un article converti, sinon celle de la dose. */
  unit: string;
  needed: number;
  /** Étapes « si besoin » : comptées à part. */
  optional: number;
  stock: number | null;
  reserved: number | null;
  /** Quantité à acheter (besoin − (stock − réservé)) ; null si l'intrant ne se compare pas au stock. */
  toBuy: number | null;
  /** D'où vient le besoin : ITK, plan de fumure, ou les deux. */
  sources: ("itk" | "plan")[];
  /** La dose ne se convertit pas dans l'unité du stock (PMG, densité, unité) : quantité dans l'unité de la dose. */
  unconvertible: boolean;
}
