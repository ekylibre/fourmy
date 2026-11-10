import { useQuery } from "@tanstack/react-query";
import type { BbchStage, PhytoCrop } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/**
 * Référentiels du ministère pour le registre phyto réglementaire (lot X) :
 * cultures (codes OEPP) et stades BBCH d'une culture. Données fixes : pas de
 * rechargement pendant la session.
 */
export function usePhytoCrops(farmId: string) {
  return useQuery({
    queryKey: ["reference", "phyto-crops", farmId],
    queryFn: () => api.get<{ items: PhytoCrop[] }>(farmPath(farmId, "/reference/phyto-crops")),
    staleTime: Infinity,
  });
}

export function useBbchStages(farmId: string, cropCode: string | null) {
  return useQuery({
    queryKey: ["reference", "bbch", farmId, cropCode],
    queryFn: () => api.get<{ items: BbchStage[] }>(farmPath(farmId, `/reference/bbch?crop=${encodeURIComponent(cropCode!)}`)),
    enabled: !!cropCode,
    staleTime: Infinity,
  });
}

/** Option « libellé — description » d'un stade (description tronquée). */
export function bbchOptionLabel(s: BbchStage): string {
  const d = (s.description ?? "").trim();
  if (!d) return s.label;
  return `${s.label} — ${d.length > 60 ? `${d.slice(0, 59)}…` : d}`;
}
