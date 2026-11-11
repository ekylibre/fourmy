import { useQuery } from "@tanstack/react-query";
import type { CropModelAt, CropStageDate, ParcelCropSeries, WeatherBasis } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";

/** Modèle de croissance (lot AB, docs/modele-croissance.md) côté web. */

export function useCropModel(farmId: string, day: string, enabled = true) {
  return useQuery({
    queryKey: ["crop-model", farmId, day],
    enabled,
    queryFn: () => api.get<CropModelAt>(farmPath(farmId, `/crop-model?at=${day}`)),
    staleTime: 30 * 60_000,
  });
}

export function useParcelCropModel(farmId: string, parcelId: string, day: string) {
  return useQuery({
    queryKey: ["crop-model", farmId, day, parcelId],
    queryFn: () => api.get<ParcelCropSeries>(farmPath(farmId, `/land-parcels/${parcelId}/crop-model?at=${day}`)),
    staleTime: 30 * 60_000,
  });
}

export const BASIS_LABELS: Record<WeatherBasis, string> = {
  observed: "météo observée",
  forecast: "prévision météo",
  normals: "d'après les normales",
};

/** Date d'un stade : « 27/06/2026 », « vers le 27/06/2026 » si prévue ou d'après les normales, rien si hors d'atteinte. */
export function stageWhen(s: CropStageDate, day: string): string {
  if (!s.on) return "au-delà de la saison simulée";
  const past = s.on <= day && s.basis === "observed";
  return past ? formatDate(s.on) : `vers le ${formatDate(s.on)}`;
}

/**
 * Saisie d'une irrigation sur la parcelle (lot AC), datée du jour donné ;
 * réalisée ou planifiée selon la date. Dose proposée par le modèle, si connue.
 */
export function irrigationLink(farmId: string, parcelId: string, on: string, search: string, doseMm?: number) {
  const params = new URLSearchParams(search);
  params.set("at", on);
  params.set("procedure", "watering");
  params.set("parcels", parcelId);
  params.delete("status");
  if (doseMm) params.set("dose", String(Math.round(doseMm)));
  else params.delete("dose");
  return `/f/${farmId}/interventions/new?${params}`;
}
