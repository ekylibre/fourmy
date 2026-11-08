import { Badge, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { formatHa, formatLiters } from "@fourmy/ui-lyvre";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, NATURE_LABELS, procedureLabel } from "../../app/labels";
import { useInterventions, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { SprayingConditions } from "../weather/Weather";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper p="md">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: "0.06em" }}>
        {label}
      </Text>
      <Text className="lv-num" fz={28} fw={600} mt={4}>
        {value}
      </Text>
      {hint && (
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

/** Tableau de bord : la ferme à la date de la frise. */
export function DashboardPage() {
  const farm = useFarm();
  const { at, day, isToday } = useAt();
  const snap = useSnapshot(farm.id, at);
  const from = new Date(Date.parse(at) - 30 * 86_400_000).toISOString();
  const recent = useInterventions(farm.id, from, at);

  if (snap.isLoading) return <Loading />;
  if (snap.error) return <ErrorAlert error={snap.error} />;
  const s = snap.data!;

  const totalArea = s.landParcels.reduce((sum, p) => sum + p.version.areaM2, 0);
  const byNature = new Map<string, number>();
  for (const p of s.productions) byNature.set(p.nature, (byNature.get(p.nature) ?? 0) + 1);
  const volume = s.containers.reduce((sum, c) => sum + Math.max(c.volumeL, 0), 0);
  const capacity = s.containers.reduce((sum, c) => sum + c.version.capacityL, 0);

  return (
    <Stack>
      <Title order={1}>{isToday ? "Aujourd'hui" : `Au ${formatDate(at)}`}</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Kpi label="Parcelles" value={String(s.landParcels.length)} hint={formatHa(totalArea)} />
        <Kpi
          label="Productions de la campagne"
          value={String(s.productions.length)}
          hint={[...byNature].map(([n, c]) => `${c} ${NATURE_LABELS[n] ?? n}`).join(" · ") || "aucune"}
        />
        <Kpi
          label="Cuverie"
          value={s.containers.length ? formatLiters(volume) : "—"}
          hint={s.containers.length ? `${s.containers.length} cuves · capacité ${formatLiters(capacity)}` : "aucune cuve"}
        />
        <Kpi label="Matériels" value={String(s.equipments.length)} />
      </SimpleGrid>

      {/* Prévisions : seulement quand la frise est sur aujourd'hui. */}
      {isToday && <SprayingConditions farmId={farm.id} />}

      <Paper p="md">
        <Title order={3} mb="sm">
          Interventions des 30 derniers jours
        </Title>
        {recent.isLoading && <Loading />}
        {recent.data && recent.data.items.length === 0 && (
          <Text c="dimmed">Aucune intervention entre le {formatDate(from)} et le {formatDate(day)}.</Text>
        )}
        {recent.data && recent.data.items.length > 0 && (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Intervention</Table.Th>
                <Table.Th>Statut</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recent.data.items
                .slice(-10)
                .reverse()
                .map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td className="lv-num">{formatDate(i.stoppedAt ?? i.startedAt)}</Table.Td>
                    <Table.Td>{procedureLabel(i.procedure)}</Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Badge color={i.status === "done" ? "lichen" : "paille"}>{i.status === "done" ? "Réalisée" : "Planifiée"}</Badge>
                        {i.origin === "mobile" && <Badge color="ardoise">Mobile</Badge>}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}
