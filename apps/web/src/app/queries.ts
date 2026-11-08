import { useQuery, type QueryClient } from "@tanstack/react-query";
import type {
  Article,
  ContainerContents,
  FarmMember,
  Intervention,
  InterventionDetail,
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

/** Fiche d'une intervention : l'intervention et son historique. */
export function useIntervention(farmId: string, id: string) {
  return useQuery({
    queryKey: ["intervention", farmId, id],
    queryFn: () => api.get<InterventionDetail>(farmPath(farmId, `/interventions/${id}`)),
  });
}

/** Noms de toutes les parcelles, quelle que soit la date (cibles d'autres dates que la frise). */
export function useParcelNames(farmId: string) {
  return useQuery({
    queryKey: ["parcel-names", farmId],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>(farmPath(farmId, "/land-parcels/names")),
    staleTime: 5 * 60_000,
    select: (r) => new Map(r.items.map((p) => [p.id, p.name])),
  });
}

/** Après une écriture sur les interventions : tout ce qui en dépend est relu. */
export function invalidateAfterIntervention(queryClient: QueryClient) {
  for (const key of ["interventions", "intervention", "stock", "register", "snapshot", "contents", "procedures"]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
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

/** Membres (comptes) de la ferme — réservé au responsable. */
export function useMembers(farmId: string, enabled = true) {
  return useQuery({
    queryKey: ["members", farmId],
    queryFn: () => api.get<Page<FarmMember>>(farmPath(farmId, "/members")),
    enabled,
  });
}
