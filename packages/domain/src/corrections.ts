import type { AuditLog } from "@fourmy/contracts";
import type { DomainCtx } from "./ctx.js";
import { DomainError } from "./time.js";

/**
 * Correction d'une erreur de saisie sur un état (architecture §4.4, FR-TIME-3).
 * Une correction n'est pas un changement physique : elle modifie la version
 * concernée, mais n'est jamais silencieuse — l'audit garde l'avant, l'après et
 * le motif. Fonction pure : décrit le changement, la couche service l'exécute.
 */
export interface StateCorrectionInput<T extends Record<string, unknown>> {
  farmId: string;
  entity: string; // table de la version corrigée, ex. "container_versions"
  entityId: string;
  before: T;
  patch: Partial<T>;
  reason: string;
}

export interface StateCorrectionPlan<T> {
  after: T;
  changes: Record<string, { before: unknown; after: unknown }>;
  audit: AuditLog;
}

export function planStateCorrection<T extends Record<string, unknown>>(
  ctx: DomainCtx,
  input: StateCorrectionInput<T>,
): StateCorrectionPlan<T> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("Une correction doit être motivée.");

  const changes: StateCorrectionPlan<T>["changes"] = {};
  for (const [key, value] of Object.entries(input.patch)) {
    if (value === undefined) continue;
    if (input.before[key] !== value) changes[key] = { before: input.before[key], after: value };
  }
  if (Object.keys(changes).length === 0) {
    throw new DomainError("La correction ne change rien.");
  }

  const after = { ...input.before } as T;
  for (const [key, c] of Object.entries(changes)) (after as Record<string, unknown>)[key] = c.after;

  const audit: AuditLog = {
    id: ctx.newId(),
    farmId: input.farmId,
    actor: ctx.actor,
    origin: ctx.origin,
    entity: input.entity,
    entityId: input.entityId,
    action: "corrected",
    diff: { reason, changes },
    at: ctx.now,
  };
  return { after, changes, audit };
}
