import { useQuery } from "@tanstack/react-query";
import type { Price, PriceKind, ProductSuggestions } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Prix de la ferme (temps 3, lot E1). */
export const pricesKey = (farmId: string) => ["prices", farmId] as const;

export function usePrices(farmId: string, kind: PriceKind, at: string) {
  return useQuery({
    queryKey: [...pricesKey(farmId), kind, at],
    queryFn: () => api.get<{ items: Price[] }>(farmPath(farmId, `/prices?kind=${kind}&at=${at}`)),
  });
}

export function usePriceHistory(farmId: string, kind: PriceKind, enabled: boolean) {
  return useQuery({
    queryKey: [...pricesKey(farmId), kind, "history"],
    queryFn: () => api.get<{ items: Price[] }>(farmPath(farmId, `/prices?kind=${kind}&history=1`)),
    enabled,
  });
}

/** Repères Lexicon par activité (lot E2) : prix de vente proposés, rendements Agreste. */
export function useProductSuggestions(farmId: string) {
  return useQuery({
    queryKey: [...pricesKey(farmId), "suggestions", "products"],
    queryFn: () => api.get<ProductSuggestions>(farmPath(farmId, "/prices/suggestions/products")),
    staleTime: 10 * 60_000,
  });
}
