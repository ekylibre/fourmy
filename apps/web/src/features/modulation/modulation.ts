import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import type { AgrirouterRecipient, ModulationDate, ModulationZone, Prescription, PrescriptionFormat, PrescriptionSummary, VegetationIndex } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Cartes de modulation (lot AD, docs/modulation.md) côté web. */

export function usePrescriptions(farmId: string, parcelId?: string) {
  return useQuery({
    queryKey: ["prescriptions", farmId, parcelId ?? "all"],
    queryFn: () => api.get<{ items: PrescriptionSummary[] }>(farmPath(farmId, `/prescriptions${parcelId ? `?parcel=${parcelId}` : ""}`)),
  });
}

export function usePrescription(farmId: string, id: string) {
  return useQuery({
    queryKey: ["prescriptions", farmId, "one", id],
    queryFn: () => api.get<Prescription>(farmPath(farmId, `/prescriptions/${id}`)),
    // Envoi en attente (agrirouter injoignable) : l'historique se met à jour quand il part.
    refetchInterval: (q) => (q.state.data?.sends.some((s) => s.status === "queued") ? 30_000 : false),
  });
}

export function useModulationDates(farmId: string, parcelId: string | null, index: VegetationIndex) {
  return useQuery({
    queryKey: ["modulation-dates", farmId, parcelId, index],
    enabled: !!parcelId,
    queryFn: () => api.get<{ items: ModulationDate[] }>(farmPath(farmId, `/land-parcels/${parcelId}/modulation-dates?index=${index}`)),
  });
}

/** Destinataires agrirouter joignables ; absent si la ferme n'est pas connectée. */
export function useRecipients(farmId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["agrirouter-recipients", farmId],
    enabled,
    retry: false,
    queryFn: () => api.get<{ companyName: string | null; recipients: AgrirouterRecipient[] }>(farmPath(farmId, "/prescriptions/recipients")),
  });
}

/** Lien de téléchargement (cookie de session, même origine). */
export const fileUrl = (farmId: string, id: string, format: PrescriptionFormat) => `/api/v1${farmPath(farmId, `/prescriptions/${id}/files/${format}`)}`;

/** Couleurs des zones, de la plus faible (brique) à la plus forte (vert). */
const RAMP = ["#B03A2E", "#E67E22", "#F1C40F", "#8BC34A", "#2E7D32"];
export function zoneColor(code: number, count: number): string {
  if (count <= 1) return RAMP[2]!;
  const t = ((code - 1) / (count - 1)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t));
  const f = t - i;
  const mix = (a: string, b: string) => {
    const [ra, ga, ba] = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
    const [rb, gb, bb] = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
    const c = (x: number, y: number) => Math.round(x + (y - x) * f).toString(16).padStart(2, "0");
    return `#${c(ra!, rb!)}${c(ga!, gb!)}${c(ba!, bb!)}`;
  };
  return mix(RAMP[i]!, RAMP[i + 1]!);
}

export function zonesCollection(zones: (ModulationZone & { rate?: number })[], count: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      geometry: z.geometry,
      properties: { code: z.code, color: zoneColor(z.code, count), name: `Zone ${z.code}`, rate: z.rate ?? null },
    })),
  };
}

export const ha = (m2: number) => (m2 / 10_000).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const idx = (v: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qty = (v: number) => Math.round(v).toLocaleString("fr-FR");
