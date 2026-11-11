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
  /** Organiques (lot AK) : rapport C/N, et dénomination COMIFER pour l'APLSH. */
  cN: z.number().positive().max(200).nullable().optional(),
  aplshProduct: z.string().max(120).nullable().optional(),
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

export const APLSH_ZONE_KEYS = ["bassin_sud_ouest", "oceanique_altere", "oceanique_degrade", "semi_continental", "montagne"] as const;
export const fertilizationSettingsWrite = z.object({
  region: z.enum(["nouvelle-aquitaine"]),
  campaignStartMmdd: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
  /** Zone climatique des références APLSH (lot AK) ; null : d'après le département. */
  aplshZone: z.enum(APLSH_ZONE_KEYS).nullable().optional(),
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
  overrides: z.record(z.enum(BALANCE_TERMS), z.object({ value: z.number().min(-500).max(1000), reason: z.string().trim().min(3).max(300) })).optional(),
  applications: z.array(plannedApplication).max(8).optional(),
  external: z
    .object({ doseKgNHa: z.number().min(0).max(500), tool: z.string().trim().min(1).max(120), advisor: z.string().trim().max(120).nullable().default(null), computedOn: isoDate })
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  /** Date d'ouverture du bilan (date du reliquat) ; à défaut, le 1er avril (culture de printemps) ou le 1er février. */
  openingOn: isoDate.nullable().optional(),
  /** Période d'implantation envisagée, telle que l'écrit l'exploitant (« 10 au 20 avril »). */
  sowingPeriod: z.string().trim().max(80).nullable().optional(),
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
  /** Date d'ouverture du bilan retenue et son origine. */
  opening: { on: string; origin: "entered" | "rsh" | "default" };
  /** Période d'implantation envisagée (saisie) et semis réalisé, s'il est saisi. */
  sowing: { period: string | null; sownOn: string | null };
  /** Couvert d'interculture qui précède la culture. */
  cover: CoverCrop | null;
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
  /** Mesures de pilotage (lot AJ) et dose de l'apport de pilotage qu'elles autorisent. */
  steering: { measurements: SteeringMeasurement[]; reservedKgNHa: number; allowedDose: number | null };
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

// --- Lot AH : contrôles à la saisie, cahier d'enregistrement ---------------------------

export const fertilizationCheckRequest = z.object({
  startedAt: z.string().datetime({ offset: true }),
  parcelIds: z.array(z.string().uuid()).max(100),
  inputs: z.array(z.object({ articleId: z.string().uuid(), quantity: z.number().positive(), per: z.enum(["hectare", "total"]) })).max(30),
  /** Surface travaillée totale (m²), pour une quantité « au total ». */
  areaM2: z.number().positive().nullable().default(null),
  /** Intervention modifiée : ses propres apports ne comptent pas deux fois. */
  interventionId: z.string().uuid().nullable().default(null),
  /** Météo de l'intervention (lot AJ) : gel et forte pluie rappellent les conditions d'épandage. */
  weather: z.object({ minTemperatureC: z.number().nullable(), precipitationMm: z.number().nullable() }).nullable().optional(),
});
export type FertilizationCheckRequest = z.infer<typeof fertilizationCheckRequest>;

export type FertilizationIndicatorCode =
  | "fert_calendar"
  | "fert_plan"
  | "fert_first_split"
  | "fert_composition"
  // Conditions d'épandage (lot AJ) : gel, sol détrempé, cours d'eau, pente.
  | "fert_frost"
  | "fert_wet"
  | "fert_water"
  | "fert_slope"
  // Plafond d'azote potentiellement libéré jusqu'en sortie d'hiver (lot AK).
  | "fert_aplsh"
  // Grille d'efficacité des apports d'azote minéral, COMIFER 2022 (lot AL).
  | "fert_efficiency"
  // Épandage sur couvert d'interculture, tableau 4 du PAR 7 NA (lot AM).
  | "fert_cover";
export interface FertilizationIndicator {
  code: FertilizationIndicatorCode;
  level: "ok" | "info" | "warning" | "danger";
  message: string;
  parcelName?: string;
}
export interface FertilizationCheck {
  level: "ok" | "info" | "warning" | "danger";
  /** Azote apporté par hectare (kg N/ha), total et efficace connus. */
  nitrogen: { totalKgHa: number; efficientKgHa: number | null } | null;
  indicators: FertilizationIndicator[];
}

/** Un apport du cahier d'enregistrement. */
export interface RecordApplication {
  interventionId: string;
  date: string;
  /** Saisi le (création de l'intervention) ; en retard au-delà de 30 jours. */
  recordedOn: string;
  late: boolean;
  procedure: string;
  areaHa: number;
  product: string;
  /** Teneur telle qu'affichée (« 46 % N », « 390 kg N/m³ »). */
  content: string | null;
  nitrateType: string | null;
  doseLabel: string;
  nTotalKgHa: number | null;
  nEfficientKgHa: number | null;
  /** Ce qui manque pour compter l'azote. */
  missing: string | null;
  /** Efficacité d'un apport d'azote minéral (grille COMIFER 2022, lot AL) : enregistrée à la saisie, sinon recalculée. */
  efficiency: { level: "ok" | "info" | "warning"; message: string } | null;
}

export interface RecordParcel {
  parcelId: string;
  name: string;
  areaHa: number;
  soilType: string | null;
  zone: string | null;
  crop: string;
  variety: string | null;
  sownOn: string | null;
  harvestedOn: string[];
  yieldQHa: number | null;
  /** Gestion de l'interculture et des résidus d'après les interventions (broyage, labour…). */
  interculture: { date: string; label: string }[];
  /** Couvert d'interculture saisi (espèces, dates, exporté ou non). */
  cover: CoverCrop | null;
  /** Couverture des sols en interculture (lot AJ), en zone vulnérable seulement. */
  soilCover: SoilCoverStatus | null;
  /** Mesures de pilotage de la campagne (lot AJ). */
  steering: SteeringMeasurement[];
  /** APLSH cumulée sur le couvert d'interculture, de la récolte du précédent à sa destruction (lot AK). */
  aplsh: { from: string; to: string; kgNHa: number; ceiling: number; over: boolean; missing: string[] } | null;
  /** Techniques culturales simplifiées : aucun labour sur la campagne et les deux précédentes. */
  noPlowing: boolean | null;
  applications: RecordApplication[];
  totalNKgHa: number;
  /** Dose de la version établie du plan, si elle existe. */
  plannedDose: number | null;
  planVersion: number | null;
}

export interface FertilizationRecord {
  campaign: number;
  from: string;
  to: string;
  parcels: RecordParcel[];
  /** Apports à compléter (teneur inconnue) et saisis en retard. */
  toComplete: number;
  late: number;
  /** Épandages enregistrés en période d'interdiction, avec leur motif (lot AJ). */
  forced: { interventionId: string; date: string; parcels: string[]; reason: string | null }[];
}

/** Couverture des sols d'une parcelle (FR-FERT-27). */
export interface SoilCoverStatus {
  level: "ok" | "info" | "warning";
  situation: "long" | "short_after_rapeseed" | "none";
  messages: string[];
}

// --- Lot AI : couverts d'interculture, justificatifs, contrôle enregistré ----------------

export const COVER_FAMILY_LABELS = {
  cruciferes: "Crucifères (moutarde, radis…)",
  graminees_seigle_avoine: "Graminées type seigle, avoine",
  graminees_ray_grass: "Graminées type ray-grass",
  legumineuses: "Légumineuses",
  hydrophyllacees: "Phacélie",
  melange_graminees_legumineuses: "Mélange graminées-légumineuses",
  melange_cruciferes_legumineuses: "Mélange crucifères-légumineuses",
} as const;
export type CoverFamilyKey = keyof typeof COVER_FAMILY_LABELS;

export const COVER_KIND_LABELS = { sown: "Couvert semé", regrowth_cereal: "Repousses de céréales", regrowth_rapeseed: "Repousses de colza" } as const;
export const coverCropWrite = z
  .object({
    campaign: z.number().int().min(2000).max(2100),
    kind: z.enum(["sown", "regrowth_cereal", "regrowth_rapeseed"]).default("sown"),
    family: z.enum(Object.keys(COVER_FAMILY_LABELS) as [CoverFamilyKey, ...CoverFamilyKey[]]).nullable().default(null),
    species: z.string().trim().min(1).max(200),
    sownOn: isoDate,
    destroyedOn: isoDate.nullable().default(null),
    exported: z.boolean().default(false),
    biomass: z.enum(["le_1", "1_3", "ge_3"]).nullable().default(null),
    destructionMode: z.enum(["mechanical", "chemical", "frost", "harvest", "grazing"]).nullable().default(null),
    notes: z.string().trim().max(1000).nullable().default(null),
  })
  .refine((c) => !c.destroyedOn || c.destroyedOn >= c.sownOn, { message: "La destruction suit le semis." })
  .refine((c) => (c.kind === "sown") === (c.family !== null), { message: "Un couvert semé a une famille ; des repousses n'en ont pas." });
export type CoverCropWrite = z.infer<typeof coverCropWrite>;
export type CoverCrop = CoverCropWrite & { id: string; parcelId: string };

export const COVER_BIOMASS_LABELS = { le_1: "1 t MS/ha ou moins", "1_3": "1 à 3 t MS/ha", ge_3: "3 t MS/ha ou plus" } as const;
export const DESTRUCTION_MODE_LABELS = { mechanical: "Mécanique (broyage, labour)", chemical: "Chimique", frost: "Gel", harvest: "Récolte ou fauche", grazing: "Pâturage" } as const;

export const DOCUMENT_OWNER_TYPES = ["plan", "soil_analysis", "water_source", "product_analysis", "cover_crop", "steering"] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export interface RegulatoryDocument {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

/** Contrôle nitrates enregistré avec une intervention réalisée, et le motif d'un passage outre. */
export type NitrateCheckRecord = FertilizationCheck & { reason: string | null; checkedAt: string };

// --- Lot AJ : pilotage en cours de saison ---------------------------------------------------------

export const steeringWrite = z.object({
  measuredOn: isoDate,
  stage: z.string().trim().max(80).nullable().default(null),
  /** Outil : N-Tester, Jubil, Hydro N-Sensor, satellite (Farmstar…). */
  tool: z.string().trim().min(1).max(120),
  value: z.string().trim().max(120).nullable().default(null),
  /** Dose conseillée pour l'apport de pilotage (kg N efficace/ha). */
  advisedKgNHa: z.number().min(0).max(300),
  notes: z.string().trim().max(1000).nullable().default(null),
});
export type SteeringWrite = z.infer<typeof steeringWrite>;
export type SteeringMeasurement = SteeringWrite & { id: string; planId: string; createdAt: string };
