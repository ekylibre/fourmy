import { z } from "zod";
import {
  uuid,
  farmId,
  isoDateTime,
  geoJsonGeometry,
  auditFields,
} from "../primitives.js";

/** Ferme. */
export const farm = z
  .object({ id: farmId, name: z.string().min(1) })
  .merge(auditFields);
export type Farm = z.infer<typeof farm>;

/** Utilisateur (better-auth gère l'authentification et les sessions). */
export const user = z
  .object({ id: uuid, email: z.string().email(), name: z.string().optional() })
  .merge(auditFields);
export type User = z.infer<typeof user>;

export const role = z.enum(["owner", "worker"]);
export type Role = z.infer<typeof role>;

/** Rattachement utilisateur ↔ ferme avec rôle. */
export const membership = z.object({
  id: uuid,
  farmId,
  userId: uuid,
  role,
});
export type Membership = z.infer<typeof membership>;

/** Position GPS (hypertable TimescaleDB). */
export const position = z.object({
  farmId,
  bindingId: uuid,
  time: isoDateTime,
  point: geoJsonGeometry, // Point EPSG:4326
  speed: z.number().nullable(),
  heading: z.number().nullable(),
  attrs: z.record(z.unknown()).optional(),
});
export type Position = z.infer<typeof position>;

/** Entrée du journal d'audit (FR-TIME-3). */
export const auditLog = z.object({
  id: uuid,
  farmId,
  actor: z.string(),
  origin: z.string(),
  entity: z.string(),
  entityId: uuid,
  action: z.string(),
  diff: z.record(z.unknown()),
  at: isoDateTime,
});
export type AuditLog = z.infer<typeof auditLog>;

/** Exécution d'un import Ekylibre + son rapport (FR-MIG-3). */
export const importRun = z.object({
  id: uuid,
  farmId: farmId.nullable(),
  source: z.string(), // ex. "ekylibre:phaurigot"
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  status: z.enum(["running", "completed", "failed"]),
  report: z
    .object({
      counts: z.record(z.number()),
      rejected: z.array(
        z.object({ entity: z.string(), id: z.string(), reason: z.string() }),
      ),
      phytoDelta: z
        .object({ campaign: z.string(), ekylibre: z.number(), fourmy: z.number() })
        .optional(),
    })
    .nullable(),
});
export type ImportRun = z.infer<typeof importRun>;
