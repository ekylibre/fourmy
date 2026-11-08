import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Alert, Badge, Button, Grid, Group, Paper, Stack, Table, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { FeatureCollection, Geometry } from "geojson";
import type { ParcelSheet } from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDateTime, procedureLabel } from "../../app/labels";
import { useCertifications } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { MapBoundary } from "../../components/MapBoundary";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { ActivityBadge } from "../activities/ActivityBadge";
import { CertificationBadges, ParcelCertificationsModal } from "../certifications/Certifications";
import { ParcelMap } from "../map/ParcelMap";
import { SprayingConditions } from "../weather/Weather";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const STATUS: Record<string, string> = { done: "Réalisée", planned: "Planifiée", in_progress: "En cours" };

/**
 * Fiche d'une parcelle (lot H des retours du 08/11/2026), en onglets, sur le
 * modèle de l'identificateur de parcelle de Lexicon : général (carte,
 * activités par campagne, certifications), cultures déclarées à la PAC,
 * cadastre, eau à proximité, météo, interventions.
 */
export function ParcelSheetPage() {
  const { parcelId } = useParams();
  const farm = useFarm();
  const q = useQuery({
    queryKey: ["parcel-sheet", farm.id, parcelId],
    queryFn: () => api.get<ParcelSheet>(farmPath(farm.id, `/land-parcels/${parcelId}/sheet`)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return <Sheet sheet={q.data!} />;
}

function Sheet({ sheet: s }: { sheet: ParcelSheet }) {
  const farm = useFarm();
  const location = useLocation();
  const queryClient = useQueryClient();
  const certifications = useCertifications(farm.id);
  const [certifying, setCertifying] = useState(false);
  const owner = farm.role === "owner";
  const today = new Date().toISOString().slice(0, 10);
  const certs = (certifications.data?.items ?? []).filter((c) => c.landParcelId === s.id);
  const current = certs.filter((c) => c.startedOn <= today && (!c.stoppedOn || c.stoppedOn >= today));

  const refresh = useMutation({
    mutationFn: () => api.post(farmPath(farm.id, `/land-parcels/${s.id}/references/refresh`), {}),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Références PAC et cadastre actualisées." });
      void queryClient.invalidateQueries({ queryKey: ["parcel-sheet"] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });

  const parcel = useMemo<FeatureCollection>(
    () => ({ type: "FeatureCollection", features: [{ type: "Feature", geometry: s.shape as unknown as Geometry, properties: { id: s.id, name: s.name, color: "#E8B500" } }] }),
    [s],
  );
  const water = useMemo<FeatureCollection>(
    () => ({ type: "FeatureCollection", features: s.water.map((w) => ({ type: "Feature", geometry: w.geometry as unknown as Geometry, properties: { name: w.name, ditch: w.ditch, permanent: w.permanent } })) }),
    [s],
  );
  const cadastreLayer = useMemo<FeatureCollection>(
    () => ({ type: "FeatureCollection", features: s.cadastre.map((c) => ({ type: "Feature", geometry: c.geometry as unknown as Geometry, properties: {} })) }),
    [s],
  );
  // Parcelles cadastrales recoupées pour plus de 1 % de la parcelle (les autres : bords, imprécisions).
  const significant = s.cadastre.filter((c) => (c.overlapM2 ?? 0) >= s.areaM2 * 0.01);
  const capByYear = [...new Map(s.cap.map((c) => [c.year, c])).values()];

  return (
    <Stack>
      <Button component={Link} to={`/f/${farm.id}/activities${location.search}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        Activités
      </Button>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={1}>{s.name}</Title>
          <Group gap="xs">
            <Text className="lv-num">{formatHa(s.areaM2)}</Text>
            {s.productions[0]?.activity && <ActivityBadge activity={s.productions[0].activity} />}
            <CertificationBadges certs={current} />
          </Group>
        </Stack>
        {owner && (
          <Button variant="light" leftSection={<RefreshCw size={14} />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
            Actualiser PAC et cadastre
          </Button>
        )}
      </Group>

      <Tabs defaultValue="general" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="general">Général</Tabs.Tab>
          <Tabs.Tab value="crops">Cultures ({capByYear.length})</Tabs.Tab>
          <Tabs.Tab value="cadastre">Cadastre ({significant.length})</Tabs.Tab>
          <Tabs.Tab value="water">Eau à proximité ({s.water.filter((w) => !w.ditch).length})</Tabs.Tab>
          <Tabs.Tab value="weather">Météo</Tabs.Tab>
          <Tabs.Tab value="interventions">Interventions ({s.interventions.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Paper withBorder style={{ height: 420, overflow: "hidden" }}>
                <MapBoundary>
                  <ParcelMap parcels={parcel} places={EMPTY} track={EMPTY} water={water} basemap="ortho" minHeight={0} />
                </MapBoundary>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack>
                <Paper withBorder p="md">
                  <Title order={4} mb="xs">
                    Activités par campagne
                  </Title>
                  {s.productions.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      Aucune production.
                    </Text>
                  ) : (
                    <Table aria-label="Activités par campagne">
                      <Table.Tbody>
                        {s.productions.map((p, k) => (
                          <Table.Tr key={k}>
                            <Table.Td className="lv-num">{p.year}</Table.Td>
                            <Table.Td>{p.activity ? <ActivityBadge activity={p.activity} /> : "—"}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Paper>
                <Paper withBorder p="md">
                  <Group justify="space-between" mb="xs">
                    <Title order={4}>Certifications</Title>
                    <Button size="compact-sm" variant="subtle" onClick={() => setCertifying(true)}>
                      {owner ? "Gérer" : "Voir"}
                    </Button>
                  </Group>
                  {certs.length ? <CertificationBadges certs={certs} /> : <Text size="sm" c="dimmed">Aucune certification.</Text>}
                </Paper>
                <Paper withBorder p="md">
                  <Title order={4} mb="xs">
                    Identité
                  </Title>
                  <Stack gap={2}>
                    <Text size="sm">Surface : {formatHa(s.areaM2)}</Text>
                    <Text size="sm">Depuis le {formatDateTime(s.since).slice(0, 10)}{s.until ? `, jusqu'au ${formatDateTime(s.until).slice(0, 10)}` : ""}</Text>
                    {s.pacIslet && <Text size="sm">Parcelle PAC (RPG) : {s.pacIslet}</Text>}
                    <Text size="sm" className="lv-num">
                      Centre : {s.center[1].toFixed(5)}, {s.center[0].toFixed(5)}
                    </Text>
                  </Stack>
                </Paper>
              </Stack>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        <Tabs.Panel value="crops" pt="md">
          <Paper withBorder p="md">
            <Text size="sm" c="dimmed" mb="xs">
              Cultures déclarées à la PAC au centre de la parcelle (registre parcellaire graphique, IGN, 2015 à 2024), et productions dans Fourmy.
            </Text>
            <Table aria-label="Cultures déclarées à la PAC">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Campagne</Table.Th>
                  <Table.Th>Déclarée à la PAC</Table.Th>
                  <Table.Th ta="right">Surface déclarée</Table.Th>
                  <Table.Th>Dans Fourmy</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...new Set([...capByYear.map((c) => c.year), ...s.productions.map((p) => p.year)])]
                  .sort((a, b) => b - a)
                  .map((year) => {
                    const c = capByYear.find((x) => x.year === year);
                    const p = s.productions.find((x) => x.year === year);
                    return (
                      <Table.Tr key={year}>
                        <Table.Td className="lv-num">{year}</Table.Td>
                        <Table.Td>{c ? `${c.cropLabel ?? c.cropCode} (${c.cropCode})` : "—"}</Table.Td>
                        <Table.Td ta="right" className="lv-num">{c?.areaM2 ? formatHa(c.areaM2) : "—"}</Table.Td>
                        <Table.Td>{p?.activity ? <ActivityBadge activity={p.activity} /> : "—"}</Table.Td>
                      </Table.Tr>
                    );
                  })}
              </Table.Tbody>
            </Table>
            {s.cap.length === 0 && <References fetchedAt={s.referencesFetchedAt} />}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="cadastre" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Paper withBorder p="md">
                <Table aria-label="Parcelles cadastrales">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Parcelle cadastrale</Table.Th>
                      <Table.Th ta="right">Contenance</Table.Th>
                      <Table.Th ta="right">Dans la parcelle</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {significant.map((c) => (
                      <Table.Tr key={c.idu}>
                        <Table.Td>
                          {c.label}{" "}
                          <Text span size="xs" c="dimmed">
                            {c.idu}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right" className="lv-num">{c.areaM2 ? formatHa(c.areaM2) : "—"}</Table.Td>
                        <Table.Td ta="right" className="lv-num">{c.overlapM2 ? formatHa(c.overlapM2) : "—"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {s.cadastre.length > significant.length && (
                  <Text size="xs" c="dimmed" mt="xs">
                    {s.cadastre.length - significant.length} autre(s) parcelle(s) cadastrale(s) touchée(s) à la marge (moins de 1 % de la surface).
                  </Text>
                )}
                {s.cadastre.length === 0 && <References fetchedAt={s.referencesFetchedAt} />}
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Paper withBorder style={{ height: 380, overflow: "hidden" }}>
                <MapBoundary>
                  <ParcelMap parcels={parcel} places={EMPTY} track={EMPTY} zones={cadastreLayer} basemap="plan" minHeight={0} />
                </MapBoundary>
              </Paper>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        <Tabs.Panel value="water" pt="md">
          <Paper withBorder p="md">
            {s.water.length === 0 ? (
              <Text size="sm" c="dimmed">
                Aucun cours d'eau ni plan d'eau à moins de 250 m (BD TOPO, IGN).
              </Text>
            ) : (
              <Table aria-label="Eau à proximité">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nom</Table.Th>
                    <Table.Th>Nature</Table.Th>
                    <Table.Th ta="right">Distance</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {s.water.map((w) => (
                    <Table.Tr key={w.id}>
                      <Table.Td>{w.name ?? "Sans nom"}</Table.Td>
                      <Table.Td>
                        {w.ditch ? "Fossé (hors ZNT)" : w.kind === "area" ? "Plan d'eau" : w.permanent === false ? "Cours d'eau intermittent" : "Cours d'eau"}
                      </Table.Td>
                      <Table.Td ta="right" className="lv-num">
                        {w.distanceM === 0 ? <Badge color="brique" size="sm">touche la parcelle</Badge> : `${w.distanceM} m`}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="weather" pt="md">
          <SprayingConditions farmId={farm.id} />
        </Tabs.Panel>

        <Tabs.Panel value="interventions" pt="md">
          <Paper withBorder p="md">
            {s.interventions.length === 0 ? (
              <Text size="sm" c="dimmed">
                Aucune intervention sur cette parcelle.
              </Text>
            ) : (
              <Table aria-label="Interventions de la parcelle" highlightOnHover>
                <Table.Tbody>
                  {s.interventions.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td className="lv-num">{i.at ? formatDateTime(i.at) : "—"}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <ProcedureIcon procedure={i.procedure} />
                          <Link to={`/f/${farm.id}/interventions/${i.id}${location.search}`}>{procedureLabel(i.procedure)}</Link>
                        </Group>
                      </Table.Td>
                      <Table.Td>{STATUS[i.status] ?? i.status}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Tabs.Panel>
      </Tabs>
      <ParcelCertificationsModal parcel={certifying ? { id: s.id, name: s.name } : null} onClose={() => setCertifying(false)} />
    </Stack>
  );
}

function References({ fetchedAt }: { fetchedAt: string | null }) {
  return (
    <Alert color="ardoise" variant="light" mt="sm">
      {fetchedAt ? "Rien trouvé à la dernière actualisation." : "Références PAC et cadastre pas encore chargées : « Actualiser PAC et cadastre »."}
    </Alert>
  );
}
