import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Anchor, Badge, Group, Paper, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { TrackSummary } from "@fourmy/contracts";
import { formatHa } from "@fourmy/ui-lyvre";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";
import { formatDuration } from "../interventions/periods";

/**
 * Widget « Parcours GPS » du tableau de bord (retours du 10/11/2026) : quand
 * Traccar est actif, la synthèse des parcours du jour de la frise ou des
 * 7 jours qui finissent ce jour-là (décision D4), par matériel suivi. Chaque
 * ligne ouvre l'onglet Parcours du matériel sur la même période ; les
 * parcours de travail libres y sont filtrés pour devenir des interventions.
 */
const DAY = 86_400_000;
const km = (m: number) => `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Décale un jour local (AAAA-MM-JJ) de n jours ; midi évite les changements d'heure. */
const shift = (day: string, n: number) => dayOf(new Date(new Date(`${day}T12:00:00`).getTime() + n * DAY));

/** Jours locaux [premier, dernier] de la période, et bornes ISO [from, to[ (minuit local). */
export function summaryRange(day: string, span: "day" | "week") {
  const first = span === "week" ? shift(day, -6) : day;
  return { first, last: day, from: new Date(`${first}T00:00:00`).toISOString(), to: new Date(`${shift(day, 1)}T00:00:00`).toISOString() };
}

export function TrackSummaryWidget({ farmId, day }: { farmId: string; day: string }) {
  const [span, setSpan] = useState<"day" | "week">("day");
  const location = useLocation();
  const range = summaryRange(day, span);
  const q = useQuery({
    queryKey: ["track-summary", farmId, range.from, range.to],
    queryFn: () => api.get<TrackSummary>(farmPath(farmId, `/tracks/summary?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)),
    staleTime: 60_000,
    // Changement de période : on garde l'affichage précédent pendant le chargement.
    placeholderData: (previous) => previous,
  });
  if (!q.data?.enabled) return null;
  const items = q.data.items;
  const tabLink = (equipmentId: string, free = false) => {
    const p = new URLSearchParams(location.search);
    p.set("tab", "tracks");
    p.set("tracksFrom", range.first);
    p.set("tracksTo", range.last);
    if (free) {
      p.set("tracksKind", "work");
      p.set("tracksState", "free");
    }
    return `/f/${farmId}/equipments/${equipmentId}?${p}`;
  };
  const totalWork = items.reduce((s, i) => s + i.work.durationS, 0);
  const totalFree = items.reduce((s, i) => s + i.freeWork, 0);

  return (
    <Paper p="md" component="section" aria-labelledby="track-summary-title">
      <Group justify="space-between" mb="xs">
        <div>
          <Title order={2} size="h4" id="track-summary-title">
            Parcours GPS
          </Title>
          <Text size="sm" c="dimmed">
            {span === "day" ? `Le ${formatDate(range.last)}` : `Du ${formatDate(range.first)} au ${formatDate(range.last)}`}
            {items.length > 0 && ` · ${formatDuration(Math.round(totalWork / 60))} de travail`}
            {totalFree > 0 && ` · ${totalFree} parcours de travail à transformer en intervention`}
          </Text>
        </div>
        <SegmentedControl
          size="xs"
          aria-label="Période des parcours"
          value={span}
          onChange={(v) => setSpan(v as "day" | "week")}
          data={[
            { value: "day", label: "Jour" },
            { value: "week", label: "7 jours" },
          ]}
        />
      </Group>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          {q.isLoading ? "Chargement…" : span === "day" ? "Aucun parcours ce jour-là." : "Aucun parcours sur ces 7 jours."}
        </Text>
      ) : (
        <Table verticalSpacing={6} aria-label="Parcours GPS par matériel">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Matériel</Table.Th>
              <Table.Th>Travail</Table.Th>
              <Table.Th>Déplacements</Table.Th>
              <Table.Th>Parcelles</Table.Th>
              <Table.Th>À transformer</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={i.equipment.id}>
                <Table.Td>
                  <Anchor component={Link} to={tabLink(i.equipment.id)} fw={600} size="sm">
                    {i.equipment.name}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  {i.work.count > 0 ? (
                    <Stack gap={0}>
                      <Text size="sm" className="lv-num">
                        {formatDuration(Math.round(i.work.durationS / 60))} · {i.work.count} parcours
                      </Text>
                      <Text size="xs" c="dimmed" className="lv-num">
                        {km(i.work.distanceM)}
                        {i.work.coveredAreaM2 > 0 && ` · ${formatHa(i.work.coveredAreaM2)} couverts`}
                      </Text>
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" className="lv-num" c={i.transit.count ? undefined : "dimmed"}>
                    {i.transit.count ? `${formatDuration(Math.round(i.transit.durationS / 60))} · ${km(i.transit.distanceM)}` : "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" lineClamp={2}>
                    {i.parcels.length ? i.parcels.map((p) => p.name).join(", ") : "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {i.freeWork > 0 ? (
                    <Badge component={Link} to={tabLink(i.equipment.id, true)} color="paille" variant="light" style={{ cursor: "pointer" }}>
                      {i.freeWork} libre{i.freeWork > 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}
