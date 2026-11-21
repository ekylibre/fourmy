import { useQuery } from "@tanstack/react-query";
import type { SeedAttachProposal, SeedCatalogItem, SeedDetail, SeedListItem, SeedMixture, SeedSpeciesOption } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Semences (lot SE3) : liste à la date de la frise, fiche, espèces proposées. */
export const seedsKey = (farmId: string) => ["seeds", farmId] as const;

export function useSeeds(farmId: string, at: string, enabled = true) {
  return useQuery({
    queryKey: [...seedsKey(farmId), "list", at],
    queryFn: () => api.get<{ items: SeedListItem[] }>(farmPath(farmId, `/seeds?at=${encodeURIComponent(at)}`)),
    enabled,
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

export function useSeedAttach(farmId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...seedsKey(farmId), "attach"],
    queryFn: () => api.get<{ items: SeedAttachProposal[] }>(farmPath(farmId, "/seeds/attach")),
    enabled,
  });
}

export function useSeedCatalog(farmId: string, q: string) {
  return useQuery({
    queryKey: ["seed-catalog", farmId, q],
    queryFn: () => api.get<{ items: SeedCatalogItem[] }>(farmPath(farmId, `/seeds/catalog?q=${encodeURIComponent(q)}`)),
    enabled: q.trim().length >= 2,
    staleTime: 60 * 60_000,
  });
}

/** Espèces d'un mélange et doses de son dernier semis (lot SE6). */
export function useSeedMixture(farmId: string, articleId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...seedsKey(farmId), "mixture", articleId],
    queryFn: () => api.get<SeedMixture>(farmPath(farmId, `/articles/${articleId}/seed/mixture`)),
    enabled: enabled && !!articleId,
  });
}
