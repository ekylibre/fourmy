import { z } from "zod";
import { uuid, farmId, isoDateTime, auditFields } from "../primitives.js";

/** Article du catalogue (base Lexicon + personnalisation, requirements §4.4). */
export const article = z
  .object({
    id: uuid,
    farmId,
    lexiconRef: z.string().nullable(),
    name: z.string().min(1),
    kind: z.enum(["phyto", "fertilizer", "seed", "harvest", "wine", "other"]),
    unit: z.string().min(1),
    amm: z.string().optional(), // n° AMM pour les phytos
    custom: z.record(z.unknown()).optional(),
  })
  .merge(auditFields);
export type Article = z.infer<typeof article>;

/** Lot d'un article (millésime, cépages, appellation en viti). */
export const lot = z
  .object({
    id: uuid,
    farmId,
    articleId: uuid,
    code: z.string(),
    attrs: z.record(z.unknown()).optional(),
  })
  .merge(auditFields);
export type Lot = z.infer<typeof lot>;

/** Filiation entre lots (assemblages viticoles, traçabilité). */
export const lotLineage = z.object({
  id: uuid,
  childLotId: uuid,
  parentLotId: uuid,
  share: z.number().min(0).max(1),
});
export type LotLineage = z.infer<typeof lotLineage>;

/** Cause d'un mouvement de stock. */
export const stockCause = z.enum([
  "migration",
  "intervention",
  "purchase",
  "sale",
  "adjustment",
  "transfer",
]);
export type StockCause = z.infer<typeof stockCause>;

/**
 * Mouvement de stock : ligne immuable et signée. Le stock à une date est la
 * somme des mouvements ; une correction se fait par contre-passation (§4.4).
 */
export const stockMovement = z.object({
  id: uuid,
  farmId,
  lotId: uuid,
  placeId: uuid.nullable(),
  containerId: uuid.nullable(),
  quantity: z.number(), // signée, dans l'unité de l'article
  unit: z.string().min(1),
  occurredAt: isoDateTime,
  cause: stockCause,
  interventionId: uuid.nullable(),
  createdAt: isoDateTime,
});
export type StockMovement = z.infer<typeof stockMovement>;

/** Stock d'un article à une date, par lieu. */
export const stockLevel = z.object({
  articleId: uuid,
  lotId: uuid,
  placeId: uuid.nullable(),
  containerId: uuid.nullable(),
  quantity: z.number(),
  unit: z.string(),
});
export type StockLevel = z.infer<typeof stockLevel>;
