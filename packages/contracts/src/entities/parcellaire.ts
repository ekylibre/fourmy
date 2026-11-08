import { z } from "zod";
import {
  uuid,
  farmId,
  isoDate,
  validRange,
  geoJsonGeometry,
  auditFields,
} from "../primitives.js";

/** Campagne culturale. */
export const campaign = z
  .object({
    id: uuid,
    farmId,
    year: z.number().int(),
    startsOn: isoDate,
    stopsOn: isoDate,
  })
  .merge(auditFields);
export type Campaign = z.infer<typeof campaign>;

/** Attributs viticoles d'une parcelle (registre viti v1, requirements §4.2bis). */
export const vitiAttributes = z.object({
  variety: z.string().optional(), // cépage
  rootstock: z.string().optional(), // porte-greffe
  rowSpacingM: z.number().positive().optional(),
  plantSpacingM: z.number().positive().optional(),
  densityPerHa: z.number().positive().optional(),
  plantedOn: isoDate.optional(),
});
export type VitiAttributes = z.infer<typeof vitiAttributes>;

/** Identité d'une parcelle (stable dans le temps). */
export const landParcel = z
  .object({ id: uuid, farmId, name: z.string().min(1) })
  .merge(auditFields);
export type LandParcel = z.infer<typeof landParcel>;

/** Version d'une parcelle : géométrie et attributs valides sur un intervalle. */
export const landParcelVersion = z.object({
  id: uuid,
  landParcelId: uuid,
  shape: geoJsonGeometry, // MultiPolygon EPSG:4326
  areaM2: z.number().nonnegative(),
  pacIslet: z.string().optional(),
  viti: vitiAttributes.optional(),
  valid: validRange,
});
export type LandParcelVersion = z.infer<typeof landParcelVersion>;

/** Parcelle avec sa version valide à la date demandée (lectures « à la date »). */
export const landParcelAt = z.object({
  id: uuid,
  name: z.string(),
  version: landParcelVersion,
});
export type LandParcelAt = z.infer<typeof landParcelAt>;

/** Création / mise à jour (le PATCH ouvre une nouvelle version). */
export const landParcelWrite = z.object({
  id: uuid.optional(), // fourni par le client (UUID v7) pour l'idempotence
  name: z.string().min(1),
  shape: geoJsonGeometry,
  pacIslet: z.string().optional(),
  viti: vitiAttributes.optional(),
});
export type LandParcelWrite = z.infer<typeof landParcelWrite>;

/** Production sur une parcelle, pour une campagne. */
export const production = z
  .object({
    id: uuid,
    farmId,
    campaignId: uuid,
    landParcelId: uuid,
    nature: z.enum(["field_crop", "vine", "grassland"]),
    species: z.string().optional(), // référence Lexicon
    /** Activité de la ferme (Maïs, Jachère, Vignes AOP…). */
    activityId: uuid.nullable().optional(),
  })
  .merge(auditFields);
export type Production = z.infer<typeof production>;
