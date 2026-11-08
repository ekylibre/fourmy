import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Badge, Button, Group, Paper, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import type { PartsToOrder } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

const HORIZONS: Record<string, { label: string; query: string }> = {
  h100: { label: "100 h", query: "hours=100" },
  h200: { label: "200 h", query: "hours=200" },
  m3: { label: "3 mois", query: "months=3" },
  m6: { label: "6 mois", query: "months=6" },
  m12: { label: "12 mois", query: "months=12" },
};

const qty = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/**
 * Pièces à commander (FR-MAT-42, US-MAT-5) : les pièces des opérations qui
 * tombent dans l'horizon choisi, regroupées par référence, avec le stock et
 * ce qu'il reste à commander. Les heures sont projetées sur le rythme
 * d'usage de la dernière année.
 */
export function PartsPage() {
  const farm = useFarm();
  const location = useLocation();
  const { at } = useAt();
  const [horizon, setHorizon] = useState("h200");
  const q = useQuery({
    queryKey: ["parts-to-order", farm.id, at, horizon],
    queryFn: () => api.get<PartsToOrder>(farmPath(farm.id, `/maintenance/parts?${HORIZONS[horizon]!.query}&at=${encodeURIComponent(at)}`)),
  });
  const items = q.data?.items ?? [];
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["Référence", "Désignation", "Famille", "Besoin", "En stock", "À commander", "Unité", "Matériels", "Opérations"].join(";"),
      ...items.map((i) => [esc(i.reference ?? ""), esc(i.name), esc(i.family ?? ""), qty(i.needed), qty(i.inStock), qty(i.toOrder), esc(i.unit), esc(i.equipments.join(", ")), esc(i.operations.join(", "))].join(";")),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pieces-a-commander-${at.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Stack>
      <Button component={Link} to={`/f/${farm.id}/maintenance${location.search}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        Entretien
      </Button>
      <Group justify="space-between">
        <Title order={1}>Pièces à commander</Title>
        <Button variant="default" leftSection={<Download size={16} />} onClick={exportCsv} disabled={!items.length}>
          Exporter (CSV)
        </Button>
      </Group>
      <Group>
        <Text size="sm">Pour les</Text>
        <SegmentedControl value={horizon} onChange={setHorizon} data={Object.entries(HORIZONS).map(([value, h]) => ({ value, label: h.label }))} aria-label="Horizon" />
        <Text size="sm" c="dimmed">
          à partir du {formatDate(at)}, échéances en retard comprises.
        </Text>
      </Group>
      {q.isLoading && <Loading />}
      {q.error && <ErrorAlert error={q.error} />}
      {q.data && (
        <Paper withBorder>
          <Table aria-label="Pièces à commander" verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Référence</Table.Th>
                <Table.Th>Désignation</Table.Th>
                <Table.Th ta="right">Besoin</Table.Th>
                <Table.Th ta="right">En stock</Table.Th>
                <Table.Th ta="right">À commander</Table.Th>
                <Table.Th>Pour</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((i) => (
                <Table.Tr key={i.articleId}>
                  <Table.Td className="lv-num" style={{ whiteSpace: "nowrap" }}>
                    {i.reference ?? "—"}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{i.name}</Text>
                    {i.family && (
                      <Text size="xs" c="dimmed">
                        {i.family.replace(/_/g, " ")}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="right" className="lv-num">
                    {qty(i.needed)}
                  </Table.Td>
                  <Table.Td ta="right" className="lv-num">
                    {qty(i.inStock)}
                  </Table.Td>
                  <Table.Td ta="right">
                    {i.toOrder > 0 ? <Badge color="paille">{qty(i.toOrder)}</Badge> : <Badge color="lichen" variant="light">0</Badge>}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{i.equipments.join(", ")}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {i.operations.join(" ; ")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {!items.length && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="sm" c="dimmed" ta="center" py="md">
                      Aucune pièce à prévoir sur cet horizon. Les opérations « à renseigner » comptent dès qu'elles ont une dernière réalisation.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
