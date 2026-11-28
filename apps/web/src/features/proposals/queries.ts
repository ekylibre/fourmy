import { useQuery } from "@tanstack/react-query";
import type { ProposalList, ProposalStatus } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Propositions des accès externes (lot AM8) : toutes pour le responsable, les siennes sinon. */
export function useProposals(farmId: string, status?: ProposalStatus, enabled = true) {
  return useQuery({
    queryKey: ["proposals", farmId, status ?? "all"],
    enabled,
    queryFn: () => api.get<ProposalList>(farmPath(farmId, `/proposals${status ? `?status=${status}` : ""}`)),
    // Compteur de la navigation : relu de temps en temps, un assistant peut déposer à tout moment.
    refetchInterval: 120_000,
  });
}
