import { z } from "zod";
import {
  uuid,
  farmId,
  validRange,
  geoJsonGeometry,
  shape3d,
  auditFields,
} from "../primitives.js";

/** Bâtiment, local ou lieu de stockage. */
export const place = z
  .object({ id: uuid, farmId, name: z.string().min(1) })
  .merge(auditFields);
export type Place = z.infer<typeof place>;

/** Version d'un lieu : emprise, hauteur, provenance de la géométrie. */
export const placeVersion = z.object({
  id: uuid,
  placeId: uuid,
  kind: z.enum(["building", "room", "storage"]),
  footprint: geoJsonGeometry.optional(), // Polygon EPSG:4326
  heightM: z.number().positive().optional(),
  source: z.enum(["ign", "ekylibre", "manual"]),
  valid: validRange,
});
export type PlaceVersion = z.infer<typeof placeVersion>;

/** Lieu avec sa version valide à la date demandée (GET /places?at=). */
export const placeAt = z.object({
  id: uuid,
  name: z.string(),
  version: placeVersion,
});
export type PlaceAt = z.infer<typeof placeAt>;

/** Contenant : cuve, silo, barrique. */
export const container = z
  .object({ id: uuid, farmId, placeId: uuid, name: z.string().min(1) })
  .merge(auditFields);
export type Container = z.infer<typeof container>;

/** Version d'un contenant : capacité et position 3D locale (ADR-10). */
export const containerVersion = z.object({
  id: uuid,
  containerId: uuid,
  kind: z.enum(["tank", "silo", "barrel"]),
  capacityL: z.number().positive(),
  shape3d: shape3d.nullable(),
  placement: z.enum(["auto", "manual"]),
  valid: validRange,
});
export type ContainerVersion = z.infer<typeof containerVersion>;

/** Repositionnement 3D d'une cuve (PATCH /containers/:id/placement). */
export const containerPlacementWrite = z.object({ shape3d });
export type ContainerPlacementWrite = z.infer<typeof containerPlacementWrite>;

/** Contenu d'une cuve à une date (US-9). */
export const containerContents = z.object({
  containerId: uuid,
  at: z.string().datetime({ offset: true }),
  volumeL: z.number().nonnegative(),
  composition: z.array(
    z.object({
      lotId: uuid,
      lotCode: z.string(),
      share: z.number().min(0).max(1),
      attrs: z.record(z.string(), z.unknown()).optional(), // millésime, cépages, appellation
    }),
  ),
  lastMovements: z.array(
    z.object({
      occurredAt: z.string().datetime({ offset: true }),
      quantityL: z.number(),
      cause: z.string(),
    }),
  ),
});
export type ContainerContents = z.infer<typeof containerContents>;

/** Matériel. */
export const equipment = z
  .object({
    id: uuid,
    farmId,
    name: z.string().min(1),
    kind: z.string(),
    state: z.string().optional(),
  })
  .merge(auditFields);
export type Equipment = z.infer<typeof equipment>;

/** Rattachement d'un traceur à un matériel dans le temps (Traccar). */
export const trackerBinding = z.object({
  id: uuid,
  farmId,
  equipmentId: uuid,
  source: z.literal("traccar"),
  deviceId: z.string(),
  valid: validRange,
});
export type TrackerBinding = z.infer<typeof trackerBinding>;

/**
 * Correction d'une erreur de saisie sur la version courante d'une cuve
 * (POST /containers/:id/corrections). À distinguer d'un changement physique
 * (nouvelle version datée) : la correction répare aussi l'historique, et elle
 * est tracée dans le journal d'audit avec son motif.
 */
export const containerCorrectionWrite = z
  .object({
    capacityL: z.number().positive().optional(),
    kind: z.enum(["tank", "silo", "barrel"]).optional(),
    reason: z.string().trim().min(3),
  })
  .refine((v) => v.capacityL !== undefined || v.kind !== undefined, {
    message: "Rien à corriger : préciser capacityL ou kind.",
  });
export type ContainerCorrectionWrite = z.infer<typeof containerCorrectionWrite>;

/** Cuve avec sa version valide à la date demandée (GET /containers?at=). */
export const containerAt = z.object({
  id: uuid,
  placeId: uuid,
  name: z.string(),
  version: containerVersion,
});
export type ContainerAt = z.infer<typeof containerAt>;
