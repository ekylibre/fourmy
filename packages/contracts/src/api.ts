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
  byParcel: z.array(
    z.object({
      landParcelId: uuid,
      parcelName: z.string(),
      durationS: z.number(),
      areaM2: z.number(),
    }),
  ),
});
export type TrackCoverage = z.infer<typeof trackCoverage>;

/** Format de sortie des traces. */
export const trackFormat = z.enum(["czml", "json"]);
export const registerFormat = z.enum(["json", "csv", "pdf"]);
