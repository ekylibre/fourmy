import { z } from "zod";
import { isoDate } from "./primitives.js";

/**
 * Fertilisation azotée (FR-REG-3, docs/fertilisation-design.md). Lot AE :
 * composition des fertilisants et azote apporté par une intervention.
 */

/** Base des teneurs : % de la masse (engrais minéraux), kg par tonne ou par m³ de produit brut (organiques). */
export const fertilizerBasis = z.enum(["mass_percent", "kg_per_t", "kg_per_m3"]);
export type FertilizerBasis = z.infer<typeof fertilizerBasis>;

export const FERTILIZER_BASIS_LABELS: Record<FertilizerBasis, string> = {
  mass_percent: "% de la masse",
  kg_per_t: "kg par tonne",
  kg_per_m3: "kg par m³",
};

/**
 * Types de fertilisants du programme d'actions nitrates (PAN 7, annexe I) :
 * 0 et I (organiques à minéralisation lente), II (organiques riches en azote
 * minéral : lisiers, fientes, digestats), III (engrais minéraux et uréiques).
 */
export const nitrateType = z.enum(["0", "Ia", "Ib", "II", "III"]);
export type NitrateType = z.infer<typeof nitrateType>;

export const NITRATE_TYPE_LABELS: Record<NitrateType, string> = {
  "0": "Type 0 (C/N > 20, organisation de l'azote)",
  Ia: "Type Ia (minéralisation très lente)",
  Ib: "Type Ib (minéralisation lente)",
  II: "Type II (minéralisation rapide : lisiers, fientes, digestats)",
  III: "Type III (engrais minéraux et uréiques)",
};

/** D'où vient la composition : proposée par Fourmy, reprise d'Ekylibre, confirmée par l'utilisateur, analyse. */
export const compositionOrigin = z.enum(["proposed", "migrated", "confirmed", "analysis"]);
export type CompositionOrigin = z.infer<typeof compositionOrigin>;

export const COMPOSITION_ORIGIN_LABELS: Record<CompositionOrigin, string> = {
  proposed: "Proposée",
  migrated: "Reprise d'Ekylibre",
  confirmed: "Confirmée",
  analysis: "Analyse",
};

const share = z.number().min(0).max(1);
const content = z.number().min(0).max(1000);

export const fertilizerComposition = z.object({
  basis: fertilizerBasis,
  /** Azote total, dans la base choisie. */
  nTotal: content,
  /** Part minérale de l'azote (NH4 + NO3) des organiques ; 1 pour un engrais minéral. */
  nMineralShare: share.nullable().default(null),
  p2o5: content.nullable().default(null),
  k2o: content.nullable().default(null),
  so3: content.nullable().default(null),
  /** Densité (kg/L), pour convertir une dose en litres. */
  density: z.number().positive().max(3).nullable().default(null),
  nitrateType: nitrateType.nullable().default(null),
  /** Apport foliaire : hors calendrier d'épandage. */
  foliar: z.boolean().default(false),
});
export type FertilizerComposition = z.infer<typeof fertilizerComposition>;

/** Saisie d'une composition (confirmée par l'utilisateur), avec la source de l'information. */
export const fertilizerWrite = fertilizerComposition.extend({ source: z.string().trim().max(200).nullable().default(null) });
export type FertilizerWrite = z.infer<typeof fertilizerWrite>;

/** Analyse d'un produit organique : remplace les valeurs de référence pendant 5 ans. */
export const productAnalysisWrite = z.object({
  sampledOn: isoDate,
  basis: z.enum(["kg_per_t", "kg_per_m3"]),
  dryMatter: z.number().min(0).max(100).nullable().default(null),
  nTotal: content,
  nNh4: content.nullable().default(null),
  cN: z.number().min(0).max(500).nullable().default(null),
  lab: z.string().trim().max(200).nullable().default(null),
});
export type ProductAnalysisWrite = z.infer<typeof productAnalysisWrite>;
export type ProductAnalysis = ProductAnalysisWrite & { id: string; articleId: string };

/** Validité d'une analyse de produit (référentiel Nouvelle-Aquitaine, art. 8). */
export const PRODUCT_ANALYSIS_VALID_YEARS = 5;

