import { z } from "zod";

/**
 * Parcours GPS (docs/parcours-attelages-design.md §2.4, §3). Réglages du
 * découpage des traces en sessions, propres à chaque ferme (FR-GPS-16).
 */

export const trackSettings = z.object({
  /** Arrêt ou absence de positions (min) qui coupe une session. */
  stopMin: z.number().int().min(2).max(180),
  /** Durée minimale d'un parcours listé (min). */
  minDurationMin: z.number().min(0).max(120),
  /** Distance minimale d'un parcours listé (m). */
  minDistanceM: z.number().min(0).max(10_000),
  /** Vitesse « en mouvement » quand le boîtier ne dit pas s'il travaille (km/h). */
  movingKmh: z.number().min(0.5).max(15),
  /** Part minimale d'une parcelle couverte pour la compter (0..1). */
  parcelMinShare: z.number().min(0).max(1),
  /** Surface minimale couverte dans une parcelle pour la compter (m²). */
  parcelMinAreaM2: z.number().min(0),
});
export type TrackSettings = z.infer<typeof trackSettings>;

export const DEFAULT_TRACK_SETTINGS: TrackSettings = {
  stopMin: 15,
  minDurationMin: 3,
  minDistanceM: 200,
  movingKmh: 2,
  parcelMinShare: 0.05,
  parcelMinAreaM2: 500,
};

export const trackSessionKind = z.enum(["work", "transit"]);
export type TrackSessionKind = z.infer<typeof trackSessionKind>;
