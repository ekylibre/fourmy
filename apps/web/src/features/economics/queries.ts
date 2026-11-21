import { useQuery } from "@tanstack/react-query";
import type { EcoContext, Price, PriceKind, ProductSuggestions, RealizedFacts } from "@fourmy/contracts";
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

/** Contexte économique d'une campagne d'assolement (lot E3) : rendement et prix par défaut par activité. */
export function useEcoContext(farmId: string, year: number, enabled = true) {
  return useQuery({
    queryKey: [...pricesKey(farmId), "eco-context", year],
    queryFn: () => api.get<EcoContext>(farmPath(farmId, `/crop-plans/${year}/eco-context`)),
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Historique des prix de toutes natures (lots E4 et E5 : prix en vigueur à la date de chaque intervention). */
export function usePriceHistoryAll(farmId: string) {
  return useQuery({
    queryKey: [...pricesKey(farmId), "history", "all"],
    queryFn: () => api.get<{ items: Price[] }>(farmPath(farmId, "/prices?history=1")),
  });
}

/** Faits réalisés de la campagne précédente (lot E5). */
export function useEcoPrevious(farmId: string, year: number) {
  return useQuery({
    queryKey: [...pricesKey(farmId), "eco-previous", year],
    queryFn: () => api.get<RealizedFacts>(farmPath(farmId, `/crop-plans/${year}/eco-previous`)),
    staleTime: 5 * 60_000,
  });
}
