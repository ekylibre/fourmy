import type { CloudEvent, EventType } from "@fourmy/contracts";
import type { DomainCtx } from "./ctx.js";

/**
 * Construit une enveloppe CloudEvents pour l'outbox (ADR-6, §5.2).
 * Fonction pure : l'identifiant et l'instant viennent du contexte.
 */
export function buildEvent(
  ctx: DomainCtx,
  farmId: string,
  type: EventType,
  data: Record<string, unknown>,
): CloudEvent {
  return {
    id: ctx.newId(),
    type,
    source: "fourmy/api",
    specversion: "1.0",
    time: ctx.now,
    farmid: farmId,
    datacontenttype: "application/json",
    data,
  };
}
