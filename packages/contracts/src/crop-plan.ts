import { z } from "zod";
import { geoJsonGeometry } from "./primitives.js";

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

/** Couvert d'interculture saisi dans l'assolement (décision A7). */
export const cropPlanCover = z.object({
  id: z.string().min(1),
  key: cropPlanParcelKey,
  species: z.array(z.string()).min(1),
  kind: z.enum(["sown", "regrowth"]),
  sownOn: isoDate.nullable(),
  destroyedOn: isoDate.nullable(),
});
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
});
export type CropPlanDraft = z.infer<typeof cropPlanDraft>;

/** Réglages de l'assolement (farm_settings.crop_plan). */
export const cropPlanSettings = z
  .object({
    /** Critère BCAE 7 mis en avant ; les deux sont toujours calculés (décision A6). */
    bcae7Preferred: z.enum(["rotation", "diversification"]).default("rotation"),
    /** Au moins une parcelle dans la plaine du Rhin (arrêté BCAE) : diversification à points. */
    alsaceRhinePlain: z.boolean().default(false),
  })
  .default({ bcae7Preferred: "rotation", alsaceRhinePlain: false });
export type CropPlanSettings = z.infer<typeof cropPlanSettings>;

/** Champs d'une production que l'assolement fixe. */
export const cropPlanProductionFields = z.object({
  activityId: z.string(),
  role: z.enum(["main", "secondary"]),
  startedOn: isoDate.nullable(),
  stoppedOn: isoDate.nullable(),
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
  z.object({ kind: z.literal("production.create"), assignmentId: z.string(), key: cropPlanParcelKey, after: cropPlanProductionFields }),
  z.object({
    kind: z.literal("production.update"),
    productionId: z.string(),
    key: cropPlanParcelKey,
    before: cropPlanProductionFields,
    after: cropPlanProductionFields,
  }),
  z.object({ kind: z.literal("production.delete"), productionId: z.string(), key: cropPlanParcelKey, before: cropPlanProductionFields }),
]);
export type CropPlanChange = z.infer<typeof cropPlanChange>;

/** Ce qui empêche la validation (incohérence de données, conception §6). */
export const cropPlanBlocker = z.object({
  code: z.enum(["unassigned", "unknown-parcel", "operation", "done-interventions", "duplicate-production"]),
  message: z.string(),
  keys: z.array(z.string()).default([]),
});
export type CropPlanBlocker = z.infer<typeof cropPlanBlocker>;
