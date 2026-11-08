import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Badge, Button, Drawer, Grid, Group, Paper, Stack, Table, Text, Timeline, Title } from "@mantine/core";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "lucide-react";
import type { FeatureCollection, Geometry } from "geojson";
import type { InterventionDetail, Snapshot, TrackReplay } from "@fourmy/contracts";
import { TREATMENT_PURPOSE_LABELS } from "@fourmy/contracts";
import { displayStatus } from "@fourmy/domain";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDateTime, formatNumber, formatPeriod, procedureLabel, unitLabel } from "../../app/labels";
import { useArticles, useIntervention, useParcelNames, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { MapBoundary } from "../../components/MapBoundary";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { ParcelMap } from "../map/ParcelMap";
import { CancelModal } from "./CancelModal";
import { InterventionForm } from "./InterventionForm";
import { actionLabel, changeLines, interventionDay, STATUS, targetName, type Names } from "./presenters";
import { ComplianceSection, IftSection } from "./RegulatorySections";
import { WeatherSummary } from "../weather/Weather";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };
const ORIGINS: Record<string, string> = { web: "Web", mobile: "Mobile", migration: "Reprise d'Ekylibre", plugin: "Extension" };

/**
 * Fiche d'une intervention (exigence INT-UI-2) : ce qui a été fait, où, avec
 * quoi et par qui, à la date de l'intervention (parcelles et surfaces de
 * cette date, pas de la frise), la trace GPS des matériels pendant les
 * périodes, et l'historique des modifications.
 */
export function InterventionPage() {
  const { interventionId } = useParams();
  const farm = useFarm();
  const detail = useIntervention(farm.id, interventionId!);
  if (detail.isLoading) return <Loading />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  return <InterventionSheet intervention={detail.data!} />;
}

