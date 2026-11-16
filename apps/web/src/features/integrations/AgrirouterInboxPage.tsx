import { Fragment } from "react";
import { Link, useNavigate } from "react-router";
import { Anchor, Badge, Button, Group, Paper, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgrirouterInboxDevice, AgrirouterInboxItem, AgrirouterInboxTask } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDateTime } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

/** Libellé d'un type de message agrirouter. */
export function messageTypeLabel(type: string): string {
  if (type === "iso:11783:-10:taskdata:zip") return "Tâches ISO-XML";
  if (type === "iso:11783:-10:time_log:protobuf") return "Enregistrement de travail (TimeLog)";
  if (type === "iso:11783:-10:device_description:protobuf") return "Description de machine";
  if (type === "shp:shape:zip") return "Shapefile";
  return type;
}

const STATE: Record<AgrirouterInboxItem["state"], { label: string; color: string }> = {
  received: { label: "Reçu", color: "ardoise" },
  proposed: { label: "Proposé", color: "paille" },
  validated: { label: "Validé", color: "lichen" },
  dismissed: { label: "Écarté", color: "gray" },
  unreadable: { label: "Illisible", color: "brique" },
  ignored: { label: "Sans suite", color: "gray" },
  merged: { label: "Versé aux parcours", color: "lichen" },
};

const size = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

/**
 * Boîte de réception agrirouter (lot AR2, responsable) : fichiers envoyés à
 * Fourmy par les machines et les autres logiciels. Ils sont rangés et
 * confirmés à agrirouter ; leur lecture (interventions proposées) viendra.
 */
/** Jour local (AAAA-MM-JJ) d'une date ISO : jour de l'intervention proposée. */
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Tâche réalisée lue dans un fichier : ce qui a été reconnu, et l'intervention à créer (lot AR4). */
function TaskProposal({ farmId, task, closed }: { farmId: string; task: AgrirouterInboxTask; closed: boolean }) {
  const navigate = useNavigate();
  const unknown = (label: string) => (
    <Text span c="paille.8">
      {label}
    </Text>
  );
  return (
    <Stack gap={2} aria-label={`Tâche ${task.designator}`}>
      <Text size="sm" fw={600}>
        {task.designator}
        {task.startedAt && ` — ${formatDateTime(task.startedAt)}`}
      </Text>
      <Text size="sm">
        Parcelle : {task.parcels.length ? task.parcels.map((p) => p.name).join(", ") : unknown("non reconnue")} · Matériel :{" "}
        {task.equipment?.name ?? unknown(task.deviceName ? `« ${task.deviceName} » non reconnu` : "non reconnu")}
      </Text>
      {(task.products.length > 0 || task.rates.length > 0) && (
        <Text size="sm">
          {task.products.length > 0 && `Produit : ${task.products.join(", ")}`}
          {task.rates.length > 0 && `${task.products.length ? " · " : ""}dose moyenne relevée ${task.rates.map((r) => `${r.value} ${r.unit}`).join(", ")}`}
        </Text>
      )}
      {task.prescription && (
        <Text size="sm">
          Carte de modulation :{" "}
          <Anchor component={Link} to={`/f/${farmId}/prescriptions/${task.prescription.id}`}>
            {task.prescription.name}
          </Anchor>
        </Text>
      )}
      <Group gap="xs" mt={4}>
        {task.interventionId ? (
          <Anchor component={Link} to={`/f/${farmId}/interventions/${task.interventionId}`} size="sm">
            Intervention enregistrée
          </Anchor>
        ) : (
          !closed && (
            <Button
              size="xs"
              onClick={() =>
                navigate(`/f/${farmId}/interventions/new${task.startedAt ? `?at=${dayOf(task.startedAt)}` : ""}`, { state: { trackDraft: task.draft } })
              }
            >
              Créer l'intervention
            </Button>
          )
        )}
      </Group>
    </Stack>
  );
}

/** Machine d'une description reçue : matériel reconnu, largeur proposée (lot AR5). */
function DeviceLine({ farmId, inboxId, device }: { farmId: string; inboxId: string; device: AgrirouterInboxDevice }) {
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: () => api.post<AgrirouterInboxItem>(farmPath(farmId, `/agrirouter/inbox/${inboxId}/devices/${device.index}/apply`), {}),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: `Largeur de travail de ${device.equipment?.name ?? device.designator} mise à jour.` });
      void queryClient.invalidateQueries({ queryKey: ["agrirouter-inbox", farmId] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? (e.detail ?? e.message) : String(e) }),
  });
  return (
    <Group gap="xs" aria-label={`Machine ${device.designator}`}>
      <Text size="sm">
        <b>{device.designator}</b>
        {device.serial && ` (n° ${device.serial})`} :{" "}
        {device.equipment ? (
          <Anchor component={Link} to={`/f/${farmId}/equipments/${device.equipment.id}`}>
            {device.equipment.name}
          </Anchor>
        ) : (
          <Text span c="paille.8">
            matériel non reconnu
          </Text>
        )}
        {device.workingWidthM !== null && ` · largeur ${device.workingWidthM} m`}
        {device.sections > 0 && ` · ${device.sections} section${device.sections > 1 ? "s" : ""}`}
        {device.proposeWidth && device.currentWidthM !== null && !device.applied && ` (fiche : ${device.currentWidthM} m)`}
      </Text>
      {device.proposeWidth && !device.applied && (
        <Button size="compact-xs" variant="light" onClick={() => apply.mutate()} loading={apply.isPending}>
          Reporter {device.workingWidthM} m sur la fiche
        </Button>
      )}
      {device.applied && (
        <Text size="xs" c="dimmed">
          reportée sur la fiche
        </Text>
      )}
    </Group>
  );
}

