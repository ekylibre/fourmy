import type {
  StockMovement,
  CloudEvent,
  ParameterRole,
  AuditLog,
} from "@fourmy/contracts";
import type { DomainCtx } from "./ctx.js";
import { buildEvent } from "./events.js";
import { DomainError } from "./time.js";

/**
 * Réalisation et correction d'interventions (architecture §4.4).
 * Fonctions pures qui décrivent les écritures ; la couche service les joue
 * dans une seule transaction (intervention + paramètres + mouvements + audit
 * + événement outbox).
 */

/** Signe d'un mouvement : un intrant sort du stock (négatif), une sortie entre (positif). */
export function signedQuantity(role: ParameterRole, quantity: number): number {
  const q = Math.abs(quantity);
  if (role === "input") return -q;
  if (role === "output") return q;
  throw new DomainError(`Rôle sans mouvement de stock : ${role}`);
}

/** Ligne de stock déjà résolue (article → lot, lieu) fournie par le service. */
export interface ResolvedStockLine {
  role: Extract<ParameterRole, "input" | "output">;
  lotId: string;
  placeId: string | null;
  containerId: string | null;
  quantity: number; // non signée
  unit: string;
}

export interface CompleteInterventionInput {
  farmId: string;
  interventionId: string;
  startedAt: string;
  stoppedAt: string;
  lines: ResolvedStockLine[];
}

export interface InterventionPlan {
  movements: StockMovement[];
  audit: AuditLog;
  event: CloudEvent;
}

/**
 * Décrit la réalisation d'une intervention : un mouvement de stock signé par
 * ligne, l'entrée d'audit et l'événement `intervention.completed`.
 */
export function planInterventionCompletion(
  ctx: DomainCtx,
  input: CompleteInterventionInput,
): InterventionPlan {
  if (input.stoppedAt < input.startedAt) {
    throw new DomainError("La fin de l'intervention précède son début.");
  }
  const movements: StockMovement[] = input.lines.map((l) => ({
    id: ctx.newId(),
    farmId: input.farmId,
    lotId: l.lotId,
    placeId: l.placeId,
    containerId: l.containerId,
    quantity: signedQuantity(l.role, l.quantity),
    unit: l.unit,
    occurredAt: input.stoppedAt,
    cause: "intervention",
    interventionId: input.interventionId,
    createdAt: ctx.now,
  }));

  const audit: AuditLog = {
    id: ctx.newId(),
    farmId: input.farmId,
    actor: ctx.actor,
    origin: ctx.origin,
    entity: "intervention",
    entityId: input.interventionId,
    action: "completed",
    diff: { movements: movements.length },
    at: ctx.now,
  };

  const event = buildEvent(ctx, input.farmId, "intervention.completed", {
    interventionId: input.interventionId,
    movementCount: movements.length,
  });

  return { movements, audit, event };
}

/**
 * Correction d'une intervention réalisée : contre-passe ses mouvements
 * (quantités opposées, cause `adjustment`). On ne modifie jamais un mouvement.
 */
export function planCorrection(
  ctx: DomainCtx,
  farmId: string,
  interventionId: string,
  original: StockMovement[],
): InterventionPlan {
  const movements: StockMovement[] = original.map((m) => ({
    id: ctx.newId(),
    farmId,
    lotId: m.lotId,
    placeId: m.placeId,
    containerId: m.containerId,
    quantity: -m.quantity,
    unit: m.unit,
    occurredAt: ctx.now,
    cause: "adjustment",
    interventionId,
    createdAt: ctx.now,
  }));

  const audit: AuditLog = {
    id: ctx.newId(),
    farmId,
    actor: ctx.actor,
    origin: ctx.origin,
    entity: "intervention",
    entityId: interventionId,
    action: "corrected",
    diff: { reversed: movements.length },
    at: ctx.now,
  };

  const event = buildEvent(ctx, farmId, "intervention.corrected", {
    interventionId,
    reversed: movements.length,
  });

  return { movements, audit, event };
}