/** Fertilisant de la ferme : article, composition retenue (ou proposée), analyses. */
export interface FertilizerArticle {
  id: string;
  name: string;
  kind: string;
  unit: string;
  lexiconRef: string | null;
  composition: FertilizerComposition | null;
  origin: CompositionOrigin | null;
  source: string | null;
  /** Proposition de Fourmy (nom, Lexicon), même quand une composition est enregistrée : pour comparer. */
  proposal: (FertilizerComposition & { source: string }) | null;
  analyses: ProductAnalysis[];
  /** Interventions réalisées qui l'utilisent. */
  usage: number;
}


// --- Lot AF : sol, analyses, eau, zonage ----------------------------------------

export const soilAnalysisKind = z.enum(["rsh", "post_harvest", "soil"]);
export type SoilAnalysisKind = z.infer<typeof soilAnalysisKind>;
export const SOIL_ANALYSIS_KIND_LABELS: Record<SoilAnalysisKind, string> = {
  rsh: "Reliquat sortie d'hiver",
  post_harvest: "Reliquat post-récolte",
  soil: "Analyse de terre",
};

export const soilHorizon = z.object({
  fromCm: z.number().int().min(0).max(300),
  toCm: z.number().int().min(1).max(300),
  /** Azote nitrique de l'horizon (kg N/ha). */
  no3KgHa: z.number().min(0).max(1000),
  /** Azote ammoniacal (kg N/ha) : compté sur 0-40 cm seulement. */
  nh4KgHa: z.number().min(0).max(1000).nullable().default(null),
});
export type SoilHorizon = z.infer<typeof soilHorizon>;

export const soilValues = z.object({
  organicMatterPct: z.number().min(0).max(100).nullable().default(null),
  nTotalGKg: z.number().min(0).max(100).nullable().default(null),
  clayGKg: z.number().min(0).max(1000).nullable().default(null),
  caco3GKg: z.number().min(0).max(1000).nullable().default(null),
  ph: z.number().min(3).max(10).nullable().default(null),
  cecMeq: z.number().min(0).max(100).nullable().default(null),
  stonesPct: z.number().min(0).max(100).nullable().default(null),
});
export type SoilValues = z.infer<typeof soilValues>;

export const soilAnalysisWrite = z
  .object({
    sampledOn: isoDate,
    kind: soilAnalysisKind,
    horizons: z.array(soilHorizon).max(6).nullable().default(null),
    values: soilValues.nullable().default(null),
    lab: z.string().trim().max(200).nullable().default(null),
  })
  .refine((a) => a.kind === "soil" || (a.horizons?.length ?? 0) > 0, { message: "Un reliquat demande au moins un horizon." })
  .refine((a) => !a.horizons || a.horizons.every((h) => h.toCm > h.fromCm), { message: "Horizon : profondeur de fin après le début." });
export type SoilAnalysisWrite = z.infer<typeof soilAnalysisWrite>;
export type SoilAnalysis = SoilAnalysisWrite & { id: string; parcelId: string; createdAt: string };

/** Reliquat d'un prélèvement (kg N/ha) : nitrates sur toute la profondeur, ammonium sur 0-40 cm (COMIFER 2013). */
export function rshTotal(horizons: SoilHorizon[]): number {
  return Math.round(
    horizons.reduce((s, h) => {
      const nh4Share = h.fromCm >= 40 ? 0 : Math.min(1, (40 - h.fromCm) / (h.toCm - h.fromCm));
      return s + h.no3KgHa + (h.nh4KgHa ?? 0) * nh4Share;
    }, 0),
  );
}

export const waterOrigin = z.enum(["surface", "groundwater"]);
export type WaterOrigin = z.infer<typeof waterOrigin>;
export const WATER_ORIGIN_LABELS: Record<WaterOrigin, string> = { surface: "Eau de surface", groundwater: "Eau souterraine (forage, puits)" };

export const waterSourceWrite = z.object({
  name: z.string().trim().min(1).max(100),
  origin: waterOrigin,
  nitrateMgL: z.number().min(0).max(500).nullable().default(null),
  measuredOn: isoDate.nullable().default(null),
  method: z.enum(["lab", "strip"]).nullable().default(null),
});
export type WaterSourceWrite = z.infer<typeof waterSourceWrite>;
export type WaterSource = WaterSourceWrite & { id: string; parcels: number };

