import { Link, useLocation } from "react-router";
import { Anchor, Badge, Button, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { Plus } from "lucide-react";
import { INDEX_SCALES, PRESCRIPTION_UNIT_LABELS, type PrescriptionSummary } from "@fourmy/contracts";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { qty, usePrescriptions } from "./modulation";

/** Cartes de modulation de la ferme (lot AD). */
export function PrescriptionsPage() {
  const farm = useFarm();
  const location = useLocation();
  const q = usePrescriptions(farm.id);
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={1}>Cartes de modulation</Title>
          <Text size="sm" c="dimmed">
            Doses par zone d'après les images satellite, exportées en ISO-XML ou Shapefile, ou envoyées aux machines par agrirouter.
          </Text>
        </div>
        {farm.role === "owner" && (
          <Button component={Link} to={`/f/${farm.id}/prescriptions/new${location.search}`} leftSection={<Plus size={16} />}>
            Nouvelle carte
          </Button>
        )}
      </Group>
      {q.isLoading ? <Loading /> : q.error ? <ErrorAlert error={q.error} /> : <PrescriptionTable items={q.data!.items} />}
    </Stack>
  );
}

export function PrescriptionTable({ items, withParcel = true }: { items: PrescriptionSummary[]; withParcel?: boolean }) {
  const farm = useFarm();
  const location = useLocation();
  if (!items.length) {
    return (
      <Text size="sm" c="dimmed">
        Aucune carte de modulation.
      </Text>
    );
  }
  return (
    <Paper withBorder>
      <Table aria-label="Cartes de modulation" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Carte</Table.Th>
            {withParcel && <Table.Th>Parcelle</Table.Th>}
            <Table.Th>Produit</Table.Th>
            <Table.Th>Image</Table.Th>
            <Table.Th>Quantité</Table.Th>
            <Table.Th>Envoi</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>
                <Anchor component={Link} to={`/f/${farm.id}/prescriptions/${p.id}${location.search}`}>
                  {p.name}
                </Anchor>
              </Table.Td>
              {withParcel && <Table.Td>{p.parcelName}</Table.Td>}
              <Table.Td>{p.product}</Table.Td>
              <Table.Td className="lv-num">
                {INDEX_SCALES[p.index].label} {formatDate(p.date)} · {p.zoneCount} zones
              </Table.Td>
              <Table.Td className="lv-num">
                {qty(p.totalQuantity)} {p.unit === "kg_ha" ? "kg" : p.unit === "l_ha" ? "L" : "grains"}{" "}
                <Text span size="xs" c="dimmed">
                  ({PRESCRIPTION_UNIT_LABELS[p.unit]} {qty(p.baseRate)})
                </Text>
              </Table.Td>
              <Table.Td>
                {p.lastSentAt ? (
                  <Badge color="lichen" variant="light">
                    Envoyée le {formatDate(p.lastSentAt)}
                  </Badge>
                ) : (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/** Encadré de la fiche parcelle (onglet Végétation) : cartes de la parcelle et création. */
export function ParcelPrescriptions({ farmId, parcelId, owner }: { farmId: string; parcelId: string; owner: boolean }) {
  const location = useLocation();
  const q = usePrescriptions(farmId, parcelId);
  return (
    <Paper withBorder p="md" aria-label="Cartes de modulation">
      <Group justify="space-between" mb="xs">
        <div>
          <Title order={4}>Cartes de modulation</Title>
          <Text size="sm" c="dimmed">
            Zones de la parcelle d'après une image satellite, dose par zone, pour la console du tracteur.
          </Text>
        </div>
        {owner && (
          <Button size="compact-sm" variant="light" component={Link} to={`/f/${farmId}/prescriptions/new?${new URLSearchParams([...new URLSearchParams(location.search), ["parcel", parcelId]])}`}>
            Créer une carte de modulation
          </Button>
        )}
      </Group>
      {q.isLoading ? <Loading /> : q.error ? <ErrorAlert error={q.error} /> : <PrescriptionTable items={q.data!.items} withParcel={false} />}
    </Paper>
  );
}
