import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ParcelIndexAt, ParcelIndexSeries, ParcelIndicesAt, RemoteSensingStatus, SatelliteImageRef } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/**
 * Télédétection côté web (docs/teledetection-design.md §8) : l'état observé
 * des parcelles à la date de la frise, les images de la carte et du plan 3D,
 * la série d'une parcelle. Tout passe par l'API Fourmy, jamais par Copernicus.
 */

export function useRemoteSensingStatus(farmId: string) {
  return useQuery({
    queryKey: ["remote-sensing-status", farmId],
    queryFn: () => api.get<RemoteSensingStatus>(farmPath(farmId, "/remote-sensing/status")),
    staleTime: 5 * 60_000,
  });
}

/** Dernière valeur NDVI de chaque parcelle et dernière image exploitable, à la date `day`. */
export function useParcelIndicesAt(farmId: string, day: string, enabled = true) {
  return useQuery({
    queryKey: ["remote-sensing-parcels", farmId, day],
    enabled,
    queryFn: () => api.get<ParcelIndicesAt>(farmPath(farmId, `/remote-sensing/parcels?at=${day}&index=ndvi`)),
    staleTime: 10 * 60_000,
  });
}

export function useParcelSeries(farmId: string, parcelId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["remote-sensing-series", farmId, parcelId, from, to],
    queryFn: () => api.get<ParcelIndexSeries>(farmPath(farmId, `/land-parcels/${parcelId}/indices?index=ndvi&from=${from}&to=${to}`)),
    staleTime: 10 * 60_000,
  });
}

/** Couche satellite affichée, partagée par la carte et le plan 3D et gardée dans l'URL (`?sat=`). */
export type SatelliteLayer = "none" | "ndvi" | "rgb" | "parcels";
const LAYERS: SatelliteLayer[] = ["none", "ndvi", "rgb", "parcels"];

export function useSatelliteLayer(): [SatelliteLayer, (next: SatelliteLayer) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("sat") as SatelliteLayer | null;
  const layer = raw && LAYERS.includes(raw) ? raw : "none";
  const set = useCallback(
    (next: SatelliteLayer) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (next === "none") n.delete("sat");
          else n.set("sat", next);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [layer, set];
}

/** Image à afficher pour la couche choisie (URL absolue : MapLibre et Cesium la chargent eux-mêmes, avec le cookie). */
export function imageFor(data: ParcelIndicesAt | undefined, layer: SatelliteLayer): (SatelliteImageRef & { href: string }) | null {
  if (!data || (layer !== "ndvi" && layer !== "rgb")) return null;
  const img = data.images.find((i) => i.kind === layer);
  return img ? { ...img, href: `${globalThis.location?.origin ?? ""}${img.url}` } : null;
}

export const byParcel = (data: ParcelIndicesAt | undefined) => new Map<string, ParcelIndexAt>((data?.items ?? []).map((i) => [i.parcelId, i]));

export const formatNdvi = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2).replace(".", ","));

/** Âge lisible d'une valeur (« il y a 3 j »). */
export const ageLabel = (days: number | null) => (days === null ? "" : days === 0 ? "du jour" : `il y a ${days} j`);
