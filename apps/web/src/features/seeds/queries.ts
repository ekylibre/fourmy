import { useQuery } from "@tanstack/react-query";
import type { SeedDetail, SeedListItem, SeedSpeciesOption } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Semences (lot SE3) : liste à la date de la frise, fiche, espèces proposées. */
export const seedsKey = (farmId: string) => ["seeds", farmId] as const;

export function useSeeds(farmId: string, at: string) {
  return useQuery({
    queryKey: [...seedsKey(farmId), "list", at],
    queryFn: () => api.get<{ items: SeedListItem[] }>(farmPath(farmId, `/seeds?at=${encodeURIComponent(at)}`)),
  });
}

export function useSeed(farmId: string, articleId: string | null, at: string) {
  return useQuery({
    queryKey: [...seedsKey(farmId), "detail", articleId, at],
    queryFn: () => api.get<SeedDetail>(farmPath(farmId, `/articles/${articleId}/seed?at=${encodeURIComponent(at)}`)),
    enabled: !!articleId,
  });
}

export function useSeedSpecies(farmId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...seedsKey(farmId), "species"],
    queryFn: () => api.get<{ items: SeedSpeciesOption[] }>(farmPath(farmId, "/seeds/species")),
    enabled,
    staleTime: 60 * 60_000,
  });
}
