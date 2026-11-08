import { Group, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, farmPath } from "../../app/api";
import { formatNumber } from "../../app/labels";

interface Balance {
  campaign: number;
  total: number;
  segments: Record<string, number>;
  pendingInterventions: number;
  parcels: { id: string; name: string; areaM2: number; ift: number; segments: Record<string, number> }[];
}

/**
 * Bilan IFT d'une campagne (exigence IFT-1) : IFT de la ferme (moyenne
 * pondérée par les surfaces, parcelles non traitées comprises), par segment
 * et par parcelle. Chaque traitement est calculé par l'API du ministère.
 */
export function IftBalance({ farmId, campaign }: { farmId: string; campaign: number }) {
  const q = useQuery({
    queryKey: ["ift-balance", farmId, campaign],
    queryFn: () => api.get<Balance>(farmPath(farmId, `/phyto/ift?campaign=${campaign}`)),
  });
  if (!q.data) return null;
  const b = q.data;
  const treated = b.parcels.filter((p) => p.ift > 0);
  return (
    <Paper p="md" withBorder aria-label="Bilan IFT">
      <Group justify="space-between" align="flex-start" mb="sm">
        <Stack gap={0}>
          <Title order={3}>IFT {b.campaign}</Title>
          <Text size="xs" c="dimmed">
            Indicateur de fréquence de traitements, calculé par l'API IFT du ministère de l'Agriculture.
          </Text>
        </Stack>
        <Stack gap={0} align="flex-end">
          <Text size="xl" fw={800} className="lv-num" aria-label="IFT de la ferme">
            {formatNumber(b.total, 2)}
          </Text>
          <Text size="xs" c="dimmed">
            moyenne de la ferme
          </Text>
        </Stack>
      </Group>
      {Object.keys(b.segments).length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} mb="sm">
          {Object.entries(b.segments).map(([segment, value]) => (
            <Paper key={segment} p="xs" bg="var(--mantine-color-gray-0)">
              <Text size="xs" c="dimmed">
                {segment}
              </Text>
              <Text fw={700} className="lv-num">
                {formatNumber(value, 2)}
              </Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}
      {b.pendingInterventions > 0 && (
        <Text size="sm" c="paille" mb="xs">
          {b.pendingInterventions} traitement(s) en attente de calcul : le bilan se complète automatiquement.
        </Text>
      )}
      {treated.length > 0 && (
        <Table aria-label="IFT par parcelle" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Parcelle</Table.Th>
              <Table.Th ta="right">Surface</Table.Th>
              <Table.Th ta="right">IFT</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {treated.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td ta="right" className="lv-num">
                  {formatHa(p.areaM2)}
                </Table.Td>
                <Table.Td ta="right" className="lv-num">
                  {formatNumber(p.ift, 2)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}
