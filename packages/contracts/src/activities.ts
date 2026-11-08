import { z } from "zod";
import { uuid } from "./primitives.js";

/**
 * Activités de la ferme (retours de test du 08/11/2026, lot C) : comme dans
 * Ekylibre, une activité (Maïs, Jachère, Vignes AOP…) a une famille, une
 * production de référence Lexicon et une variété cultivée. Ses productions
 * (parcelle × campagne) en héritent : culture contrôlée (usages E-Phy),
 * culture IFT, image.
 */

export const ACTIVITY_FAMILIES = [
  "plant_farming",
  "vine_farming",
  "animal_farming",
  "plant_nursery",
  "processing",
  "wine_making",
  "administering",
  "tool_maintaining",
  "service_delivering",
] as const;
export type ActivityFamily = (typeof ACTIVITY_FAMILIES)[number];

export const ACTIVITY_FAMILY_LABELS: Record<ActivityFamily, string> = {
  plant_farming: "Cultures végétales",
  vine_farming: "Viticulture",
  animal_farming: "Élevage",
  plant_nursery: "Pépinière",
  processing: "Transformation",
  wine_making: "Vinification",
  administering: "Administration",
  tool_maintaining: "Entretien du matériel",
  service_delivering: "Prestations de service",
};

/** Familles dont les activités portent des productions sur des parcelles. */
export const PARCEL_FAMILIES: ActivityFamily[] = ["plant_farming", "vine_farming", "animal_farming", "plant_nursery"];

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "couleur #RRGGBB attendue");

export const activity = z.object({
  id: uuid,
  name: z.string(),
  family: z.enum(ACTIVITY_FAMILIES),
  /** Production de référence Lexicon (grain_corn, fallow, vine…). */
  reference: z.string().nullable(),
  referenceLabel: z.string().nullable(),
  /** Variété cultivée (taxonomie) : celle de l'activité, sinon de sa référence. */
  cultivation: z.string().nullable(),
  cultivationLabel: z.string().nullable(),
  color: z.string().nullable(),
  suspended: z.boolean(),
  /** Image Lexicon (variété, sinon famille) ; null si aucune. */
  pictureUrl: z.string().nullable(),
  /** Campagne demandée : parcelles et surface. */
  parcelIds: z.array(uuid),
  areaM2: z.number(),
});
export type Activity = z.infer<typeof activity>;

export const activityWrite = z.object({
  name: z.string().trim().min(1).max(120),
  family: z.enum(ACTIVITY_FAMILIES),
  reference: z.string().trim().max(120).nullable().optional(),
  cultivation: z.string().trim().regex(/^[a-z_]+$/).max(120).nullable().optional(),
  color: color.nullable().optional(),
  suspended: z.boolean().optional(),
});
export type ActivityWrite = z.infer<typeof activityWrite>;

/** Parcelles de l'activité pour une campagne (remplace la liste). */
export const activityParcelsWrite = z.object({
  year: z.number().int().min(1900).max(2200),
  parcelIds: z.array(uuid).max(2000),
});
export type ActivityParcelsWrite = z.infer<typeof activityParcelsWrite>;

/** Production de référence Lexicon proposée à la création d'une activité. */
export interface ReferenceProduction {
  referenceName: string;
  label: string;
  family: ActivityFamily;
  specie: string | null;
  specieLabel: string | null;
  color: string | null;
  pictureUrl: string | null;
}
