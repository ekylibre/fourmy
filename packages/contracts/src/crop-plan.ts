import { z } from "zod";
import { geoJsonGeometry } from "./primitives.js";
import type { ControlSection } from "./certification.js";
import { itkWorkSettings } from "./technical-itinerary.js";

/**
 * Assolement prévisionnel (claudedocs/conception_assolement.md §3.3) : le
 * brouillon d'une campagne, document sauvegardé au fil de l'eau, appliqué
 * seulement à la validation.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ");

/** Parcelle du brouillon : existante (`p:<land_parcel_id>`) ou nouvelle (`n:<id provisoire>`). */
export const cropPlanParcelKey = z.string().regex(/^[pn]:[\w-]+$/, "Clé de parcelle invalide");
export type CropPlanParcelKey = z.infer<typeof cropPlanParcelKey>;
export const newParcelKey = z.string().regex(/^n:[\w-]+$/, "Clé de nouvelle parcelle invalide");

/** Nouvelle parcelle issue d'une découpe ou d'une fusion ; surface géodésique calculée au dessin. */
export const cropPlanPiece = z.object({
  key: newParcelKey,
  name: z.string().trim().min(1).max(120),
  shape: geoJsonGeometry,
  areaM2: z.number().positive(),
});
export type CropPlanPiece = z.infer<typeof cropPlanPiece>;

export const cropPlanOperation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("split"), source: cropPlanParcelKey, pieces: z.array(cropPlanPiece).min(2), effectiveOn: isoDate }),
  z.object({ kind: z.literal("merge"), sources: z.array(cropPlanParcelKey).min(2), result: cropPlanPiece, effectiveOn: isoDate }),
]);
export type CropPlanOperation = z.infer<typeof cropPlanOperation>;

/** Prévision de rendement et de prix d'un produit (réservé au temps 3). */
export const cropPlanForecast = z.object({
  product: z.string(),
  yield: z.number().nonnegative(),
  unit: z.string(),
  price: z.number().nonnegative().optional(),
  currency: z.literal("EUR").optional(),
});

export const cropPlanAssignment = z
  .object({
    id: z.string().min(1),
    key: cropPlanParcelKey,
    /** Culture principale ou culture dérobée qui la suit. */
    role: z.enum(["main", "secondary"]),
    activityId: z.string().uuid(),
    /** Dates théoriques (semis → récolte). */
    startedOn: isoDate.nullable(),
    stoppedOn: isoDate.nullable(),
    /** Production existante reprise (import, saisie, version précédente). */
    productionId: z.string().uuid().optional(),
    /** Réservé au temps 2. */
    itineraryId: z.string().uuid().optional(),
    /** Réservé au temps 3. */
    forecasts: z.array(cropPlanForecast).optional(),
  })
  .refine((a) => !a.startedOn || !a.stoppedOn || a.startedOn <= a.stoppedOn, { message: "La fin précède le début", path: ["stoppedOn"] });
export type CropPlanAssignment = z.infer<typeof cropPlanAssignment>;

/**
 * Couvert d'interculture saisi dans l'assolement (décision A7), après la
 * culture principale : enregistré à la validation dans le cahier de
 * fertilisation (cover_crops, campagne de la culture suivante). Mêmes
 * familles et natures que le cahier.
 */
export const cropPlanCover = z
  .object({
    id: z.string().min(1),
    key: cropPlanParcelKey,
    kind: z.enum(["sown", "regrowth_cereal", "regrowth_rapeseed"]),
    family: z.enum(["cruciferes", "graminees_seigle_avoine", "graminees_ray_grass", "legumineuses", "hydrophyllacees", "melange_graminees_legumineuses", "melange_cruciferes_legumineuses"]).nullable(),
    species: z.string().trim().min(1).max(200),
    sownOn: isoDate,
    destroyedOn: isoDate.nullable(),
    /** Couvert existant repris (cahier de fertilisation). */
    coverId: z.string().uuid().optional(),
  })
  .refine((c) => (c.kind === "sown") === (c.family !== null), { message: "Famille requise pour un couvert semé, et seulement pour lui", path: ["family"] })
  .refine((c) => !c.destroyedOn || c.destroyedOn >= c.sownOn, { message: "La destruction précède le semis", path: ["destroyedOn"] });
export type CropPlanCover = z.infer<typeof cropPlanCover>;

export const cropPlanDraft = z.object({
  schema: z.literal(1),
  /** Année de récolte (décision A5). */
  year: z.number().int().min(2000).max(2100),
  operations: z.array(cropPlanOperation),
  assignments: z.array(cropPlanAssignment),
  covers: z.array(cropPlanCover),
  /** Parcelles volontairement sans culture (jachère, gel, SNE), avec leur code PAC. */
  fallow: z.array(z.object({ key: cropPlanParcelKey, capCode: z.string().optional() })),
  /** Parcelles de la campagne précédente proposées à la reconduction et écartées (lot AS5). */
  excluded: z.array(cropPlanParcelKey).default([]),
});
export type CropPlanDraft = z.infer<typeof cropPlanDraft>;

