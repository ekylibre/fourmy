import { Link, useLocation } from "react-router";
import { Button, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { ArrowLeft, Package } from "lucide-react";
import { dueLabel } from "@fourmy/domain";
import { OPERATION_KIND_LABELS, PERFORMER_LABELS } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useEquipments, useFarmDues } from "../../app/queries";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";
import { EquipmentLogo } from "../equipments/EquipmentLogo";
import { DueBadge } from "./Maintenance";

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
      {farm.role === "owner" && (
        <Text size="sm">
          Réglages dans Ma ferme : <Link to={`/f/${farm.id}/farm?tab=maintenance`}>seuils et alertes d'entretien</Link>,{" "}
          <Link to={`/f/${farm.id}/farm?tab=tracks`}>parcours</Link>.
        </Text>
      )}
    </Stack>
  );
}
