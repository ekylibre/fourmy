import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { PencilRuler } from "lucide-react";
import { Badge, Button, Grid, Group, Paper, SegmentedControl, Select, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection, Geometry } from "geojson";
import type { TrackCoverage, TrackReplay } from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, NATURE_COLORS, NATURE_LABELS } from "../../app/labels";
import { useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { MapBoundary } from "../../components/MapBoundary";
import { ParcelMap, type Basemap } from "./ParcelMap";
import { ParcelDelays } from "./ParcelDelays";

/** Carte 2D : parcellaire à la date de la frise, bâtiments, trace GPS du jour (US-1). */
export function MapPage() {
  const farm = useFarm();
  const location = useLocation();
  const { at, day } = useAt();
  const snap = useSnapshot(farm.id, at);
  const [basemap, setBasemap] = useState<Basemap>("ortho");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [showTrack, setShowTrack] = useState(false);

  const from = new Date(`${day}T00:00:00`).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00`) + 86_400_000).toISOString();
  const q = `equipment=${equipment}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const track = useQuery({
    queryKey: ["track", farm.id, equipment, day],
    enabled: showTrack && !!equipment,
    queryFn: () => api.get<TrackReplay>(farmPath(farm.id, `/tracks?${q}`)),
  });
  const coverage = useQuery({
    queryKey: ["coverage", farm.id, equipment, day],
    enabled: showTrack && !!equipment,
    queryFn: () => api.get<TrackCoverage>(farmPath(farm.id, `/tracks/coverage?${q}`)),
  });

  const layers = useMemo(() => {
    const s = snap.data;
    if (!s) return null;
    const nature = new Map(s.productions.map((p) => [p.landParcelId, p.nature]));
    const parcels: FeatureCollection = {
      type: "FeatureCollection",
      features: s.landParcels.map((p) => ({
        type: "Feature",
        geometry: p.version.shape as unknown as Geometry,
        properties: {
          id: p.id,
          name: p.name,
          areaM2: p.version.areaM2,
          nature: nature.get(p.id) ?? "none",
          color: NATURE_COLORS[nature.get(p.id) ?? "none"],
          variety: p.version.viti?.variety ?? null,
        },
      })),
    };
    const places: FeatureCollection = {
      type: "FeatureCollection",
      features: s.places
        .filter((p) => p.version.footprint)
        .map((p) => ({ type: "Feature", geometry: p.version.footprint as unknown as Geometry, properties: { name: p.name } })),
    };
    return { parcels, places };
  }, [snap.data]);

  const trackLayer = useMemo<FeatureCollection>(() => {
    const samples = showTrack ? (track.data?.samples ?? []) : [];
    return {
      type: "FeatureCollection",
      features: samples.slice(1).map((s, i) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[samples[i]![1], samples[i]![2]], [s[1], s[2]]] },
        properties: { working: samples[i]![3] === true },
      })),
    };
  }, [track.data, showTrack]);

  if (snap.isLoading) return <Loading />;
  if (snap.error) return <ErrorAlert error={snap.error} />;
  const s = snap.data!;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Carte au {formatDate(at)}</Title>
        <Group>
        <Button component={Link} to={`/f/${farm.id}/map/tools${location.search}`} variant="default" leftSection={<PencilRuler size={16} />}>
          Outils de dessin (essai)
        </Button>
        <SegmentedControl
          value={basemap}
          onChange={(v) => setBasemap(v as Basemap)}
          data={[
            { value: "ortho", label: "Photo aérienne" },
            { value: "plan", label: "Plan IGN" },
          ]}
        />
        </Group>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }} style={{ height: "68vh" }}>
          {layers && (
            <MapBoundary>
              <ParcelMap parcels={layers.parcels} places={layers.places} track={trackLayer} basemap={basemap} onSelect={setSelected} />
            </MapBoundary>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack>
            <Paper p="md">
              <Title order={4} mb="xs">
                Légende
              </Title>
              <Group gap="xs">
                {Object.entries(NATURE_LABELS).map(([k, label]) => (
                  <Badge key={k} variant="dot" color={NATURE_COLORS[k]}>
                    {label}
                  </Badge>
                ))}
              </Group>
              <Text size="sm" c="dimmed" mt="xs">
                {s.landParcels.length} parcelles · {formatHa(s.landParcels.reduce((a, p) => a + p.version.areaM2, 0))}
              </Text>
            </Paper>
            {selected && (
              <Paper p="md">
                <Title order={4}>{String(selected.name)}</Title>
                <Text>{formatHa(Number(selected.areaM2))}</Text>
                <Text c="dimmed">{NATURE_LABELS[String(selected.nature)] ?? "Sans production cette campagne"}</Text>
                {typeof selected.variety === "string" && selected.variety !== "null" && <Badge color="lichen">{selected.variety}</Badge>}
                <ParcelDelays farmId={farm.id} parcelId={String(selected.id)} at={at} />
                <Button component={Link} to={`/f/${farm.id}/land-parcels/${String(selected.id)}${location.search}`} variant="light" size="xs" w="fit-content">
                  Fiche de la parcelle
                </Button>
              </Paper>
            )}
            <Paper p="md">
              <Title order={4} mb="xs">
                Trace GPS du {formatDate(at)}
              </Title>
              <Group align="flex-end" wrap="nowrap">
                <Select
                  label="Matériel"
                  placeholder="Choisir"
                  data={s.equipments.map((e) => ({ value: e.id, label: e.name }))}
                  value={equipment}
                  onChange={(v) => {
                    setEquipment(v);
                    setShowTrack(false);
                  }}
                  searchable
                  style={{ flex: 1 }}
                />
                <Button disabled={!equipment} onClick={() => setShowTrack(true)} loading={track.isFetching}>
                  Afficher
                </Button>
              </Group>
              {showTrack && track.data && track.data.samples.length === 0 && (
                <Text c="dimmed" size="sm" mt="sm">
                  Aucune position ce jour-là.
                </Text>
              )}
              {showTrack && track.data && track.data.samples.length > 0 && (
                <Text size="sm" mt="sm">
                  {track.data.rawCount} positions ({track.data.samples.length} après simplification).{" "}
                  <Text span c="#E85D04" fw={600}>
                    Travail
                  </Text>{" "}
                  / <Text span c="ardoise">transport</Text>.
                </Text>
              )}
              {showTrack && coverage.data && coverage.data.byParcel.length > 0 && (
                <Table mt="sm" fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Parcelle</Table.Th>
                      <Table.Th ta="right">Travaillé</Table.Th>
                      <Table.Th ta="right">Durée</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {coverage.data.byParcel.map((p) => (
                      <Table.Tr key={p.landParcelId}>
                        <Table.Td>{p.parcelName}</Table.Td>
                        <Table.Td ta="right" className="lv-num">
                          {formatHa(p.areaM2)}
                        </Table.Td>
                        <Table.Td ta="right" className="lv-num">
                          {Math.round(p.durationS / 60)} min
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
