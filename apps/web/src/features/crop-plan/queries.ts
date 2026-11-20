import { useQuery } from "@tanstack/react-query";
import type { CropPlanContext, CropPlanListItem, CropPlanVersionView, CropPlanView } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";

/** Assolement prévisionnel (lot AS2b) : requêtes. */

export const cropPlanKeys = {
  all: (farmId: string) => ["crop-plans", farmId] as const,
  plan: (farmId: string, year: number) => ["crop-plans", farmId, year] as const,
  context: (farmId: string, year: number) => ["crop-plans", farmId, year, "context"] as const,
  version: (farmId: string, year: number, version: number) => ["crop-plans", farmId, year, "version", version] as const,
};

export function useCropPlans(farmId: string) {
  return useQuery({
    queryKey: cropPlanKeys.all(farmId),
    queryFn: () => api.get<CropPlanListItem[]>(farmPath(farmId, "/crop-plans")),
    staleTime: 60_000,
  });
}

/** Assolement d'une campagne ; `null` s'il n'est pas encore créé. */
export function useCropPlan(farmId: string, year: number) {
  return useQuery({
    queryKey: cropPlanKeys.plan(farmId, year),
    queryFn: async () => {
      try {
        return await api.get<CropPlanView>(farmPath(farmId, `/crop-plans/${year}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // Le brouillon est tenu par l'écran : pas de rechargement en arrière-plan.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCropPlanContext(farmId: string, year: number, enabled = true) {
  return useQuery({
    queryKey: cropPlanKeys.context(farmId, year),
    queryFn: () => api.get<CropPlanContext>(farmPath(farmId, `/crop-plans/${year}/context`)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCropPlanVersion(farmId: string, year: number, version: number | null) {
  return useQuery({
    queryKey: cropPlanKeys.version(farmId, year, version ?? 0),
    queryFn: () => api.get<CropPlanVersionView>(farmPath(farmId, `/crop-plans/${year}/versions/${version}`)),
    enabled: version !== null,
    staleTime: Infinity,
  });
}
