import { Group, Stack, Text, Title } from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { ARTICLE_KIND_LABELS, formatDate, formatNumber, unitLabel } from "../../app/labels";
import { useSnapshot, useStock } from "../../app/queries";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker, pickColumns } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";

const STOCK_COLUMNS: ColumnDef[] = [
  { key: "articleName", label: "Article", required: true },
  { key: "articleKind", label: "Nature" },
  { key: "lotCode", label: "Lot" },
  { key: "where", label: "Lieu" },
  { key: "quantity", label: "Quantité" },
];

/** Stocks à la date de la frise : somme des mouvements par lot et par lieu. */
export function StockPage() {
  const farm = useFarm();
  const { at } = useAt();
  const stock = useStock(farm.id, at);
  const snap = useSnapshot(farm.id, at);
  const columns = useColumns("stocks", STOCK_COLUMNS);

  if (stock.isLoading) return <Loading />;
  if (stock.error) return <ErrorAlert error={stock.error} />;
  const where = new Map<string, string>();
  for (const p of snap.data?.places ?? []) where.set(p.id, p.name);
  for (const c of snap.data?.containers ?? []) where.set(c.id, c.name);
  const rows = stock.data!.items.map((i) => ({ ...i, key: `${i.lotId}|${i.placeId}|${i.containerId}` }));
  const negatives = stock.data!.items.filter((i) => i.quantity < 0).length;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Stocks au {formatDate(at)}</Title>
        <ColumnPicker columns={columns} />
      </Group>
      {negatives > 0 && (
        <Text c="dimmed" size="sm">
          {negatives} ligne(s) en stock négatif : consommations sans achat enregistré (les achats viendront de Lyvre).
        </Text>
      )}
      <DataTable
        withTableBorder
        striped
        highlightOnHover
        minHeight={150}
        noRecordsText="Aucun stock à cette date"
        records={rows}
        idAccessor="key"
        columns={pickColumns<(typeof rows)[number]>([
          { accessor: "articleName", title: "Article" },
          { accessor: "articleKind", title: "Nature", render: (r) => ARTICLE_KIND_LABELS[r.articleKind ?? ""] ?? r.articleKind },
          { accessor: "lotCode", title: "Lot" },
          {
            accessor: "where",
            title: "Lieu",
            render: (r) => where.get(r.containerId ?? r.placeId ?? "") ?? "—",
          },
          {
            accessor: "quantity",
            title: "Quantité",
            textAlign: "right",
            render: (r) => (
              <Text span className="lv-num" c={r.quantity < 0 ? "brique" : undefined}>
                {formatNumber(r.quantity, 3)} {unitLabel(r.unit)}
              </Text>
            ),
          },
        ], columns)}
      />
    </Stack>
  );
}