/** Réglages de l'assolement (farm_settings.crop_plan). */
export const cropPlanSettings = z
  .object({
    /** Critère BCAE 7 mis en avant ; les deux sont toujours calculés (décision A6). */
    bcae7Preferred: z.enum(["rotation", "diversification"]).default("rotation"),
    /** Au moins une parcelle dans la plaine du Rhin (arrêté BCAE) : diversification à points. */
    alsaceRhinePlain: z.boolean().default(false),
    /** Délais de retour propres à la ferme (années), par repère (`RETURN_INTERVALS`). */
    returnIntervals: z.record(z.string(), z.number().int().min(1).max(15)).default({}),
    /** Temps de travaux (lot IT4) : journée de travail, capacité par personne, site de départ. */
    work: itkWorkSettings.optional(),
  })
  .default({ bcae7Preferred: "rotation", alsaceRhinePlain: false, returnIntervals: {} });
export type CropPlanSettings = z.infer<typeof cropPlanSettings>;

/** Champs d'une production que l'assolement fixe. */
export const cropPlanProductionFields = z.object({
  activityId: z.string(),
  role: z.enum(["main", "secondary"]),
  startedOn: isoDate.nullable(),
  stoppedOn: isoDate.nullable(),
  /** Itinéraire technique choisi (temps 2, lot IT3), gardé dans `productions.attrs.itineraryId`. */
  itineraryId: z.string().uuid().nullable().optional(),
});
export type CropPlanProductionFields = z.infer<typeof cropPlanProductionFields>;

/** Changement appliqué par la validation (conception §5.2). */
export const cropPlanChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("campaign.create"), year: z.number().int() }),
  z.object({
    kind: z.literal("parcel.split"),
    source: cropPlanParcelKey,
    pieces: z.array(z.object({ key: z.string(), name: z.string(), areaM2: z.number() })),
    effectiveOn: isoDate,
  }),
  z.object({
    kind: z.literal("parcel.merge"),
    sources: z.array(cropPlanParcelKey),
    result: z.object({ key: z.string(), name: z.string(), areaM2: z.number() }),
    effectiveOn: isoDate,
  }),
  z.object({ kind: z.literal("parcel.carry"), key: cropPlanParcelKey, name: z.string(), sourceName: z.string() }),
  z.object({ kind: z.literal("production.create"), assignmentId: z.string(), key: cropPlanParcelKey, after: cropPlanProductionFields }),
  z.object({
    kind: z.literal("production.update"),
    productionId: z.string(),
    key: cropPlanParcelKey,
    before: cropPlanProductionFields,
    after: cropPlanProductionFields,
  }),
  z.object({ kind: z.literal("production.delete"), productionId: z.string(), key: cropPlanParcelKey, before: cropPlanProductionFields }),
  z.object({ kind: z.literal("cover.create"), coverKey: z.string(), key: cropPlanParcelKey, species: z.string() }),
  z.object({ kind: z.literal("cover.update"), coverId: z.string(), key: cropPlanParcelKey, species: z.string() }),
  z.object({ kind: z.literal("cover.delete"), coverId: z.string(), key: cropPlanParcelKey, species: z.string() }),
  // Découpe et interventions prévues de la parcelle d'origine après la date d'effet (lot IT3, #116).
  /** Générée par un ITK : annulée, à reproposer sur les morceaux. */
  z.object({ kind: z.literal("intervention.cancel"), interventionId: z.string(), key: cropPlanParcelKey, procedure: z.string(), day: z.string() }),
  /** Saisie à la main : reportée sur un morceau. */
  z.object({ kind: z.literal("intervention.retarget"), interventionId: z.string(), key: cropPlanParcelKey, to: z.string(), procedure: z.string(), day: z.string() }),
  /** Saisie à la main : répartie sur chaque morceau, au prorata des surfaces. */
  z.object({ kind: z.literal("intervention.split"), interventionId: z.string(), key: cropPlanParcelKey, to: z.array(z.string()), procedure: z.string(), day: z.string() }),
]);
export type CropPlanChange = z.infer<typeof cropPlanChange>;

/** Ce qui empêche la validation (incohérence de données, conception §6). */
export const cropPlanBlocker = z.object({
  code: z.enum(["unassigned", "unknown-parcel", "operation", "done-interventions", "duplicate-production", "effective-date", "geometry", "certification", "planned-interventions"]),
  message: z.string(),
  keys: z.array(z.string()).default([]),
});
export type CropPlanBlocker = z.infer<typeof cropPlanBlocker>;

// --- API (lot AS2a, conception §5) ---------------------------------------

/**
 * draft : brouillon en cours ; validated : validé ; current : pas d'assolement,
 * mais des cultures déjà saisies ou importées pour la campagne (affichées
 * telles quelles, « Modifier » crée l'assolement).
 */
export const cropPlanStatus = z.enum(["draft", "validated", "current"]);
export type CropPlanStatus = z.infer<typeof cropPlanStatus>;

