import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Badge, Button, Group, Paper, SegmentedControl, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { Gauge, Plus, Radio, Search } from "lucide-react";
import { equipmentKindLabel, equipmentStateLabel, type EquipmentSummary } from "@fourmy/contracts";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useEquipments } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { EquipmentLogo } from "./EquipmentLogo";
import { EquipmentFormModal, formatHours, ReadingModal } from "./EquipmentForms";

const inService = (e: EquipmentSummary) => !e.state || e.state === "active";

/**
 * Liste des matériels (FR-MAT-70) : nature, marque et modèle, état, dernier
 * relevé ; relevé rapide en ligne pour tout membre, création pour le
 * responsable. Les badges d'échéances viendront avec le plan d'entretien.
 */
export function EquipmentsPage() {
  const farm = useFarm();
  const location = useLocation();
  const navigate = useNavigate();
  const q = useEquipments(farm.id);
  const [state, setState] = useState<"active" | "all">("active");
  const [kind, setKind] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState<EquipmentSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const kinds = useMemo(() => [...new Set(items.map((e) => e.kind))].map((k) => ({ value: k, label: equipmentKindLabel(k) })), [items]);
  const needle = search.trim().toLowerCase();
  const shown = items.filter(
    (e) =>
      (state === "all" || inService(e)) &&
      (!kind || e.kind === kind) &&
      (!needle || [e.name, e.brand, e.model, e.serialNumber].some((v) => v?.toLowerCase().includes(needle))),
  );

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Matériels</Title>
        {farm.role === "owner" && (
          <Button leftSection={<Plus size={16} />} onClick={() => setCreating(true)}>
            Nouveau matériel
          </Button>
        )}
      </Group>
      <Group>
        <SegmentedControl
          value={state}
          onChange={(v) => setState(v as "active" | "all")}
          data={[
            { value: "active", label: "En service" },
            { value: "all", label: "Tous" },
          ]}
        />
        <Select placeholder="Toutes natures" data={kinds} value={kind} onChange={setKind} clearable aria-label="Nature" w={200} />
        <TextInput placeholder="Nom, marque, n° de série…" leftSection={<Search size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} aria-label="Rechercher" w={260} />
      </Group>
      <Paper withBorder>
        <Table highlightOnHover verticalSpacing="xs" aria-label="Matériels">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Matériel</Table.Th>
              <Table.Th>Nature</Table.Th>
              <Table.Th>Marque et modèle</Table.Th>
              <Table.Th>Dernier relevé</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((e) => (
              <Table.Tr key={e.id} style={{ opacity: inService(e) ? 1 : 0.6 }}>
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    <EquipmentLogo farmId={farm.id} assetId={e.logoAssetId} kind={e.kind} />
                    <Stack gap={0}>
                      <Link to={`/f/${farm.id}/equipments/${e.id}${location.search}`} style={{ fontWeight: 600 }}>
                        {e.name}
                      </Link>
                      <Group gap={4}>
                        {!inService(e) && (
                          <Badge size="xs" color="gray" variant="light">
                            {equipmentStateLabel(e.state)}
                          </Badge>
                        )}
                        {e.tracked && (
                          <Badge size="xs" variant="light" color="lichen" leftSection={<Radio size={10} />}>
                            Traccar
                          </Badge>
                        )}
                      </Group>
                    </Stack>
                  </Group>
                </Table.Td>
                <Table.Td>{equipmentKindLabel(e.kind)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{[e.brand, e.model].filter(Boolean).join(" · ") || "—"}</Text>
                  {e.serialNumber && (
                    <Text size="xs" c="dimmed">
                      n° {e.serialNumber}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {e.meterUnit ? (
                    e.lastReading ? (
                      <Stack gap={0}>
                        <Text size="sm" className="lv-num" fw={500}>
                          {formatHours(e.lastReading.value)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          le {formatDate(e.lastReading.readAt)}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">
                        Aucun relevé
                      </Text>
                    )
                  ) : (
                    <Text size="sm" c="dimmed">
                      Sans compteur
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {e.meterUnit && inService(e) && (
                    <Button size="compact-sm" variant="light" leftSection={<Gauge size={14} />} onClick={() => setReading(e)} aria-label={`Relevé de ${e.name}`}>
                      Relevé
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {shown.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Aucun matériel.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {reading && <ReadingModal farmId={farm.id} equipment={reading} onClose={() => setReading(null)} />}
      {creating && <EquipmentFormModal farmId={farm.id} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/f/${farm.id}/equipments/${id}${location.search}`)} />}
    </Stack>
  );
}
