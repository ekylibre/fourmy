import { useState } from "react";
import { Badge, Drawer, Group, Paper, Progress, SimpleGrid, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { TankGauge, formatLiters } from "@fourmy/ui-lyvre";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useContainerContents, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";

/** Cuverie à la date de la frise : jauges par bâtiment, contenu au clic (US-9). */
export function CellarPage() {
  const farm = useFarm();
  const { at } = useAt();
  const snap = useSnapshot(farm.id, at);
  const [selected, setSelected] = useState<string | null>(null);

  if (snap.isLoading) return <Loading />;
  if (snap.error) return <ErrorAlert error={snap.error} />;
  const s = snap.data!;
  const placeName = new Map(s.places.map((p) => [p.id, p.name]));
  const byPlace = new Map<string, typeof s.containers>();
  for (const c of s.containers) byPlace.set(c.placeId, [...(byPlace.get(c.placeId) ?? []), c]);
  const tank = s.containers.find((c) => c.id === selected);

  return (
    <Stack>
      <Title order={1}>Cuverie</Title>
      {s.containers.length === 0 && <Text c="dimmed">Aucune cuve à cette date.</Text>}
      {[...byPlace].map(([placeId, tanks]) => (
        <Stack key={placeId} gap="sm">
          <Title order={3}>{placeName.get(placeId) ?? "Bâtiment"}</Title>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 6 }}>
            {tanks.map((c) => (
              <UnstyledButton key={c.id} onClick={() => setSelected(c.id)} aria-label={`Contenu de ${c.name}`}>
                <Paper p="md">
                  <Group wrap="nowrap" align="flex-end">
                    <TankGauge volumeL={c.volumeL} capacityL={c.version.capacityL} />
                    <Stack gap={0}>
                      <Text fw={700}>{c.name}</Text>
                      <Text className="lv-num" size="sm">
                        {formatLiters(c.volumeL)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        sur {formatLiters(c.version.capacityL)}
                      </Text>
                    </Stack>
                  </Group>
                </Paper>
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Stack>
      ))}
      <Drawer opened={!!tank} onClose={() => setSelected(null)} position="right" size="md" title={tank?.name}>
        {tank && <TankContents farmId={farm.id} containerId={tank.id} at={at} capacityL={tank.version.capacityL} />}
      </Drawer>
    </Stack>
  );
}

function TankContents({ farmId, containerId, at, capacityL }: { farmId: string; containerId: string; at: string; capacityL: number }) {
  const contents = useContainerContents(farmId, containerId, at);
  if (contents.isLoading) return <Loading />;
  if (contents.error) return <ErrorAlert error={contents.error} />;
  const c = contents.data!;
  return (
    <Stack>
      <Text>
        <Text span className="lv-num" fw={600}>
          {formatLiters(c.volumeL)}
        </Text>{" "}
        sur {formatLiters(capacityL)} au {formatDate(at)}
      </Text>
      <Progress value={capacityL > 0 ? (Math.max(c.volumeL, 0) / capacityL) * 100 : 0} />
      <Title order={4}>Composition</Title>
      {c.composition.length === 0 && <Text c="dimmed">Cuve vide.</Text>}
      {c.composition.map((p) => {
        const attrs = (p.attrs ?? {}) as { vintage?: number; varieties?: string[] };
        return (
          <Paper key={p.lotId} p="sm">
            <Group justify="space-between">
              <Text fw={600}>{p.lotCode}</Text>
              <Text className="lv-num">{Math.round(p.share * 100)} %</Text>
            </Group>
            <Group gap={4} mt={4}>
              {attrs.vintage && <Badge color="paille">Millésime {attrs.vintage}</Badge>}
              {attrs.varieties?.map((v) => (
                <Badge key={v} color="lichen">
                  {v}
                </Badge>
              ))}
            </Group>
          </Paper>
        );
      })}
      <Title order={4}>Derniers mouvements</Title>
      <Table>
        <Table.Tbody>
          {c.lastMovements.map((m, i) => (
            <Table.Tr key={i}>
              <Table.Td className="lv-num">{formatDate(m.occurredAt)}</Table.Td>
              <Table.Td className="lv-num" c={m.quantityL < 0 ? "brique" : undefined}>
                {m.quantityL > 0 ? "+" : ""}
                {formatLiters(m.quantityL)}
              </Table.Td>
              <Table.Td>{m.cause === "migration" ? "Reprise Ekylibre" : m.cause}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
