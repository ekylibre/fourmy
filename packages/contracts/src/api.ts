import { z } from "zod";
import { uuid, isoDateTime } from "./primitives.js";
import { landParcelVersion, production } from "./entities/parcellaire.js";
import {
  placeVersion,
  containerVersion,
  equipment,
} from "./entities/batiments.js";

/**
 * Schémas de réponse composés (routes qui renvoient un état consolidé).
 * Le contrat complet route par route vit dans `apps/api` (@hono/zod-openapi) ;
 * ici on fige les formes partagées entre l'API, le web et le mobile.
 */

/** État consolidé de la ferme à une date (GET /snapshot?at=, FR-TIME-1). */
export const snapshot = z.object({
  at: isoDateTime,
  landParcels: z.array(landParcelVersion),
  productions: z.array(production),
  places: z.array(placeVersion),
  containers: z.array(
    containerVersion.extend({ volumeL: z.number().nonnegative().optional() }),
  ),
  equipments: z.array(equipment),
});
export type Snapshot = z.infer<typeof snapshot>;

/** Couverture d'une trace par parcelle traversée (GET /tracks/coverage, US-1). */
export const trackCoverage = z.object({
  equipmentId: uuid,
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  byParcel: z.array(
    z.object({
      landParcelId: uuid,
      parcelName: z.string(),
      /** Temps de travail (positions « au travail ») dans la parcelle. */
      durationS: z.number(),
      /** Surface travaillée : bande de la largeur d'outil, unie, intersectée avec la parcelle. */
      areaM2: z.number(),
      parcelAreaM2: z.number().optional(),
      tools: z.array(z.string()).optional(),
    }),
  ),
});
export type TrackCoverage = z.infer<typeof trackCoverage>;

/** Format de sortie des traces. */
export const trackFormat = z.enum(["czml", "json"]);
export const registerFormat = z.enum(["json", "csv", "pdf"]);

/** Trace d'un matériel pour le rejeu (GET /tracks?format=json, US-1). */
export const trackReplay = z.object({
  equipmentId: uuid,
  from: isoDateTime,
  to: isoDateTime,
  /** Points bruts dans la fenêtre, avant simplification. */
  rawCount: z.number().int(),
  toleranceM: z.number(),
  /** [instant ISO, longitude, latitude, au travail ?] après simplification. */
  samples: z.array(z.tuple([isoDateTime, z.number(), z.number(), z.boolean().nullable()])),
});
export type TrackReplay = z.infer<typeof trackReplay>;
