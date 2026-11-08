import { Alert, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { api, farmPath } from "../../app/api";
import { formatDate, formatDateTime } from "../../app/labels";

interface Delays {
  reentry: { until: string; product: string } | null;
  harvest: { from: string; product: string } | null;
}

/**
 * Délais réglementaires en cours sur une parcelle à la date de la frise
 * (exigence PHY-4) : ré-entrée interdite, récolte pas encore possible.
 */
export function ParcelDelays({ farmId, parcelId, at }: { farmId: string; parcelId: string; at: string }) {
  const q = useQuery({
    queryKey: ["parcel-delays", farmId, parcelId, at],
    queryFn: () => api.get<Delays>(farmPath(farmId, `/phyto/parcels/${parcelId}/delays?at=${encodeURIComponent(at)}`)),
  });
  if (!q.data || (!q.data.reentry && !q.data.harvest)) return null;
  return (
    <Stack gap={4} aria-label="Délais en cours">
      {q.data.reentry && (
        <Alert color="brique" variant="light" p="xs">
          <Text size="sm">
            Ré-entrée interdite jusqu'au {formatDateTime(q.data.reentry.until)} ({q.data.reentry.product}).
          </Text>
        </Alert>
      )}
      {q.data.harvest && (
        <Alert color="paille" variant="light" p="xs">
          <Text size="sm">
            Récolte possible à partir du {formatDate(q.data.harvest.from)} ({q.data.harvest.product}).
          </Text>
        </Alert>
      )}
    </Stack>
  );
}