function InterventionSheet({ intervention: i }: { intervention: InterventionDetail }) {
  const farm = useFarm();
  const location = useLocation();
  const day = interventionDay(i);
  const snap = useSnapshot(farm.id, day);
  const articles = useArticles(farm.id);
  const people = usePeople(farm.id);
  const parcelNames = useParcelNames(farm.id);
  const catalogue = useProcedures(farm.id);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const status = displayStatus(i, new Date().toISOString());
  const list = `/f/${farm.id}/interventions${location.search}`;

  const names: Names = {
    parcel: parcelNames.data ?? new Map(),
    equipment: new Map(snap.data?.equipments.map((e) => [e.id, e.name])),
    article: new Map(articles.data?.items.map((a) => [a.id, { name: a.name, unit: a.unit, amm: a.amm }])),
    person: new Map(people.data?.items.map((p) => [p.id, p.name])),
  };

  // Surfaces à la date de l'intervention : saisie (partielle), sinon parcelle.
  const parcelAt = new Map(snap.data?.landParcels.map((p) => [p.id, p]));
  const parcelTargets = i.targets.filter((t) => t.kind === "land_parcel");
  const areaOf = (t: (typeof i.targets)[number]) => t.workedAreaM2 ?? parcelAt.get(t.id)?.version.areaM2 ?? null;
  const treatedM2 = parcelTargets.reduce((sum, t) => sum + (areaOf(t) ?? 0), 0);
  const treatedHa = treatedM2 / 10_000;

  // Trace GPS des matériels pendant l'intervention (fenêtre de ses périodes).
  const tracks = useQueries({
    queries:
      i.startedAt && i.stoppedAt && i.status !== "planned"
        ? i.tools.map((t) => ({
            queryKey: ["track", farm.id, t.equipmentId, i.startedAt, i.stoppedAt],
            queryFn: () =>
              api.get<TrackReplay>(
                farmPath(farm.id, `/tracks?equipment=${t.equipmentId}&from=${encodeURIComponent(i.startedAt!)}&to=${encodeURIComponent(i.stoppedAt!)}`),
              ),
            staleTime: 5 * 60_000,
          }))
        : [],
  });
  const trackSamples = tracks.flatMap((q) => q.data?.samples ?? []);

  const layers = useMemo(() => mapLayers(i, snap.data), [i, snap.data]);
  const trackLayer = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: trackSamples.slice(1).map((s, k) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[trackSamples[k]![1], trackSamples[k]![2]], [s[1], s[2]]] },
        properties: { working: trackSamples[k]![3] === true },
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackSamples.length],
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Button component={Link} to={list} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
            Interventions
          </Button>
          <Group gap="sm">
            <ProcedureIcon procedure={i.procedure} size={32} />
            <Title order={1}>{procedureLabel(i.procedure)}</Title>
          </Group>
          <Group gap={6}>
            <Badge color={STATUS[status].color}>{STATUS[status].label}</Badge>
            <Badge variant="outline" color="gray">
              {ORIGINS[i.origin] ?? i.origin}
            </Badge>
          </Group>
        </Stack>
        {i.status !== "cancelled" && (
          <Group gap="xs">
            {i.status === "planned" && (
              <Button variant="light" onClick={() => setCompleting(true)} disabled={!catalogue.data || !snap.data || !articles.data}>
                Réaliser
              </Button>
            )}
            <Button component={Link} to={`modifier${location.search}`} leftSection={<Pencil size={16} />}>
              Modifier
            </Button>
            <Button variant="subtle" color="brique" onClick={() => setCancelling(true)}>
              Annuler l'intervention
            </Button>
          </Group>
        )}
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack>
            <Paper p="md" withBorder>
              <Title order={4} mb="xs">
                {i.status === "planned" && i.periods.length === 0 ? "Date prévue" : "Périodes de travail"}
              </Title>
              {i.periods.length ? (
                <Stack gap={2}>
                  {i.periods.map((p) => (
                    <Text key={p.startedAt} className="lv-num" size="sm">
                      {formatPeriod(p.startedAt, p.stoppedAt)}
                    </Text>
                  ))}
                </Stack>
              ) : (
                <Text size="sm">{formatDateTime(i.startedAt)}</Text>
              )}
            </Paper>

            <Paper p="md" withBorder>
              <Title order={4} mb="xs">
                {parcelTargets.length ? `Parcelles (${formatHa(treatedM2)} traités)` : "Cibles"}
              </Title>
              <Table aria-label="Cibles">
                <Table.Tbody>
                  {i.targets.map((t) => (
                    <Table.Tr key={t.id}>
                      <Table.Td>{targetName(names, t)}</Table.Td>
                      <Table.Td ta="right" className="lv-num">
                        {t.kind === "land_parcel" && areaOf(t) !== null ? formatHa(areaOf(t)!) : ""}
                        {t.workedAreaM2 ? " (surface travaillée)" : ""}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>

            {(i.inputs.length > 0 || i.outputs.length > 0) && (
              <Paper p="md" withBorder>
                <Title order={4} mb="xs">
                  Intrants et sorties
                </Title>
                <Table aria-label="Intrants et sorties">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Produit</Table.Th>
                      <Table.Th ta="right">Par hectare</Table.Th>
                      <Table.Th ta="right">Total</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[...i.inputs.map((q) => ({ ...q, role: "Intrant" })), ...i.outputs.map((q) => ({ ...q, role: "Sortie" }))].map((q, k) => {
                      const a = names.article.get(q.articleId);
                      const unit = unitLabel(q.unit);
                      const perHa = q.per === "hectare" ? q.quantity : treatedHa ? q.quantity / treatedHa : null;
                      const total = q.per === "total" ? q.quantity : treatedHa ? q.quantity * treatedHa : null;
                      return (
                        <Table.Tr key={k}>
                          <Table.Td>
                            {a?.name ?? "?"}{" "}
                            <Text span size="xs" c="dimmed">
                              {q.role}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right" className="lv-num" fw={q.per === "hectare" ? 600 : undefined}>
                            {perHa === null ? "—" : `${formatNumber(perHa, 3)} ${unit}/ha`}
                          </Table.Td>
                          <Table.Td ta="right" className="lv-num" fw={q.per === "total" ? 600 : undefined}>
                            {total === null ? "—" : `${formatNumber(total, 3)} ${unit}`}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
                <Text size="xs" c="dimmed" mt={4}>
                  En gras, la valeur saisie ; l'autre est calculée sur la surface traitée.
                </Text>
              </Paper>
            )}

            {i.weather && (
              <Paper p="md" withBorder aria-label="Météo de l'intervention">
                <Title order={4} mb="xs">
                  Météo
                </Title>
                <WeatherSummary weather={i.weather} />
              </Paper>
            )}

            <Paper p="md" withBorder>
              <Title order={4} mb="xs">
                Moyens
              </Title>
              <Stack gap={4}>
                <Text size="sm">
                  <strong>Matériels :</strong> {i.tools.map((t) => names.equipment.get(t.equipmentId) ?? "?").join(", ") || "—"}
                </Text>
                <Text size="sm">
                  <strong>Intervenants :</strong> {i.doers.map((d) => names.person.get(d.personId) ?? "?").join(", ") || "—"}
                </Text>
                {i.purposes.length > 0 && (
                  <Text size="sm">
                    <strong>Motifs :</strong> {i.purposes.map((p) => TREATMENT_PURPOSE_LABELS[p]).join(", ")}
                  </Text>
                )}
                {i.notes && (
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    <strong>Notes :</strong> {i.notes}
                  </Text>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack>
            {layers && (
              <Paper withBorder style={{ height: 320, overflow: "hidden" }}>
                <MapBoundary>
                  <ParcelMap parcels={layers.parcels} places={EMPTY_FC} zones={layers.zones} track={trackLayer} basemap="ortho" />
                </MapBoundary>
              </Paper>
            )}
            {trackSamples.length > 0 && (
              <Text size="xs" c="dimmed">
                Trace GPS des matériels pendant l'intervention (orange : travail, pointillés : transport).
              </Text>
            )}
            <ComplianceSection farmId={farm.id} intervention={i} />
            <IftSection farmId={farm.id} intervention={i} names={names} />
            <Paper p="md" withBorder>
              <Title order={4} mb="sm">
                Historique
              </Title>
              <History intervention={i} names={names} />
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>

      <Drawer opened={completing} onClose={() => setCompleting(false)} position="right" size="lg" title="Réaliser l'intervention">
        {completing && snap.data && articles.data && catalogue.data && (
          <InterventionForm
            farmId={farm.id}
            snapshot={snap.data}
            articles={articles.data.items}
            people={people.data?.items ?? []}
            catalogue={catalogue.data}
            planned={i}
            defaultDay={day.slice(0, 10)}
            onDone={() => setCompleting(false)}
          />
        )}
      </Drawer>
      <CancelModal farmId={farm.id} intervention={cancelling ? i : null} onClose={() => setCancelling(false)} />
    </Stack>
  );
}

/** Historique tiré du journal : qui, quand, quoi (avant → après), motif. */
function History({ intervention: i, names }: { intervention: InterventionDetail; names: Names }) {
  if (i.history.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {i.origin === "migration" ? "Importée d'Ekylibre ; aucune modification depuis dans Fourmy." : "Aucun historique."}
      </Text>
    );
  }
  return (
    <Timeline bulletSize={14} lineWidth={2} active={i.history.length - 1}>
      {i.history.map((h) => (
        <Timeline.Item key={h.id} title={actionLabel(h.action)}>
          <Text size="xs" c="dimmed">
            {formatDateTime(h.at)}
            {h.actorName ? ` · ${h.actorName}` : ""}
            {h.origin === "mobile" ? " · mobile" : ""}
          </Text>
          {h.reason && (
            <Text size="sm" fs="italic">
              « {h.reason} »
            </Text>
          )}
          {changeLines(names, h).map((c) => (
            <Text key={c.field} size="sm">
              <strong>{c.field} :</strong> {c.before} → {c.after}
            </Text>
          ))}
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

/** Parcelles ciblées (à la date de l'intervention) et zones travaillées, pour la mini-carte. */
function mapLayers(i: InterventionDetail, snap: Snapshot | undefined) {
  if (!snap) return null;
  const targeted = new Set(i.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id));
  const parcels: FeatureCollection = {
    type: "FeatureCollection",
    features: snap.landParcels
      .filter((p) => targeted.has(p.id))
      .map((p) => ({ type: "Feature", geometry: p.version.shape as unknown as Geometry, properties: { id: p.id, name: p.name, color: "#E8B500" } })),
  };
  const zones: FeatureCollection = {
    type: "FeatureCollection",
    features: i.targets
      .filter((t) => t.workingZone)
      .map((t) => ({ type: "Feature", geometry: t.workingZone as unknown as Geometry, properties: {} })),
  };
  return parcels.features.length ? { parcels, zones } : null;
}
