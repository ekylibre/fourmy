import { useState } from "react";
import { Badge, Button, Drawer, Group, Stack, Text, Title } from "@mantine/core";
import { Plus } from "lucide-react";
import { DataTable } from "mantine-datatable";
import type { Intervention } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, formatNumber, procedureLabel, unitLabel } from "../../app/labels";
import { useArticles, useInterventions, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { InterventionForm } from "./InterventionForm";

/** Interventions de la campagne de la frise ; saisie et réalisation. */
export function InterventionsPage() {
  const farm = useFarm();
  const { at, day } = useAt();
  const year = Number(day.slice(0, 4));
  const list = useInterventions(farm.id, new Date(`${year}-01-01T00:00:00`).toISOString(), new Date(`${year + 1}-01-01T00:00:00`).toISOString());
  const snap = useSnapshot(farm.id, at);
  const articles = useArticles(farm.id);
  const [editing, setEditing] = useState<Intervention | "new" | null>(null);

  if (list.isLoading || snap.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;
  const parcelName = new Map(snap.data?.landParcels.map((p) => [p.id, p.name]));
  const articleName = new Map(articles.data?.items.map((a) => [a.id, a.name]));
  const rows = [...list.data!.items].reverse();

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Interventions {year}</Title>
        <Button leftSection={<Plus size={16} />} onClick={() => setEditing("new")}>
          Nouvelle intervention
        </Button>
      </Group>
      <Text c="dimmed" size="sm">
        {rows.length} intervention(s) sur la campagne {year}.
      </Text>
      <DataTable
        withTableBorder
        striped
        highlightOnHover
        minHeight={150}
        noRecordsText="Aucune intervention sur cette campagne"
        records={rows}
        columns={[
          { accessor: "date", title: "Date", render: (i) => <span className="lv-num">{formatDate(i.stoppedAt ?? i.startedAt ?? i.createdAt)}</span> },
          { accessor: "procedure", title: "Intervention", render: (i) => procedureLabel(i.procedure) },
          {
            accessor: "targets",
            title: "Parcelles",
            render: (i) => {
              const names = i.parameters.filter((p) => p.role === "target" && p.refType === "land_parcel").map((p) => parcelName.get(p.refId ?? "") ?? "parcelle d'une autre date");
              return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
            },
          },
          {
            accessor: "inputs",
            title: "Intrants",
            ellipsis: false,
            render: (i) =>
              i.parameters
                .filter((p) => p.role === "input")
                .map((p) => `${articleName.get(p.refId ?? "") ?? "?"} ${p.quantity !== null ? formatNumber(p.quantity, 3) : ""} ${unitLabel(p.unit)}`)
                .join(" · "),
          },
          {
            accessor: "status",
            title: "Statut",
            noWrap: true,
            width: 210,
            render: (i) => (
              <Group gap={4} wrap="nowrap">
                <Badge color={i.status === "done" ? "lichen" : "paille"}>{i.status === "done" ? "Réalisée" : "Planifiée"}</Badge>
                {i.origin === "mobile" && <Badge color="ardoise">Mobile</Badge>}
                {i.origin === "migration" && <Badge color="gray">Ekylibre</Badge>}
              </Group>
            ),
          },
          {
            accessor: "actions",
            title: "",
            textAlign: "right",
            render: (i) =>
              i.status === "planned" ? (
                <Button size="xs" variant="light" onClick={() => setEditing(i)}>
                  Réaliser
                </Button>
              ) : null,
          },
        ]}
      />
      <Drawer
        opened={editing !== null}
        onClose={() => setEditing(null)}
        position="right"
        size="lg"
        title={editing === "new" ? "Nouvelle intervention" : "Réaliser l'intervention"}
      >
        {editing !== null && snap.data && articles.data && (
          <InterventionForm
            farmId={farm.id}
            snapshot={snap.data}
            articles={articles.data.items}
            planned={editing === "new" ? undefined : editing}
            defaultDay={day}
            onDone={() => setEditing(null)}
          />
        )}
      </Drawer>
    </Stack>
  );
}
