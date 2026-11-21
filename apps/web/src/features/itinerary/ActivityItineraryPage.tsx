import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Anchor, Badge, Button, Grid, Group, Modal, Paper, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { ActivityItinerary, TechnicalItinerary } from "@fourmy/contracts";
import type { TikaRef } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useArea } from "../../app/prefs";
import { ErrorAlert, Loading } from "../../components/states";
import { ItineraryView, type ItineraryChartView } from "./ItineraryView";

/**
 * Itinéraire technique d'une activité végétale (lot T3, E2, E8 à E10, R3) :
 * frise fusionnée de ses parcelles pour la campagne, chantiers proches
 * regroupés ; un clic sur une parcelle descend sur son itinéraire.
 */
export function ActivityItineraryPage() {
  const farm = useFarm();
  const { activityId } = useParams();
  const { day } = useAt();
  const year = Number(day.slice(0, 4));
  const area = useArea();
  const [view, setView] = useState<ItineraryChartView>("horizontal");
  const [parcelId, setParcelId] = useState<string | null>(null);
  const [group, setGroup] = useState<TikaRef | null>(null);

  const merged = useQuery({
    queryKey: ["itinerary", "activity", farm.id, activityId, year],
    queryFn: () => api.get<ActivityItinerary>(farmPath(farm.id, `/activities/${activityId}/itinerary?year=${year}`)),
  });
  const parcel = useQuery({
    queryKey: ["itinerary", "parcel", farm.id, parcelId, year, 1],
    queryFn: () => api.get<TechnicalItinerary>(farmPath(farm.id, `/land-parcels/${parcelId}/itinerary?year=${year}&years=1`)),
    enabled: parcelId !== null,
  });

  if (merged.isLoading) return <Loading />;
  if (merged.error) return <ErrorAlert error={merged.error} />;
  const a = merged.data!;
  const silent = a.parcels.filter((p) => p.interventions === 0);
  const selected = a.parcels.find((p) => p.id === parcelId) ?? null;

  return (
    <Stack>
      <Button component={Link} to={`/f/${farm.id}/activities?at=${day}`} variant="subtle" leftSection={<ArrowLeft size={14} />} w="fit-content" px={0}>
        Activités
      </Button>
      <Group justify="space-between" wrap="wrap">
        <Title order={1}>Itinéraire technique — {a.title}</Title>
        <Group gap="xs">
          <Button component={Link} to={`/f/${farm.id}/itineraries?activityId=${activityId}`} variant="default" size="xs">
            Itinéraires prévus de l'activité
          </Button>
          {farm.role === "owner" && (
            <Button component={Link} to={`/f/${farm.id}/itineraries?activityId=${activityId}&derive=1`} variant="light" size="xs">
              Créer un itinéraire depuis l'historique
            </Button>
          )}
        </Group>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              Parcelles ({a.parcels.length})
            </Title>
            {a.parcels.length === 0 ? (
              <Text size="sm" c="dimmed">
                Aucune parcelle pour cette activité en {year}.
              </Text>
            ) : (
              <Table aria-label="Parcelles de l'activité" highlightOnHover>
                <Table.Tbody>
                  {a.parcels.map((p) => (
                    <Table.Tr key={p.id} bg={p.id === parcelId ? "var(--mantine-color-default-hover)" : undefined}>
                      <Table.Td>
                        <UnstyledButton onClick={() => setParcelId(p.id)} aria-label={`Itinéraire de ${p.name}`}>
                          <Text size="sm" fw={p.id === parcelId ? 700 : 400}>
                            {p.name}
                          </Text>
                          <Text size="xs" c="dimmed" className="lv-num">
                            {area(p.areaM2)}
                          </Text>
                        </UnstyledButton>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Badge variant="light" color={p.interventions ? "lichen" : "gray"} className="lv-num">
                          {p.interventions}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>
          <Stack>
            {silent.length > 0 && (
              <Alert color="paille" title={`${silent.length} parcelle${silent.length > 1 ? "s" : ""} sans intervention enregistrée en ${year}`}>
                {silent.map((p) => p.name).join(", ")} : la frise fusionnée ne les représente pas.
              </Alert>
            )}
            {selected ? (
              <>
                <Group justify="space-between">
                  <Text fw={700}>Parcelle sélectionnée : {selected.name}</Text>
                  <Button size="xs" variant="light" onClick={() => setParcelId(null)}>
                    Retour à la vue de l'activité
                  </Button>
                </Group>
                {parcel.isLoading ? <Loading /> : parcel.error ? <ErrorAlert error={parcel.error} /> : <ItineraryView itinerary={parcel.data!} view={view} onView={setView} />}
              </>
            ) : (
              <ItineraryView itinerary={a} view={view} onView={setView} onGroup={setGroup} />
            )}
          </Stack>
        </Grid.Col>
      </Grid>

      <Modal opened={group !== null} onClose={() => setGroup(null)} title={`${group?.interventionIds.length ?? 0} interventions regroupées`} size="lg">
        {group && <GroupList group={group} onParcel={(id) => (setGroup(null), setParcelId(id))} />}
      </Modal>
    </Stack>
  );
}

/** Marque regroupée : ses interventions (vers leur fiche) et ses parcelles (vers leur itinéraire). */
function GroupList({ group, onParcel }: { group: TikaRef; onParcel: (id: string) => void }) {
  const farm = useFarm();
  return (
    <Stack>
      <Table aria-label="Interventions regroupées">
        <Table.Tbody>
          {(group.members ?? group.interventionIds.map((id) => ({ interventionId: id, at: "", label: "Intervention", status: "done" as const, parcels: [] }))).map((m) => (
            <Table.Tr key={m.interventionId}>
              <Table.Td className="lv-num">{m.at ? formatDate(`${m.at}T12:00:00Z`) : ""}</Table.Td>
              <Table.Td>
                <Anchor component={Link} to={`/f/${farm.id}/interventions/${m.interventionId}`}>
                  {m.label}
                </Anchor>
                {m.status === "planned" && (
                  <Badge size="xs" variant="outline" ml={6}>
                    prévue
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{m.parcels.join(", ")}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Voir l'itinéraire de :
        </Text>
        {group.parcels.map((p) => (
          <Button key={p.id} size="compact-xs" variant="light" onClick={() => onParcel(p.id)}>
            {p.name}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
