import { z } from "zod";
import { uuid, farmId, isoDateTime } from "./primitives.js";

/**
 * Événements de domaine publiés via l'outbox (ADR-6), au format CloudEvents.
 * Consommés par Lyvre, Aiffel et les plugins après les 7 jours (§5.2).
 */

export const eventType = z.enum([
  "land_parcel.versioned",
  "intervention.planned",
  "intervention.completed",
  "intervention.updated",
  "intervention.corrected",
  "stock.moved",
  "container.placed",
  "tracker.positions_ingested",
  "import.completed",
]);
export type EventType = z.infer<typeof eventType>;

/** Enveloppe CloudEvents 1.0 (sous-ensemble utilisé). */
export const cloudEvent = z.object({
  id: uuid,
  type: eventType,
  source: z.string(), // ex. "fourmy/api"
  specversion: z.literal("1.0").default("1.0"),
  time: isoDateTime,
  farmid: farmId,
  datacontenttype: z.literal("application/json").default("application/json"),
  data: z.record(z.string(), z.unknown()),
});
export type CloudEvent = z.infer<typeof cloudEvent>;

/** Ligne de la table outbox (avant publication). */
export const outboxEvent = z.object({
  id: uuid,
  type: eventType,
  payload: cloudEvent,
  occurredAt: isoDateTime,
  publishedAt: isoDateTime.nullable(),
});
export type OutboxEvent = z.infer<typeof outboxEvent>;