export function AgrirouterInboxPage() {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post<AgrirouterInboxItem>(farmPath(farm.id, `/agrirouter/inbox/${id}/dismiss`), {}),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["agrirouter-inbox", farm.id],
      }),
    onError: (e) =>
      notifications.show({
        color: "brique",
        message: e instanceof ApiError ? (e.detail ?? e.message) : String(e),
      }),
  });
  const inbox = useQuery({
    queryKey: ["agrirouter-inbox", farm.id],
    queryFn: () => api.get<{ items: AgrirouterInboxItem[] }>(farmPath(farm.id, "/agrirouter/inbox")),
  });
  if (inbox.isLoading) return <Loading />;
  if (inbox.error) return <ErrorAlert error={inbox.error} />;
  const items = inbox.data!.items;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Fichiers reçus d'agrirouter</Title>
        <Anchor component={Link} to={`/f/${farm.id}/integrations`}>
          Intégrations
        </Anchor>
      </Group>
      <Text c="dimmed" size="sm">
        Ce que vos machines et vos autres logiciels ont envoyé à Fourmy par agrirouter. Pour chaque travail réalisé, Fourmy propose l'intervention à enregistrer
        : vérifiez-la, complétez-la, ou écartez le fichier.
      </Text>
      <Paper p="md">
        {items.length === 0 ? (
          <Text c="dimmed">Aucun fichier reçu pour l'instant.</Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table aria-label="Fichiers reçus d'agrirouter">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Reçu le</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Fichier</Table.Th>
                  <Table.Th>État</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((i) => (
                  <Fragment key={i.id}>
                    <Table.Tr>
                      <Table.Td>{formatDateTime(i.receivedAt)}</Table.Td>
                      <Table.Td>
                        {messageTypeLabel(i.messageType)}
                        {i.senderName && (
                          <Text size="xs" c="dimmed">
                            de {i.senderName}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {i.filename ?? "—"}{" "}
                        <Text span size="xs" c="dimmed">
                          ({size(i.size)})
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Badge color={STATE[i.state].color}>{STATE[i.state].label}</Badge>
                          {!i.confirmedAt && (
                            <Tooltip label={i.confirmError ?? "Accusé de réception à envoyer à agrirouter"}>
                              <Badge color={i.confirmError ? "brique" : "paille"} variant="light">
                                Non confirmé
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Button size="xs" variant="subtle" component="a" href={`/api/v1${farmPath(farm.id, `/agrirouter/inbox/${i.id}/file`)}`} download>
                            Télécharger
                          </Button>
                          {["received", "proposed", "ignored", "unreadable"].includes(i.state) && (
                            <Button
                              size="xs"
                              variant="subtle"
                              color="gray"
                              onClick={() => dismiss.mutate(i.id)}
                              loading={dismiss.isPending && dismiss.variables === i.id}
                            >
                              Écarter
                            </Button>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {(i.tasks.length > 0 || i.devices.length > 0 || i.telemetry || i.error) && (
                      <Table.Tr>
                        <Table.Td colSpan={5}>
                          <Stack gap="sm" pl="md">
                            {i.error && (
                              <Text size="sm" c={i.state === "unreadable" ? "brique.7" : "dimmed"}>
                                {i.error}
                              </Text>
                            )}
                            {i.tasks.map((t) => (
                              <TaskProposal key={t.index} farmId={farm.id} task={t} closed={i.state === "dismissed"} />
                            ))}
                            {i.devices.map((d) => (
                              <DeviceLine key={d.index} farmId={farm.id} inboxId={i.id} device={d} />
                            ))}
                            {i.telemetry && (
                              <Text size="sm">
                                {i.telemetry.positions} position{i.telemetry.positions > 1 ? "s" : ""} du {formatDateTime(i.telemetry.from)} au{" "}
                                {formatDateTime(i.telemetry.to)} versée{i.telemetry.positions > 1 ? "s" : ""} dans les{" "}
                                <Anchor component={Link} to={`/f/${farm.id}/equipments/${i.telemetry.equipment.id}?tab=tracks`}>
                                  parcours de {i.telemetry.equipment.name}
                                </Anchor>
                                {i.telemetry.tool && ` (attelé : ${i.telemetry.tool})`}.
                              </Text>
                            )}
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
    </Stack>
  );
}
