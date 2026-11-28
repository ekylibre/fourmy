import type { ProposalChannel, ProposalCheckLevel, ProposalStatus } from "@fourmy/contracts";

export const CHANNEL_LABELS: Record<ProposalChannel, string> = { api: "API", mcp: "assistant IA", web: "web" };

export const STATUS_BADGES: Record<ProposalStatus, { label: string; color: string }> = {
  pending: { label: "En attente", color: "paille" },
  accepted: { label: "Acceptée", color: "lichen" },
  rejected: { label: "Refusée", color: "gray" },
  expired: { label: "Expirée", color: "gray" },
};

export const CHECK_BADGES: Record<ProposalCheckLevel, { label: string; color: string }> = {
  ok: { label: "Contrôles conformes", color: "lichen" },
  info: { label: "Contrôles conformes", color: "lichen" },
  warning: { label: "À vérifier", color: "paille" },
  danger: { label: "Feu rouge", color: "brique" },
};
