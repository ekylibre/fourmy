import { useQuery } from "@tanstack/react-query";
import type {
  Article,
  ContainerContents,
  Intervention,
  Person,
  PhytoRegisterEntry,
  ProcedureCatalogue,
  Snapshot,
  StockLevel,
} from "@fourmy/contracts";
import { api, farmPath } from "./api";

type Page<T> = { items: T[]; nextCursor: string | null };

/** État consolidé à la date de la frise (clé = ferme + instant). */
export function useSnapshot(farmId: string, at: string) {
  return useQuery({
    queryKey: ["snapshot", farmId, at],
    queryFn: () => api.get<Snapshot>(farmPath(farmId, `/snapshot?at=${encodeURIComponent(at)}`)),
    placeholderData: (prev) => prev, // pas de clignotement en glissant la frise
  });
}

export function useArticles(farmId: string) {
  return useQuery({
    queryKey: ["articles", farmId],
    queryFn: () => api.get<Page<Article>>(farmPath(farmId, "/articles")),
    staleTime: 5 * 60_000,
  });
}

export function useStock(farmId: string, at: string) {
  return useQuery({
    queryKey: ["stock", farmId, at],
    queryFn: () => api.get<Page<StockLevel>>(farmPath(farmId, `/stock?at=${encodeURIComponent(at)}`)),
    placeholderData: (prev) => prev,
  });
}

export function useInterventions(farmId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["interventions", farmId, from, to],
    queryFn: () =>
      api.get<Page<Intervention>>(
        farmPath(farmId, `/interventions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      ),
  });
}

export function useContainerContents(farmId: string, containerId: string | null, at: string) {
  return useQuery({
    queryKey: ["contents", farmId, containerId, at],
    enabled: !!containerId,
    queryFn: () =>
      api.get<ContainerContents & { origins: Record<string, number> }>(
        farmPath(farmId, `/containers/${containerId}/contents?at=${encodeURIComponent(at)}`),
      ),
  });
}

export function usePhytoRegister(farmId: string, campaign: number) {
  return useQuery({
    queryKey: ["register", farmId, campaign],
    queryFn: () =>
      api.get<{ campaign: number; items: PhytoRegisterEntry[] }>(farmPath(farmId, `/registers/phyto?campaign=${campaign}`)),
  });
}

/** Catalogue des procédures, avec usage et suggestions propres à la ferme. */
export function useProcedures(farmId: string) {
  return useQuery({
    queryKey: ["procedures", farmId],
    queryFn: () => api.get<ProcedureCatalogue>(farmPath(farmId, "/procedures")),
    staleTime: 5 * 60_000,
  });
}

export function usePeople(farmId: string) {
  return useQuery({
    queryKey: ["people", farmId],
    queryFn: () => api.get<Page<Person>>(farmPath(farmId, "/people")),
    staleTime: 5 * 60_000,
  });
}
