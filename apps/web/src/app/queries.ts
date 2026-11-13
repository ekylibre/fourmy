import { useQuery, type QueryClient } from "@tanstack/react-query";
import type {
  PersonCard,
  PersonSheet,
  Activity,
  FarmPhytoArticle,
  ParcelCertification,
  Article,
  ContainerContents,
  EquipmentMaintenance,
  EquipmentSheet,
  EquipmentSummary,
  FarmDueItem,
  FarmBrand,
  FarmMember,
  Intervention,
  InterventionDetail,
  Person,
  PhytoRegisterEntry,
  CrewTemplate,
  ProcedureCatalogue,
  Snapshot,
  StockLevel,
  FarmDisplay,
  FarmProfile,
  GeoPoint,
} from "@fourmy/contracts";
import { DEFAULT_FARM_DISPLAY, formatArea } from "@fourmy/contracts";
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

/** Toutes les interventions d'une campagne (semaine, kanban, calendrier, recherche). */
export function useCampaignInterventions(farmId: string, year: number) {
  return useQuery({
    queryKey: ["interventions", farmId, "campaign", year],
    queryFn: () => api.get<Page<Intervention>>(farmPath(farmId, `/interventions?campaign=${year}`)),
    placeholderData: (prev) => prev,
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
  for (const key of ["interventions", "intervention", "stock", "register", "snapshot", "contents", "procedures", "track-sessions", "intervention-track-sessions", "crop-model", "vegetation3d", "cover-loss"]) {
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

/** Grille Équipe à une date (heures du mois, Certiphyto à la date). */
export function useTeam(farmId: string, day: string) {
  return useQuery({
    queryKey: ["people", farmId, "team", day],
    queryFn: () => api.get<Page<PersonCard>>(farmPath(farmId, `/people?at=${day}`)),
    placeholderData: (prev) => prev,
  });
}

/** Fiche d'une personne (données personnelles si le compte y a droit). */
export function usePersonSheet(farmId: string, id: string, day: string) {
  return useQuery({
    queryKey: ["people", farmId, "sheet", id, day],
    queryFn: () => api.get<PersonSheet>(farmPath(farmId, `/people/${id}?at=${day}`)),
    placeholderData: (prev) => prev,
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

/** Activités de la ferme, avec leurs parcelles de la campagne `year`. */
export function useActivities(farmId: string, year: number) {
  return useQuery({
    queryKey: ["activities", farmId, year],
    queryFn: () => api.get<{ items: Activity[] }>(farmPath(farmId, `/activities?year=${year}`)),
    staleTime: 5 * 60_000,
  });
}

/** Articles phyto de la ferme : produit E-Phy, pictogrammes, mentions de danger, ré-entrée. */
export function usePhytoArticles(farmId: string) {
  return useQuery({
    queryKey: ["phyto-articles", farmId],
    queryFn: () => api.get<{ items: FarmPhytoArticle[] }>(farmPath(farmId, "/phyto/articles")),
    staleTime: 10 * 60_000,
  });
}

/** Certifications des parcelles de la ferme (toutes dates). */
export function useCertifications(farmId: string) {
  return useQuery({
    queryKey: ["certifications", farmId],
    queryFn: () => api.get<{ items: ParcelCertification[] }>(farmPath(farmId, "/certifications")),
    staleTime: 5 * 60_000,
  });
}

/** Matériels de la ferme (fiche résumée, dernier relevé, logo). */
/** Attelages types de la ferme (FR-ATT-6). */
export function useCrewTemplates(farmId: string) {
  return useQuery({
    queryKey: ["crew-templates", farmId],
    queryFn: () => api.get<{ items: CrewTemplate[] }>(farmPath(farmId, "/crew-templates")),
    staleTime: 5 * 60_000,
  });
}

export function useEquipments(farmId: string) {
  return useQuery({
    queryKey: ["equipments", farmId],
    queryFn: () => api.get<{ items: EquipmentSummary[] }>(farmPath(farmId, "/equipments")),
    staleTime: 60_000,
  });
}

/** Fiche complète d'un matériel. */
export function useEquipmentSheet(farmId: string, id: string) {
  return useQuery({
    queryKey: ["equipment-sheet", farmId, id],
    queryFn: () => api.get<EquipmentSheet>(farmPath(farmId, `/equipments/${id}/sheet`)),
  });
}

/** Marques de la ferme (logo et couleur partagés). */
export function useBrands(farmId: string) {
  return useQuery({
    queryKey: ["brands", farmId],
    queryFn: () => api.get<{ items: FarmBrand[] }>(farmPath(farmId, "/brands")),
    staleTime: 5 * 60_000,
  });
}

/** Entretien d'un matériel à une date : plan, échéances, fluides, pièces. */
export function useMaintenance(farmId: string, equipmentId: string, at: string) {
  return useQuery({
    queryKey: ["maintenance", farmId, equipmentId, at],
    queryFn: () => api.get<EquipmentMaintenance>(farmPath(farmId, `/equipments/${equipmentId}/maintenance?at=${encodeURIComponent(at)}`)),
  });
}

/** Échéances en retard et à venir de toute la ferme (tableau de bord de l'entretien). */
export function useFarmDues(farmId: string, at: string) {
  return useQuery({
    queryKey: ["maintenance-due", farmId, at],
    queryFn: () =>
      api.get<{ items: FarmDueItem[]; byEquipment: Record<string, { overdue: number; soon: number; unknown: number }> }>(
        farmPath(farmId, `/maintenance/due?at=${encodeURIComponent(at)}`),
      ),
    staleTime: 60_000,
  });
}

/** Fiche « Ma ferme » (GET /farm), partagée par la page, les préférences et le tableau de bord. */
export function useFarmProfile(farmId: string) {
  return useQuery({ queryKey: ["farm-profile", farmId], queryFn: () => api.get<FarmProfile>(farmPath(farmId, "/farm")), staleTime: 5 * 60_000 });
}

/** Préférences d'affichage de la ferme (E9, E21 bis) et point du siège (E10) ; valeurs par défaut pendant le chargement. */
export function useFarmPrefs(farmId: string): FarmDisplay & { home: GeoPoint | null; area: (m2: number) => string } {
  const p = useFarmProfile(farmId).data;
  const display = p?.display ?? DEFAULT_FARM_DISPLAY;
  return { ...display, home: p?.sites.find((s) => s.isHeadquarters)?.location ?? null, area: (m2) => formatArea(m2, display.areaUnit) };
}