/** Fiche sol de la parcelle pour la fertilisation : type régional, profondeur, point d'eau. */
export const soilProfileWrite = z.object({
  soilType: z.string().trim().min(1).max(60).nullable(),
  rootingDepthCm: z.number().int().min(10).max(300).nullable().default(null),
  waterSourceId: z.string().uuid().nullable().default(null),
});
export type SoilProfileWrite = z.infer<typeof soilProfileWrite>;

export const nitrateZoneStatus = z.enum(["in", "partial", "out", "unknown"]);
export type NitrateZoneStatus = z.infer<typeof nitrateZoneStatus>;
export const NITRATE_ZONE_LABELS: Record<NitrateZoneStatus, string> = {
  in: "En zone vulnérable",
  partial: "Commune en partie en zone vulnérable",
  out: "Hors zone vulnérable",
  unknown: "Zonage inconnu",
};

export const nitrateZoneWrite = z.object({
  status: nitrateZoneStatus,
  note: z.string().trim().max(500).nullable().default(null),
});

export interface ParcelNitrateZone {
  status: NitrateZoneStatus;
  insee: string | null;
  commune: string | null;
  zones: string[];
  referential: string;
  computedAt: string;
  confirmedAt: string | null;
  note: string | null;
}

/** Contexte d'une parcelle pour la fertilisation (onglet Sol de la fiche parcelle, tableau de la campagne). */
export interface ParcelFertilizationContext {
  parcelId: string;
  name: string;
  areaM2: number;
  soil: {
    soilType: string | null;
    soilTypeRegion: string | null;
    rootingDepthCm: number | null;
    waterSourceId: string | null;
    tawMm: number | null;
    irrigated: boolean;
  };
  zone: ParcelNitrateZone | null;
  analyses: SoilAnalysis[];
}

export const fertilizationSettingsWrite = z.object({
  region: z.enum(["nouvelle-aquitaine"]),
  campaignStartMmdd: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
});
export type FertilizationSettings = z.infer<typeof fertilizationSettingsWrite>;

// --- Lot AG : plan prévisionnel de fumure -------------------------------------------

export const BALANCE_TERMS = ["Pf", "Rf", "Ri", "Pi", "Mh", "Mhp", "Mr", "MrCi", "Nirr", "Xa", "CAU", "Nbefore4"] as const;
export type BalanceTerm = (typeof BALANCE_TERMS)[number];

export const BALANCE_TERM_LABELS: Record<BalanceTerm, string> = {
  Pf: "Besoin total de la culture (Pf)",
  Rf: "Azote restant dans le sol à la récolte (Rf)",
  Ri: "Reliquat à l'ouverture du bilan (Ri)",
  Pi: "Azote déjà absorbé à l'ouverture (Pi)",
  Mh: "Minéralisation de l'humus (Mh)",
  Mhp: "Retournement de prairie (Mhp)",
  Mr: "Résidus du précédent (Mr)",
  MrCi: "Culture intermédiaire (MrCi)",
  Nirr: "Azote de l'eau d'irrigation (Nirr)",
  Xa: "Produits organiques (Xa)",
  CAU: "Coefficient apparent d'utilisation (CAU)",
  Nbefore4: "Azote minéral apporté avant 4 feuilles",
};

const coverFamily = z.enum(["cruciferes", "graminees_seigle_avoine", "graminees_ray_grass", "legumineuses", "hydrophyllacees", "melange_graminees_legumineuses", "melange_cruciferes_legumineuses"]);

export const plannedApplication = z.object({
  stage: z.string().trim().min(1).max(80),
  plannedOn: isoDate.nullable().default(null),
  articleId: z.string().uuid().nullable().default(null),
  /** Azote efficace (équivalent engrais minéral), kg N/ha. */
  nKgHa: z.number().min(0).max(500),
  reservedForSteering: z.boolean().default(false),
});
export type PlannedApplication = z.infer<typeof plannedApplication>;

