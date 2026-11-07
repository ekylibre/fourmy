import { z } from "zod";
import { isoDateTime } from "./primitives.js";

/**
 * Protocole de synchronisation mobile (ADR-13), calqué sur WatermelonDB.
 * `pull` renvoie les changements depuis `lastPulledAt` ; `push` applique des
 * changements idempotents par identifiant client (UUID v7).
 */

/** Collections synchronisées dans la première tranche. */
export const syncCollection = z.enum([
  "land_parcels",
  "articles",
  "equipments",
  "interventions",
]);
export type SyncCollection = z.infer<typeof syncCollection>;

/** Jeu de changements WatermelonDB pour une collection. */
const changeSet = z.object({
  created: z.array(z.record(z.unknown())),
  updated: z.array(z.record(z.unknown())),
  deleted: z.array(z.string()),
});

export const syncChanges = z.record(syncCollection, changeSet);
export type SyncChanges = z.infer<typeof syncChanges>;

export const syncPullQuery = z.object({
  lastPulledAt: isoDateTime.optional(),
});

export const syncPullResponse = z.object({
  changes: syncChanges,
  timestamp: isoDateTime,
});
export type SyncPullResponse = z.infer<typeof syncPullResponse>;

export const syncPushRequest = z.object({
  changes: syncChanges,
  lastPulledAt: isoDateTime,
});
export type SyncPushRequest = z.infer<typeof syncPushRequest>;
