import { useQuery } from "@tanstack/react-query";
import type { ItkDetail, ItkSummary } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Itinéraires techniques de la ferme (lot IT1). */
export const itksKey = (farmId: string) => ["itks", farmId] as const;

export function useItks(farmId: string, filter: { activityId?: string | null; active?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filter.activityId) params.set("activityId", filter.activityId);
  if (filter.active !== undefined) params.set("active", String(filter.active));
  const qs = params.toString();
  return useQuery({
    queryKey: [...itksKey(farmId), "list", filter.activityId ?? null, filter.active ?? null],
    queryFn: () => api.get<{ items: ItkSummary[] }>(farmPath(farmId, `/technical-itineraries${qs ? `?${qs}` : ""}`)),
  });
}

export function useItk(farmId: string, id: string) {
  return useQuery({
    queryKey: [...itksKey(farmId), "detail", id],
    queryFn: () => api.get<ItkDetail>(farmPath(farmId, `/technical-itineraries/${id}`)),
  });
}
