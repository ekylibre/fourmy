import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Alert, Anchor, Badge, Button, Checkbox, Group, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Send } from "lucide-react";
import {
  INDEX_SCALES,
  MODULATION_STRATEGY_LABELS,
  PRESCRIPTION_FORMAT_LABELS,
  PRESCRIPTION_UNIT_LABELS,
  PRESCRIPTION_UNIT_STEP,
  type Prescription,
  type PrescriptionFormat,
  type PrescriptionSend,
} from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate, formatDateTime } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { ParcelMap } from "../map/ParcelMap";
import { fileUrl, ha, idx, qty, usePrescription, useRecipients, zoneColor, zonesCollection } from "./modulation";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** Fiche d'une carte de modulation : zones et doses, téléchargements, envoi aux machines par agrirouter. */
export function PrescriptionPage() {
  const farm = useFarm();
  const { prescriptionId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const owner = farm.role === "owner";
  const q = usePrescription(farm.id, prescriptionId);
  const [rates, setRates] = useState<number[] | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["prescriptions", farm.id] });

  const saveRates = useMutation({
    mutationFn: (r: number[]) => api.put<Prescription>(farmPath(farm.id, `/prescriptions/${prescriptionId}/rates`), { rates: r }),
    onSuccess: () => {
      setRates(null);
      void refresh();
      notifications.show({ color: "lichen", message: "Doses enregistrées." });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(farmPath(farm.id, `/prescriptions/${prescriptionId}`)),
    onSuccess: () => {
      void refresh();
      navigate(`/f/${farm.id}/prescriptions${location.search}`);
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const p = q.data!;
  const unit = PRESCRIPTION_UNIT_LABELS[p.unit];
  const current = rates ?? p.zones.map((z) => z.rate);
  const area = p.zones.reduce((s, z) => s + z.areaM2, 0);
  const total = p.zones.reduce((s, z, k) => s + ((current[k] ?? z.rate) * z.areaM2) / 10_000, 0);
  const quantityUnit = p.unit === "kg_ha" ? "kg" : p.unit === "l_ha" ? "L" : "grains";

  return (
    <Stack>
      <div>
        <Anchor component={Link} to={`/f/${farm.id}/prescriptions${location.search}`} size="sm">
          ← Cartes de modulation
        </Anchor>
        <Title order={1}>{p.name}</Title>
        <Text size="sm" c="dimmed">
          <Anchor component={Link} to={`/f/${farm.id}/land-parcels/${p.parcelId}${location.search}`}>
            {p.parcelName}
          </Anchor>{" "}
          · {p.product} · {INDEX_SCALES[p.index].label} du {formatDate(p.date)} · {MODULATION_STRATEGY_LABELS[p.strategy]} · largeur {p.widthM} m
        </Text>
        {p.plan && (
          <Text size="sm" mt={4} aria-label="Apport du plan de fumure">
            Partie de l'apport « {p.plan.stage ?? "sans stade"} » du{" "}
            <Anchor component={Link} to={`/f/${farm.id}/fertilization/plans/${p.plan.planId}`}>
              plan de fumure
            </Anchor>{" "}
            : {qty(p.plan.targetRate)} {PRESCRIPTION_UNIT_LABELS[p.unit]} prévus, {qty(meanRate(p.zones))} {PRESCRIPTION_UNIT_LABELS[p.unit]} en moyenne sur la carte.
          </Text>
        )}
      </div>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder style={{ height: 380, overflow: "hidden" }}>
          <ParcelMap parcels={zonesCollection(p.zones, p.zoneCount)} places={EMPTY} track={EMPTY} basemap="ortho" minHeight={0} fillOpacity={0.6} />
        </Paper>
        <Paper p="md" withBorder>
          <Table aria-label="Zones et doses" className="lv-num">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Zone</Table.Th>
                <Table.Th>{INDEX_SCALES[p.index].label}</Table.Th>
                <Table.Th>Surface</Table.Th>
                <Table.Th>Dose ({unit})</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {p.zones.map((z, k) => (
                <Table.Tr key={z.code}>
                  <Table.Td>
                    <Group gap={6}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: zoneColor(z.code, p.zoneCount), display: "inline-block" }} />
                      Zone {z.code}
                    </Group>
                  </Table.Td>
                  <Table.Td>{idx(z.meanIndex)}</Table.Td>
                  <Table.Td>{ha(z.areaM2)} ha</Table.Td>
                  <Table.Td>
                    {owner ? (
                      <NumberInput
                        aria-label={`Dose zone ${z.code}`}
                        size="xs"
                        w={120}
                        min={0}
                        step={PRESCRIPTION_UNIT_STEP[p.unit]}
                        thousandSeparator=" "
                        value={current[k]}
                        onChange={(v) => {
                          const next = [...current];
                          next[k] = Number(v) || 0;
                          setRates(next);
                        }}
                      />
                    ) : (
                      qty(z.rate)
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="sm" mt="sm">
            Quantité totale : <b>{qty(total)} {quantityUnit}</b> sur {ha(area)} ha. Machine : {qty(p.minRate)} à {qty(p.maxRate)} {unit}.
          </Text>
          {rates && (
            <Group mt="sm">
              <Button size="xs" onClick={() => saveRates.mutate(rates)} loading={saveRates.isPending}>
                Enregistrer les doses
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setRates(null)}>
                Annuler
              </Button>
            </Group>
          )}
          {saveRates.error && <ErrorAlert error={saveRates.error} />}
        </Paper>
      </SimpleGrid>

      <Paper p="md" withBorder>
        <Title order={2} size="h4" mb={4}>
          Vers la machine
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          ISO-XML pour les consoles ISOBUS (tâche avec grille de doses) ; Shapefile pour les autres terminaux. Copiez l'archive dézippée sur une clé USB, ou
          envoyez-la par agrirouter.
        </Text>
        <Group>
          {(["isoxml", "shape"] as const).map((f) => (
            <Button key={f} component="a" href={fileUrl(farm.id, p.id, f)} download variant="light" leftSection={<Download size={16} />} disabled={!!rates}>
              {PRESCRIPTION_FORMAT_LABELS[f]}
            </Button>
          ))}
        </Group>
        {owner && <SendPanel prescription={p} disabled={!!rates} />}
        {p.sends.length > 0 && <SendHistory sends={p.sends} />}
      </Paper>

      {owner && (
        <Group>
          <Button variant="subtle" color="brique" onClick={() => remove.mutate()} loading={remove.isPending}>
            Supprimer la carte
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function SendPanel({ prescription: p, disabled }: { prescription: Prescription; disabled: boolean }) {
  const farm = useFarm();
  const location = useLocation();
  const queryClient = useQueryClient();
  const recipients = useRecipients(farm.id, true);
  const [format, setFormat] = useState<PrescriptionFormat>("isoxml");
  const [chosen, setChosen] = useState<string[]>([]);
  const send = useMutation({
    mutationFn: () => api.post<PrescriptionSend>(farmPath(farm.id, `/prescriptions/${p.id}/send`), { format, recipients: chosen }),
    onSuccess: () => {
      setChosen([]);
      notifications.show({ color: "lichen", message: "Carte transmise à agrirouter." });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["prescriptions", farm.id] }),
  });

  const notConnected = recipients.error instanceof ApiError && recipients.error.status === 400;
  if (recipients.isLoading) return <Loading />;
  if (notConnected) {
    return (
      <Text size="sm" c="dimmed" mt="md">
        Envoi direct aux machines : connectez la ferme à agrirouter dans{" "}
        <Anchor component={Link} to={`/f/${farm.id}/integrations${location.search}`}>
          Intégrations
        </Anchor>
        .
      </Text>
    );
  }
  if (recipients.error) return <ErrorAlert error={recipients.error} />;
  const list = recipients.data!.recipients.filter((r) => r.formats.includes(format));

  return (
    <Stack mt="md" gap="xs" aria-label="Envoi par agrirouter">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          Envoyer par agrirouter{recipients.data!.companyName ? ` (${recipients.data!.companyName})` : ""}
        </Text>
        <SegmentedControl
          size="xs"
          aria-label="Format d'envoi"
          value={format}
          onChange={(v) => {
            setFormat(v as PrescriptionFormat);
            setChosen([]);
          }}
          data={[
            { value: "isoxml", label: "ISO-XML" },
            { value: "shape", label: "Shapefile" },
          ]}
        />
      </Group>
      {list.length === 0 ? (
        <Alert color="paille">
          Aucun destinataire joignable pour ce format. Dans agrirouter, reliez une console (unité de communication) ou un logiciel à Fourmy par une
          route.
        </Alert>
      ) : (
        <Checkbox.Group value={chosen} onChange={setChosen} label="Destinataires">
          <Stack gap={4} mt={4}>
            {list.map((r) => (
              <Checkbox key={r.id} value={r.id} label={`${r.name}${r.endpointType === "virtual_communication_unit" ? " · machine" : ""}`} />
            ))}
          </Stack>
        </Checkbox.Group>
      )}
      {send.error && <ErrorAlert error={send.error} />}
      <Group>
        <Button leftSection={<Send size={16} />} onClick={() => send.mutate()} loading={send.isPending} disabled={disabled || chosen.length === 0}>
          Envoyer
        </Button>
        <Text size="xs" c="dimmed">
          « Envoyé » veut dire accepté par agrirouter ; la console la reçoit à sa prochaine connexion.
        </Text>
      </Group>
    </Stack>
  );
}

function SendHistory({ sends }: { sends: PrescriptionSend[] }) {
  return (
    <Table mt="md" aria-label="Envois" fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Date</Table.Th>
          <Table.Th>Format</Table.Th>
          <Table.Th>Destinataires</Table.Th>
          <Table.Th>Par</Table.Th>
          <Table.Th>État</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sends.map((s) => (
          <Table.Tr key={s.id}>
            <Table.Td className="lv-num">{formatDateTime(s.sentAt)}</Table.Td>
            <Table.Td>{s.format === "isoxml" ? "ISO-XML" : "Shapefile"}</Table.Td>
            <Table.Td>{s.recipients.map((r) => r.name).join(", ")}</Table.Td>
            <Table.Td>{s.sentBy ?? "—"}</Table.Td>
            <Table.Td>
              {s.status === "sent" ? (
                <Badge color="lichen" variant="light">
                  Envoyé
                </Badge>
              ) : (
                <Badge color="brique" variant="light" title={s.error ?? undefined}>
                  Refusé
                </Badge>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Dose moyenne pondérée par la surface des zones. */
const meanRate = (zones: { rate: number; areaM2: number }[]) => {
  const area = zones.reduce((s, z) => s + z.areaM2, 0);
  return area > 0 ? zones.reduce((s, z) => s + z.rate * z.areaM2, 0) / area : 0;
};
