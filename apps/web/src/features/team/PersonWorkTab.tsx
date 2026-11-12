import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Anchor, Button, Group, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { PersonIntervention, PersonWork } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDate, procedureLabel } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

const h = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Une valeur clé : libellé, heures, bornes. */
function Tile({ label, hours, hint }: { label: string; hours: number; hint: string }) {
  return (
    <Paper p="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz={28} fw={700} className="lv-num">
        {h(hours)}
      </Text>
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    </Paper>
  );
}

/** Répartition : libellé, heures et part du total (pas de couleur seule). */
function Breakdown({ title, rows, total }: { title: string; rows: { key: string; label: string; hours: number }[]; total: number }) {
  return (
    <Paper p="md">
      <Title order={4} mb="xs">
        {title}
      </Title>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune heure sur la campagne.
        </Text>
      ) : (
        <Table>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.key}>
                <Table.Td>{r.label}</Table.Td>
                <Table.Td ta="right" className="lv-num">
                  {h(r.hours)}
                </Table.Td>
                <Table.Td ta="right" c="dimmed" className="lv-num" w={70}>
                  {total > 0 ? `${Math.round((r.hours / total) * 100)} %` : ""}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}

type Range = "month" | "campaign" | "last12";

/**
 * Temps de travaux d'une personne (lot P2) : semaine, mois, campagne, 12 mois ;
 * barres par mois ; répartition par activité et par procédure sur la campagne ;
 * ses interventions, paginées.
 */
export function PersonWorkTab({ farmId, personId, day }: { farmId: string; personId: string; day: string }) {
  const location = useLocation();
  const [range, setRange] = useState<Range>("month");
  const work = useQuery({
    queryKey: ["people", farmId, "work", personId, day],
    queryFn: () => api.get<PersonWork>(farmPath(farmId, `/people/${personId}/work?at=${day}`)),
    placeholderData: (prev) => prev,
  });
  const w = work.data;
  const bounds = w ? w.periods[range] : null;
  const list = useInfiniteQuery({
    queryKey: ["people", farmId, "interventions", personId, bounds?.from, bounds?.to],
    enabled: !!bounds,
    initialPageParam: "0",
    queryFn: ({ pageParam }) =>
      api.get<{ items: PersonIntervention[]; nextCursor: string | null }>(
        farmPath(farmId, `/people/${personId}/interventions?from=${bounds!.from}&to=${bounds!.to}&cursor=${pageParam}&limit=20`),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (work.error) return <ErrorAlert error={work.error} />;
  if (!w) return <Loading />;
  const lastDay = (to: string) => {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const span = (b: { from: string; to: string }) => `du ${formatDate(b.from)} au ${formatDate(lastDay(b.to))}`;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Tile label="Cette semaine" hours={w.periods.week.hours} hint={span(w.periods.week)} />
        <Tile label="Ce mois-ci" hours={w.periods.month.hours} hint={span(w.periods.month)} />
        <Tile label={w.periods.campaign.label} hours={w.periods.campaign.hours} hint={span(w.periods.campaign)} />
        <Tile label="12 derniers mois" hours={w.periods.last12.hours} hint={span(w.periods.last12)} />
      </SimpleGrid>

      <Paper p="md">
        <Title order={4} mb="xs">
          Heures par mois
        </Title>
        <BarChart
          h={220}
          data={w.byMonth.map((m) => ({ mois: monthLabel(m.month), heures: m.hours }))}
          dataKey="mois"
          series={[{ name: "heures", label: "Heures", color: "lichen.6" }]}
          valueFormatter={(v) => h(v)}
          barProps={{ radius: [4, 4, 0, 0] }}
          gridAxis="x"
          tickLine="none"
          aria-label="Heures travaillées par mois, 12 derniers mois"
        />
        {/* Les mêmes valeurs en texte : lisibles sans le graphique. */}
        <Text size="xs" c="dimmed" mt="xs" aria-label="Heures par mois (texte)">
          {w.byMonth.map((m) => `${monthLabel(m.month)} : ${h(m.hours)}`).join(" · ")}
        </Text>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Breakdown
          title={`Par activité (${w.periods.campaign.label.toLowerCase()})`}
          total={w.periods.campaign.hours}
          rows={w.byActivity.map((a) => ({ key: a.activityId ?? "none", label: a.name, hours: a.hours }))}
        />
        <Breakdown
          title={`Par type de travail (${w.periods.campaign.label.toLowerCase()})`}
          total={w.periods.campaign.hours}
          rows={w.byProcedure.map((p) => ({ key: p.procedure, label: procedureLabel(p.procedure), hours: p.hours }))}
        />
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt={-8}>
        Heures des interventions réalisées où la personne est intervenante (en attelage, les périodes de son attelage). Une heure sur deux interventions à la fois compte une fois, partagée entre elles ; une intervention sur plusieurs activités est répartie au prorata des surfaces travaillées.
      </Text>

      <Paper p="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Interventions</Title>
          <SegmentedControl
            size="xs"
            aria-label="Période des interventions"
            value={range}
            onChange={(v) => setRange(v as Range)}
            data={[
              { value: "month", label: "Ce mois-ci" },
              { value: "campaign", label: "Campagne" },
              { value: "last12", label: "12 mois" },
            ]}
          />
        </Group>
        {list.isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucune intervention réalisée sur la période.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Travail</Table.Th>
                  <Table.Th ta="right">Heures</Table.Th>
                  <Table.Th>Parcelles</Table.Th>
                  <Table.Th>Matériel</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {items.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>{formatDate(i.date)}</Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/f/${farmId}/interventions/${i.id}${location.search}`}>
                        {procedureLabel(i.procedure)}
                      </Anchor>
                    </Table.Td>
                    <Table.Td ta="right" className="lv-num">
                      {h(i.hours)}
                    </Table.Td>
                    <Table.Td>{i.parcels.join(", ") || "—"}</Table.Td>
                    <Table.Td>{i.equipments.join(", ") || "—"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {list.hasNextPage && (
          <Button variant="subtle" size="xs" mt="xs" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Plus d'interventions
          </Button>
        )}
      </Paper>
    </Stack>
  );
}
