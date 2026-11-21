import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ItkEquipmentInfo, ItkInputsContext, ItkMachineryRateInfo, ItkWorkContext } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Temps de travaux (lot IT4) : contexte de l'assolement, barème BCMA, rattachement des matériels. */
export function useItkWorkContext(farmId: string, year: number, opts: { routes?: boolean; enabled?: boolean } = {}) {
  const routes = opts.routes !== false;
  return useQuery({
    queryKey: ["itk-work", farmId, year, routes],
    queryFn: () => api.get<ItkWorkContext>(farmPath(farmId, `/crop-plans/${year}/itk-context${routes ? "" : "?routes=0"}`)),
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

export function useMachineryRates(farmId: string, procedure: string | null, q: string, enabled = true) {
  const params = new URLSearchParams({ q });
  if (procedure) params.set("procedure", procedure);
  return useQuery({
    queryKey: ["machinery-rates", farmId, procedure, q],
    queryFn: () => api.get<{ items: ItkMachineryRateInfo[] }>(farmPath(farmId, `/machinery-rates?${params}`)),
    enabled,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export type EquipmentRate = ItkEquipmentInfo & { rate: ItkMachineryRateInfo | null; suggested: ItkMachineryRateInfo | null };

export function useEquipmentRates(farmId: string) {
  return useQuery({
    queryKey: ["equipments-rates", farmId],
    queryFn: () => api.get<{ items: EquipmentRate[] }>(farmPath(farmId, "/equipments-rates")),
    staleTime: 60_000,
  });
}

export const fmtH = (h: number) => `${h.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;
export const fmtRate = (h: number) => `${h.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ha/h`;

/** Besoins en intrants (lot IT5) : articles, stock, réservé, plans de fumure. */
export function useItkInputsContext(farmId: string, year: number) {
  return useQuery({
    queryKey: ["itk-inputs", farmId, year],
    queryFn: () => api.get<ItkInputsContext>(farmPath(farmId, `/crop-plans/${year}/inputs-context`)),
    staleTime: 60_000,
  });
}
