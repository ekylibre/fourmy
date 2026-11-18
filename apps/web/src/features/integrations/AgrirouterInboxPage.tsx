import { Link } from "react-router";
import { Anchor, Badge, Button, Group, Paper, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { AgrirouterInboxItem } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
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
};

const size = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mo`);

/**
 * Boîte de réception agrirouter (lot AR2, responsable) : fichiers envoyés à
 * Fourmy par les machines et les autres logiciels. Ils sont rangés et
 * confirmés à agrirouter ; leur lecture (interventions proposées) viendra.
 */
export function AgrirouterInboxPage() {
  const farm = useFarm();
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
        Ce que vos machines et vos autres logiciels ont envoyé à Fourmy par agrirouter. Fourmy les garde et en accuse réception ; il proposera bientôt les interventions qu'ils décrivent.
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
                  <Table.Tr key={i.id}>
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
                      <Button size="xs" variant="subtle" component="a" href={`/api/v1${farmPath(farm.id, `/agrirouter/inbox/${i.id}/file`)}`} download>
                        Télécharger
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
    </Stack>
  );
}
