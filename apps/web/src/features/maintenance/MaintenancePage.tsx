import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Button, Group, MultiSelect, NumberInput, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Package } from "lucide-react";
import { dueLabel } from "@fourmy/domain";
import { OPERATION_KIND_LABELS, PERFORMER_LABELS, type MaintenanceSettings } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useEquipments, useFarmDues, useMembers } from "../../app/queries";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";
import { EquipmentLogo } from "../equipments/EquipmentLogo";
import { DueBadge } from "./Maintenance";
import { TrackSettingsPanel } from "../equipments/TrackSettingsPanel";

const DUE_COLUMNS: ColumnDef[] = [
  { key: "status", label: "État" },
  { key: "equipment", label: "Matériel", required: true },
  { key: "operation", label: "Opération" },
  { key: "due", label: "Échéance" },
];

/**
 * Tableau de bord de l'entretien (FR-MAT-24) : opérations en retard ou à
 * venir de tous les matériels, triées par urgence, à la date de la frise.
 */
export function MaintenancePage() {
  const farm = useFarm();
  const location = useLocation();
  const { at, isToday } = useAt();
  const q = useFarmDues(farm.id, at);
  const equipments = useEquipments(farm.id);
  const columns = useColumns("maintenance", DUE_COLUMNS);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const { items, byEquipment } = q.data!;
  const toFill = Object.entries(byEquipment).filter(([, c]) => c.unknown > 0);
  const logo = (id: string) => equipments.data?.items.find((e) => e.id === id);
  const link = (id: string) => {
    const p = new URLSearchParams(location.search);
    p.set("tab", "maintenance");
    return `/f/${farm.id}/equipments/${id}?${p}`;
  };

  return (
    <Stack>
      <Button component={Link} to={`/f/${farm.id}/equipments${location.search}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        Matériels
      </Button>
      <Group justify="space-between">
        <Title order={1}>Entretien{isToday ? "" : ` au ${formatDate(at)}`}</Title>
        <Group gap="xs">
          <Button component={Link} to={`/f/${farm.id}/maintenance/parts${location.search}`} variant="light" leftSection={<Package size={16} />}>
            Pièces à commander
          </Button>
          <ColumnPicker columns={columns} />
        </Group>
      </Group>
      <Paper withBorder>
        <Table aria-label="Échéances d'entretien" verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {columns.visible("status") && <Table.Th>État</Table.Th>}
              <Table.Th>Matériel</Table.Th>
              {columns.visible("operation") && <Table.Th>Opération</Table.Th>}
              {columns.visible("due") && <Table.Th>Échéance</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => {
              const e = logo(i.equipmentId);
              return (
                <Table.Tr key={i.operationId}>
                  {columns.visible("status") && (
                    <Table.Td>
                      <DueBadge status={i.due.status} />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <EquipmentLogo farmId={farm.id} assetId={e?.logoAssetId ?? null} kind={i.equipmentKind} size={24} />
                      <Link to={link(i.equipmentId)}>{i.equipmentName}</Link>
                    </Group>
                  </Table.Td>
                  {columns.visible("operation") && (
                    <Table.Td>
                      <Text size="sm">{i.label}</Text>
                      <Text size="xs" c="dimmed">
                        {OPERATION_KIND_LABELS[i.kind]}
                        {i.performer === "workshop" ? ` · ${PERFORMER_LABELS.workshop}` : ""}
                      </Text>
                    </Table.Td>
                  )}
                  {columns.visible("due") && (
                    <Table.Td>
                      <Text size="sm" c={i.due.status === "overdue" ? "brique" : undefined}>
                        {dueLabel(i.due)}
                      </Text>
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
            {items.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={columns.count}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Aucune opération en retard ni à venir.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {toFill.length > 0 && (
        <Paper withBorder p="md">
          <Title order={4} mb={4}>
            Échéances à renseigner
          </Title>
          <Text size="sm" c="dimmed" mb="xs">
            Sans dernière réalisation connue, Fourmy ne peut pas calculer ces échéances. Indiquez « Dernière fois » dans l'onglet Entretien du matériel.
          </Text>
          {toFill.map(([id, c]) => (
            <Text key={id} size="sm">
              <Link to={link(id)}>{logo(id)?.name ?? "Matériel"}</Link> : {c.unknown} opération(s)
            </Text>
          ))}
        </Paper>
      )}
      {farm.role === "owner" && <SettingsPanel farmId={farm.id} />}
      {farm.role === "owner" && <TrackSettingsPanel farmId={farm.id} />}
    </Stack>
  );
}

function SettingsPanel({ farmId }: { farmId: string }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["maintenance-settings", farmId], queryFn: () => api.get<MaintenanceSettings>(farmPath(farmId, "/settings/maintenance")) });
  const members = useMembers(farmId);
  const [hours, setHours] = useState<number | string | null>(null);
  const [months, setMonths] = useState<number | string | null>(null);
  const [notify, setNotify] = useState<string[] | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.put(farmPath(farmId, "/settings/maintenance"), {
        soonHours: Number(hours ?? q.data?.soonHours),
        soonMonths: Number(months ?? q.data?.soonMonths),
        notify: notify ?? q.data?.notify ?? [],
      }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Seuils enregistrés." });
      void queryClient.invalidateQueries({ queryKey: ["maintenance-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["maintenance-due"] });
      void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  if (!q.data) return null;
  return (
    <Paper withBorder p="md">
      <Title order={4} mb="xs">
        Réglages
      </Title>
      <Group align="flex-end">
        <NumberInput label="« Bientôt » : heures avant l'échéance" value={hours ?? q.data.soonHours} onChange={setHours} min={0} suffix=" h" w={240} />
        <NumberInput label="ou mois avant" value={months ?? q.data.soonMonths} onChange={setMonths} min={0} max={12} w={140} />
      </Group>
      <MultiSelect
        mt="sm"
        label="Prévenir par e-mail"
        description="Un récapitulatif quand une opération passe à « bientôt » ou « en retard » (une fois par échéance)."
        data={(members.data?.items ?? []).map((m) => ({ value: m.userId, label: m.name ? `${m.name} (${m.email})` : m.email }))}
        value={notify ?? q.data.notify ?? []}
        onChange={setNotify}
        maw={520}
      />
      <Button mt="sm" variant="default" onClick={() => save.mutate()} loading={save.isPending} disabled={hours === null && months === null && notify === null}>
        Enregistrer
      </Button>
    </Paper>
  );
}