export interface CropPlanVersionSummary {
  version: number;
  validatedAt: string;
  validatedBy: string | null;
  reason: string | null;
}

/** Assolement d'une campagne : brouillon en cours, ou état actuel des productions s'il est validé. */
export interface CropPlanView {
  year: number;
  status: CropPlanStatus;
  /** Révision du brouillon (concurrence optimiste de la sauvegarde). */
  revision: number;
  draft: CropPlanDraft;
  currentVersion: number | null;
  versions: CropPlanVersionSummary[];
  updatedAt: string;
}

export interface CropPlanListItem {
  year: number;
  status: CropPlanStatus;
  currentVersion: number | null;
  updatedAt: string;
}

export const cropPlanDraftWrite = z.object({ revision: z.number().int().min(0), draft: cropPlanDraft });
export type CropPlanDraftWrite = z.infer<typeof cropPlanDraftWrite>;

export const cropPlanValidateWrite = z.object({
  revision: z.number().int().min(0),
  /** Motif d'une révision (sortie d'hiver…). */
  reason: z.string().trim().max(500).optional(),
  /**
   * Interventions prévues saisies à la main sur une parcelle découpée (lot IT3, #116) :
   * identifiant → morceau qui la reçoit, ou « each » (une par morceau, au prorata).
   */
  plannedMoves: z.record(z.string().uuid(), z.union([cropPlanParcelKey, z.literal("each")])).default({}),
});
export type CropPlanValidateWrite = z.infer<typeof cropPlanValidateWrite>;

/** Culture d'une parcelle une année passée (historique du contexte). */
export interface CropPlanYearCrop {
  main: string | null;
  secondary: boolean;
  species?: string | null;
  label?: string | null;
  legume?: boolean;
  coverLegume?: boolean;
  vegetable?: boolean;
  perennial?: boolean;
}

/** Contexte des contrôles de l'assolement (conception §4.1), chargé une fois par l'écran. */
export interface CropPlanContext {
  year: number;
  /**
   * Parcellaire de départ, valide pendant la campagne : début de la version
   * courante, dernière fin de production avant la campagne (date d'effet
   * d'une découpe, lot AS3).
   */
  parcels: {
    id: string;
    name: string;
    areaM2: number;
    shape: unknown;
    validFrom: string;
    lastStoppedOn: string | null;
    /**
     * Parcelle de la campagne précédente, close avant celle-ci, proposée à la
     * reconduction (lot AS5) : `name` est le nom nettoyé (sans culture ni
     * année), `sourceName` celui d'origine.
     */
    carryOver?: boolean;
    sourceName?: string;
  }[];
  activities: {
    id: string;
    name: string;
    family: string;
    color: string | null;
    capCode: string | null;
    species: string | null;
    cycle: "annual" | "semi_perennial" | "perennial";
    legume: boolean;
    vegetable: boolean;
    /** Image de l'activité (légende de la carte). */
    pictureUrl: string | null;
    /** Dates types de semis et de récolte pour la campagne (Lexicon), pour pré-remplir. */
    defaultStartedOn: string | null;
    defaultStoppedOn: string | null;
  }[];
  /** Historique : land_parcel_id → année → culture (Y-5 à Y-1). */
  history: Record<string, Record<string, CropPlanYearCrop>>;
  /** Surface (m²) par activité à la campagne précédente. */
  previousByActivity: Record<string, number>;
  /**
   * Zonages des parcelles de départ (lot AS4) : part en aire d'alimentation
   * de captage et en site Natura 2000, point d'eau le plus proche.
   */
  zones: Record<
    string,
    {
      catchments: { name: string; share: number }[];
      natura2000: { name: string; nature: string; share: number }[];
      water: { name: string | null; distanceM: number } | null;
    }
  >;
  certification: {
    /** Parcelles certifiées AB pendant la campagne : début de la conversion. */
    abParcels: Record<string, { conversionStart: string }>;
    hve: boolean;
    abRotation: { years: number; sameSpeciesMax: number };
  };
  settings: CropPlanSettings;
  refsVersion: string;
}

/** Aperçu ou résultat d'une validation. */
export interface CropPlanValidation {
  dryRun: boolean;
  changes: CropPlanChange[];
  blockers: CropPlanBlocker[];
  sections: ControlSection[];
  /** Version créée (validation appliquée). */
  version: number | null;
  /** Interventions prévues saisies à la main à reporter sur les morceaux d'une découpe (#116). */
  plannedToMove?: CropPlanPlannedMove[];
}

export interface CropPlanPlannedMove {
  interventionId: string;
  procedure: string;
  day: string;
  /** Parcelle d'origine. */
  key: string;
  pieces: { key: string; name: string }[];
  /** Choix reçu (morceau ou « each »), s'il y en a un. */
  choice: string | null;
  /** « each » impossible (intervention en attelages) : un seul morceau. */
  splittable: boolean;
}

export interface CropPlanVersionView extends CropPlanVersionSummary {
  snapshot: CropPlanDraft;
  changes: CropPlanChange[];
  findings: ControlSection[];
  refsVersion: string;
}
