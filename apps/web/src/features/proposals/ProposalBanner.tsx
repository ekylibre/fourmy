import { Alert, Text } from "@mantine/core";
import { Bot } from "lucide-react";
import type { Proposal } from "@fourmy/contracts";
import { formatDateTime } from "../../app/labels";
import { CHANNEL_LABELS } from "./labels";

/**
 * Bandeau du formulaire prérempli par une proposition (lot AM8) : qui l'a
 * déposée, son message et ses alertes. L'enregistrement l'accepte.
 */
export function ProposalBanner({ proposal: p }: { proposal: Proposal }) {
  const alerts = p.checks?.messages ?? [];
  return (
    <Alert color="ardoise" icon={<Bot size={18} />} title={`Proposition de ${p.accessName ?? p.user.name} (${CHANNEL_LABELS[p.channel]})`}>
      <Text size="sm">
        Déposée le {formatDateTime(p.createdAt)}. Vérifiez et corrigez si besoin : l'enregistrement accepte la proposition, écrit l'intervention, le registre et les stocks.
      </Text>
      {p.message && (
        <Text size="sm" mt={4} fs="italic">
          « {p.message} »
        </Text>
      )}
      {alerts.length > 0 && (
        <Text size="sm" mt={4} c={p.checks?.level === "danger" ? "brique" : undefined}>
          Au dépôt : {alerts.map((a) => a.message).join(" ; ")}
        </Text>
      )}
    </Alert>
  );
}
