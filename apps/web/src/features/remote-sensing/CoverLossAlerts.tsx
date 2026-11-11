import { Link, useLocation } from "react-router";
import { Alert, Anchor, Badge, Button, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Satellite } from "lucide-react";
import { COVER_LOSS, type CoverLossAnomaly } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";
import { formatIndex, useRemoteSensingStatus } from "./remote-sensing";

/**
 * Interventions probablement manquantes (lot Z) : le satellite voit le couvert
 * d'une parcelle tomber au niveau du sol nu, et aucune récolte (ni broyage,
 * fauche, labour) n'est saisie de 7 jours avant à 30 jours après.
 */

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function useCoverLossAnomalies(farmId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["cover-loss", farmId, from, to],
    enabled,
    queryFn: () => api.get<{ items: CoverLossAnomaly[] }>(farmPath(farmId, `/remote-sensing/anomalies?from=${from}&to=${to}`)),
    staleTime: 10 * 60_000,
  });
}

function useDismiss(farmId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (a: CoverLossAnomaly) => api.post(farmPath(farmId, "/remote-sensing/anomalies/dismiss"), { parcelId: a.parcelId, to: a.to, reason: "Pas une récolte" }),
    onSuccess: (_r, a) => {
      void client.invalidateQueries({ queryKey: ["cover-loss", farmId] });
      notifications.show({ color: "lichen", message: `${a.parcelName} : signalement écarté.` });
    },
  });
}

/** Lien vers une nouvelle récolte réalisée sur la parcelle, datée du premier passage en sol nu. */
export function harvestLink(farmId: string, a: CoverLossAnomaly, search: string) {
  const params = new URLSearchParams(search);
  params.set("at", a.to);
  params.set("procedure", a.suggestedProcedure);
  params.set("status", "done");
  params.set("parcels", a.parcelId);
  return `/f/${farmId}/interventions/new?${params}`;
}

const why = (a: CoverLossAnomaly) =>
  `NDVI ${formatIndex(a.high)} le ${formatDate(a.from)}, ${formatIndex(a.low)} le ${formatDate(a.to)}${a.confirmed ? "" : " (une seule mesure basse)"}`;

/** Widget du tableau de bord : parcelles probablement récoltées sans intervention saisie, sur les 12 derniers mois. */
export function CoverLossWidget({ farmId, day }: { farmId: string; day: string }) {
  const location = useLocation();
  const status = useRemoteSensingStatus(farmId);
  const enabled = status.data?.enabled ?? false;
  const q = useCoverLossAnomalies(farmId, shift(day, -365), day, enabled);
  const dismiss = useDismiss(farmId);
  const items = q.data?.items ?? [];
  if (!enabled || items.length === 0) return null;
  return (
    <Paper p="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Satellite size={18} />
          <Title order={3}>À vérifier : récoltes probables non saisies</Title>
        </Group>
        <Badge color="paille">{items.length}</Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Le satellite voit ces parcelles passer au sol nu, mais aucune récolte, broyage, fauche ni labour n'est saisi dans les {COVER_LOSS.afterDays} jours qui suivent.
      </Text>
      <Table aria-label="Récoltes probables non saisies" verticalSpacing="xs">
        <Table.Tbody>
          {items.map((a) => (
            <Table.Tr key={`${a.parcelId}:${a.to}`}>
              <Table.Td>
                <Anchor component={Link} to={`/f/${farmId}/land-parcels/${a.parcelId}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), tab: "vegetation" })}`}>
                  {a.parcelName}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {why(a)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                  <Button component={Link} to={harvestLink(farmId, a, location.search)} size="compact-sm" variant="light">
                    Saisir la récolte
                  </Button>
                  <Button size="compact-sm" variant="subtle" color="gray" loading={dismiss.isPending && dismiss.variables === a} onClick={() => dismiss.mutate(a)}>
                    Ce n'est pas une récolte
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/** Bandeau de l'onglet Végétation : signalements de la parcelle sur la période affichée. */
export function CoverLossBanner({ farmId, items }: { farmId: string; items: CoverLossAnomaly[] }) {
  const location = useLocation();
  const dismiss = useDismiss(farmId);
  if (items.length === 0) return null;
  return (
    <Stack gap="xs">
      {items.map((a) => (
        <Alert key={a.to} color="paille" icon={<Satellite size={18} />} title="Récolte probable non saisie">
          <Text size="sm">
            {why(a)} : le couvert a disparu, mais aucune récolte, broyage, fauche ni labour n'est saisi entre le {formatDate(shift(a.from, -COVER_LOSS.beforeDays))} et
            le {formatDate(a.dueSince)}.
          </Text>
          <Group gap="xs" mt="xs">
            <Button component={Link} to={harvestLink(farmId, a, location.search)} size="compact-sm" variant="light">
              Saisir la récolte
            </Button>
            <Button size="compact-sm" variant="subtle" color="gray" loading={dismiss.isPending} onClick={() => dismiss.mutate(a)}>
              Ce n'est pas une récolte
            </Button>
          </Group>
        </Alert>
      ))}
    </Stack>
  );
}
