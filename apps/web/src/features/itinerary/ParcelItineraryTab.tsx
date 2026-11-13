import { useState } from "react";
import { Select, SegmentedControl } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { TechnicalItinerary } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { ItineraryView, type ItineraryChartView } from "./ItineraryView";

/**
 * Onglet « Itinéraire technique » de la fiche parcelle (lot T2, E1, E4, E5) :
 * la campagne de la frise de l'application, ou la rotation sur plusieurs années.
 */
export function ParcelItineraryTab({ parcelId }: { parcelId: string }) {
  const farm = useFarm();
  const { day } = useAt();
  const year = Number(day.slice(0, 4));
  const [period, setPeriod] = useState<"campaign" | "rotation">("campaign");
  const [years, setYears] = useState(3);
  const [view, setView] = useState<ItineraryChartView>("horizontal");
  const span = period === "campaign" ? 1 : years;

  const itinerary = useQuery({
    queryKey: ["itinerary", "parcel", farm.id, parcelId, year, span],
    queryFn: () => api.get<TechnicalItinerary>(farmPath(farm.id, `/land-parcels/${parcelId}/itinerary?year=${year}&years=${span}`)),
  });

  const toolbar = (
    <>
      <SegmentedControl
        size="xs"
        value={period}
        onChange={(v) => setPeriod(v as "campaign" | "rotation")}
        data={[
          { value: "campaign", label: `Campagne ${year}` },
          { value: "rotation", label: "Rotation" },
        ]}
        aria-label="Période"
      />
      {period === "rotation" && (
        <Select
          size="xs"
          w={110}
          aria-label="Années de la rotation"
          value={String(years)}
          onChange={(v) => v && setYears(Number(v))}
          data={[3, 5, 10, 20].map((n) => ({ value: String(n), label: `${n} ans` }))}
          allowDeselect={false}
        />
      )}
    </>
  );

  if (itinerary.isLoading) return <Loading />;
  if (itinerary.error) return <ErrorAlert error={itinerary.error} />;
  return <ItineraryView itinerary={itinerary.data!} view={view} onView={setView} toolbar={toolbar} />;
}
