import { z } from "zod";

/**
 * Primitives partagées par tous les contrats Fourmy.
 * Le temps est une dimension de première classe (architecture §4) :
 * états versionnés (`validRange`), journaux (`occurredAt`), séries (`time`).
 */

/** UUID v7 : triables dans le temps, générables côté client (mobile, migrateur). */
export const uuid = z.string().uuid();
export type Uuid = z.infer<typeof uuid>;

/** Identifiant de ferme — colonne de cloisonnement (RLS, ADR-4). */
export const farmId = uuid.brand<"FarmId">();
export type FarmId = z.infer<typeof farmId>;

/** Horodatage ISO-8601 avec fuseau. */
export const isoDateTime = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof isoDateTime>;

/** Date calendaire (campagne, plantation). */
export const isoDate = z.string().date();

/**
 * Intervalle de validité d'un état versionné (`tstzrange` côté Postgres).
 * `upper = null` → version courante (ouverte).
 */
export const validRange = z.object({
  lower: isoDateTime,
  upper: isoDateTime.nullable(),
});
export type ValidRange = z.infer<typeof validRange>;

/** Quantité : jamais un nombre nu — l'unité est toujours explicite. */
export const quantity = z.object({
  value: z.number(),
  unit: z.string().min(1),
});
export type Quantity = z.infer<typeof quantity>;

/**
 * Géométrie GeoJSON en EPSG:4326. On valide la forme, pas la topologie
 * (PostGIS s'en charge). `bbox` optionnel.
 */
export const geoJsonGeometry = z
  .object({
    type: z.enum([
      "Point",
      "LineString",
      "Polygon",
      "MultiPoint",
      "MultiLineString",
      "MultiPolygon",
      "GeometryCollection",
    ]),
    coordinates: z.any().optional(),
    geometries: z.array(z.any()).optional(),
    bbox: z.array(z.number()).optional(),
  })
  .passthrough();
export type GeoJsonGeometry = z.infer<typeof geoJsonGeometry>;

/** Position 3D d'une cuve dans le repère local de son bâtiment (mètres, ADR-10). */
export const shape3d = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  radius: z.number().positive(),
  height: z.number().positive(),
});
export type Shape3d = z.infer<typeof shape3d>;

/** Paramètre de requête temporel commun : état « à la date ». */
export const atQuery = z.object({ at: isoDateTime.optional() });

/** Fenêtre temporelle (traces, interventions, positions). */
export const rangeQuery = z.object({ from: isoDateTime, to: isoDateTime });

/** Pagination par curseur (opaque). */
export const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** Erreur normalisée `application/problem+json` (RFC 9457). */
export const problem = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
export type Problem = z.infer<typeof problem>;

/** Champs d'audit portés par toute entité persistée. */
export const auditFields = z.object({
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