/** Saisies du brouillon : ce que Fourmy ne peut pas deviner, et les corrections de la ferme. */
export const planDraft = z.object({
  yieldTarget: z.number().positive().max(2000).nullable().optional(),
  strawReturned: z.boolean().nullable().optional(),
  irrigationMm: z.number().min(0).max(1500).nullable().optional(),
  nBefore4Leaves: z.number().min(0).max(200).nullable().optional(),
  tillers: z.number().int().min(0).max(30).nullable().optional(),
  unfavourable: z.boolean().optional(),
  valueA: z.number().min(0).max(400).nullable().optional(),
  cover: z.object({ family: coverFamily, biomass: z.enum(["le_1", "1_3", "ge_3"]), destruction: z.enum(["nov_dec", "after_january"]) }).nullable().optional(),
  overrides: z.record(z.enum(BALANCE_TERMS), z.object({ value: z.number().min(-500).max(1000), reason: z.string().trim().min(3).max(300) })).optional(),
  applications: z.array(plannedApplication).max(8).optional(),
  external: z
    .object({ doseKgNHa: z.number().min(0).max(500), tool: z.string().trim().min(1).max(120), advisor: z.string().trim().max(120).nullable().default(null), computedOn: isoDate })
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type PlanDraft = z.infer<typeof planDraft>;

export const planEstablish = z.object({ reason: z.string().trim().min(3).max(500).nullable().default(null) });

export type PlanTermValue = { value: number; origin: "computed" | "measured" | "reference" | "entered" | "override"; source: string; detail?: string } | { missing: string };

export interface PlanResult {
  method: string;
  annex: string | null;
  equation: string;
  terms: Partial<Record<BalanceTerm, PlanTermValue>>;
  dose: number | null;
  ceiling: number | null;
  floor30: boolean;
  negative: boolean;
  warnings: string[];
  missing: string[];
}

/** Données que Fourmy a rassemblées pour le calcul, avec leur origine. */
export interface PlanContext {
  department: string | null;
  crop: string;
  cropLabel: string;
  variety: string | null;
  soilType: string | null;
  irrigated: boolean;
  previous: {
    crop: string;
    label: string;
    parcelName: string;
    yieldRealized: number | null;
    /** Azote minéral apporté au précédent (kg N/ha), apports comptés seulement. */
    xMineral: number | null;
    strawReturned: boolean | null;
    /** Apports du précédent que le calcul n'a pas pu compter. */
    uncounted: string[];
  } | null;
  yieldTarget: { value: number; origin: "computed" | "reference" | "entered"; detail: string } | null;
  rain: { mm: number; from: string; to: string; normalsFrom: string | null } | null;
  rsh: { kgNHa: number; sampledOn: string } | null;
  water: { origin: "surface" | "groundwater" | null; no3MgL: number | null; name: string | null };
  irrigationMm: { value: number; detail: string } | null;
  zone: string | null;
}

export interface PlanVersion {
  version: number;
  establishedAt: string;
  establishedBy: string | null;
  reason: string | null;
  referential: string;
  method: string;
  external: PlanDraft["external"] | null;
  doseEfficient: number | null;
  applications: (PlannedApplication & { nTotal: number })[];
  snapshot: { context: PlanContext; result: PlanResult; draft: PlanDraft };
}

export interface FertilizationPlan {
  id: string;
  campaign: number;
  parcel: { id: string; name: string; areaM2: number };
  status: "draft" | "established" | "revised";
  currentVersion: number | null;
  draft: PlanDraft;
  context: PlanContext;
  result: PlanResult;
  /** Apports proposés (fractionnement) quand le brouillon n'en a pas. */
  proposedApplications: PlannedApplication[];
  versions: PlanVersion[];
}

export interface FertilizationPlanSummary {
  id: string;
  campaign: number;
  parcel: { id: string; name: string; areaM2: number };
  cropLabel: string;
  zone: string | null;
  status: FertilizationPlan["status"];
  currentVersion: number | null;
  /** Dose de la dernière version établie, sinon celle du brouillon (calculée ou saisie). */
  dose: number | null;
  doseOrigin: "fourmy" | "external" | null;
  missing: number;
  establishedAt: string | null;
}

/** Référentiel inscrit dans chaque version établie. */
export const PLAN_REFERENTIAL = "Nouvelle-Aquitaine, arrêté référentiel du 29/07/2025";
