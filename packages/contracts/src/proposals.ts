import { z } from "zod";
import { interventionPlanWrite } from "./entities/interventions.js";
import { complianceResult } from "./phyto.js";
import { certificationCheck } from "./certification.js";

/**
 * Propositions des accès externes (lot AM8, claudedocs/conception_api_mcp.md
 * §8) : un accès en écriture dépose une intervention, contrôlée à blanc ; le
 * responsable de la ferme l'accepte, la corrige ou la refuse (B6, B9).
 */

export const proposalStatus = z.enum(["pending", "accepted", "rejected", "expired"]);
export type ProposalStatus = z.infer<typeof proposalStatus>;
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "En attente",
  accepted: "Acceptée",
  rejected: "Refusée",
  expired: "Expirée",
};

/** Canal du dépôt : API (clé, OAuth), assistant (MCP) ou web (invité restreint). */
export const proposalChannel = z.enum(["api", "mcp", "web"]);
export type ProposalChannel = z.infer<typeof proposalChannel>;

/** Contenu proposé : le corps de POST /interventions, sans la proposition elle-même. */
export const proposalPayload = interventionPlanWrite.omit({ id: true, proposal: true, agrirouterInbox: true, trackSessionIds: true });
export type ProposalPayload = z.infer<typeof proposalPayload>;

/** Dépôt (POST /proposals). */
export const proposalWrite = z.object({
  kind: z.literal("intervention").default("intervention"),
  payload: proposalPayload,
  /** Ce que le client explique (« dicté le 27/11 à 8 h »). */
  message: z.string().trim().max(2000).optional(),
});
export type ProposalWrite = z.input<typeof proposalWrite>;

/** Niveau d'ensemble des contrôles : le plus grave des trois. */
export const proposalCheckLevel = z.enum(["ok", "info", "warning", "danger"]);
export type ProposalCheckLevel = z.infer<typeof proposalCheckLevel>;

/** Contrôles à blanc au dépôt (API-22) : rien n'est écrit dans la ferme. */
export const proposalChecks = z.object({
  level: proposalCheckLevel,
  /** Messages des feux rouges et oranges, tous contrôles confondus. */
  messages: z.array(z.object({ level: z.enum(["warning", "danger"]), message: z.string() })),
  phyto: complianceResult.nullable(),
  fertilization: z.object({ level: z.string(), indicators: z.array(z.object({ level: z.string(), message: z.string(), parcelName: z.string().nullable().optional() })) }).nullable(),
  certification: certificationCheck.nullable(),
  checkedAt: z.string(),
});
export type ProposalChecks = z.infer<typeof proposalChecks>;

/** Une proposition (GET /proposals). */
export const proposal = z.object({
  id: z.uuid(),
  kind: z.literal("intervention"),
  status: proposalStatus,
  channel: proposalChannel,
  /** Accès qui l'a déposée (« Assistant Claude »), et son auteur. */
  accessName: z.string().nullable(),
  user: z.object({ id: z.uuid(), name: z.string() }),
  payload: proposalPayload,
  message: z.string().nullable(),
  checks: proposalChecks.nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  /** Intervention créée à l'acceptation. */
  resultId: z.uuid().nullable(),
  /** Acceptée après correction par le responsable. */
  corrected: z.boolean(),
});
export type Proposal = z.infer<typeof proposal>;

export const proposalList = z.object({
  items: z.array(proposal),
  /** Propositions en attente (toutes pour le responsable, les siennes sinon). */
  pending: z.number().int(),
});
export type ProposalList = z.infer<typeof proposalList>;

/** Acceptation telle quelle ou corrigée (POST /proposals/:id/accept). */
export const proposalAccept = z.object({ payload: proposalPayload.optional(), note: z.string().trim().max(2000).optional() });
export type ProposalAccept = z.input<typeof proposalAccept>;

/** Refus (POST /proposals/:id/reject). */
export const proposalReject = z.object({ note: z.string().trim().max(2000).optional() });
export type ProposalReject = z.input<typeof proposalReject>;

/** Durée de conservation d'une proposition sans suite ou refusée (API-23c). */
export const PROPOSAL_RETENTION_DAYS = 90;
