import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Badge, Button, Drawer, Group, Stack, Switch, Text, Title } from "@mantine/core";
import { Plus } from "lucide-react";
import { DataTable } from "mantine-datatable";
import type { Intervention } from "@fourmy/contracts";
import { displayStatus } from "@fourmy/domain";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, procedureLabel } from "../../app/labels";
import { useArticles, useInterventions, useParcelNames, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { CancelModal } from "./CancelModal";
import { InterventionForm } from "./InterventionForm";
import { quantityText, short, STATUS, targetName, type Names } from "./presenters";

/** Interventions de la campagne de la frise ; saisie, réalisation, annulation. */
export function InterventionsPage() {
  const farm = useFarm();
  const { at, day } = useAt();
  const year = Number(day.slice(0, 4));
  const list = useInterventions(farm.id, new Date(`${year}-01-01T00:00:00`).toISOString(), new Date(`${year + 1}-01-01T00:00:00`).toISOString());
  const snap = useSnapshot(farm.id, at);
  const articles = useArticles(farm.id);
  const people = usePeople(farm.id);
  const catalogue = useProcedures(farm.id);
  const parcelNames = useParcelNames(farm.id);
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState<Intervention | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Intervention | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  if (list.isLoading || snap.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;
  // Noms des parcelles de toutes dates : une intervention de mars cible des parcelles de mars.
  const names: Names = {
    parcel: parcelNames.data ?? new Map(),
    equipment: new Map(snap.data?.equipments.map((e) => [e.id, e.name])),
    article: new Map(articles.data?.items.map((a) => [a.id, { name: a.name, unit: a.unit }])),
    person: new Map(people.data?.items.map((p) => [p.id, p.name])),
  };
  const now = new Date().toISOString();
  const open = (i: Intervention) => navigate(`${i.id}${location.search}`);
  const all = [...list.data!.items].reverse();
  const rows = showCancelled ? all : all.filter((i) => i.status !== "cancelled");
  const cancelledCount = all.length - all.filter((i) => i.status !== "cancelled").length;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Interventions {year}</Title>
        <Button leftSection={<Plus size={16} />} onClick={() => setEditing("new")} disabled={!catalogue.data}>
          Nouvelle intervention
        </Button>
      </Group>
      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {rows.length} intervention(s) sur la campagne {year}.
        </Text>
        {cancelledCount > 0 && (
          <Switch size="xs" label={`Afficher les annulées (${cancelledCount})`} checked={showCancelled} onChange={(e) => setShowCancelled(e.currentTarget.checked)} />
        )}
      </Group>
      <DataTable
        withTableBorder
        striped
        highlightOnHover
        minHeight={150}
        noRecordsText="Aucune intervention sur cette campagne"
        records={rows}
        rowStyle={(i) => (i.status === "cancelled" ? { opacity: 0.55, cursor: "pointer" } : { cursor: "pointer" })}
        onRowClick={({ record }) => open(record)}
        columns={[
          { accessor: "date", title: "Date", render: (i) => <span className="lv-num">{formatDate(i.stoppedAt ?? i.startedAt ?? i.createdAt)}</span> },
          {
            accessor: "procedure",
            title: "Intervention",
            render: (i) => (
              <Group gap={8} wrap="nowrap">
                <ProcedureIcon procedure={i.procedure} />
                <span>{procedureLabel(i.procedure)}</span>
              </Group>
            ),
          },
          {
            accessor: "targets",
            title: "Cibles",
            render: (i) => short(i.targets.map((t) => targetName(names, t))),
          },
          {
            accessor: "inputs",
            title: "Intrants et sorties",
            ellipsis: false,
            render: (i) => [...i.inputs, ...i.outputs].map((q) => quantityText(names, q)).join(" · "),
          },
          { accessor: "doers", title: "Intervenants", render: (i) => short(i.doers.map((d) => names.person.get(d.personId) ?? "?")) },
          {
            accessor: "status",
            title: "Statut",
            noWrap: true,
            width: 210,
            render: (i) => (
              <Group gap={4} wrap="nowrap">
                <Badge color={STATUS[displayStatus(i, now)].color}>{STATUS[displayStatus(i, now)].label}</Badge>
                {i.origin === "mobile" && <Badge color="ardoise">Mobile</Badge>}
                {i.origin === "migration" && <Badge color="gray">Ekylibre</Badge>}
              </Group>
            ),
          },
          {
            accessor: "actions",
            title: "",
            textAlign: "right",
            noWrap: true,
            render: (i) =>
              i.status === "cancelled" ? null : (
                <Group gap={4} justify="flex-end" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                  {i.status === "planned" && (
                    <Button size="xs" variant="light" onClick={() => setEditing(i)}>
                      Réaliser
                    </Button>
                  )}
                  <Button size="xs" variant="subtle" color="brique" onClick={() => setCancelling(i)}>
                    Annuler
                  </Button>
                </Group>
              ),
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
        {editing !== null && snap.data && articles.data && catalogue.data && (
          <InterventionForm
            farmId={farm.id}
            snapshot={snap.data}
            articles={articles.data.items}
            people={people.data?.items ?? []}
            catalogue={catalogue.data}
            planned={editing === "new" ? undefined : editing}
            defaultDay={day}
            onDone={() => setEditing(null)}
          />
        )}
      </Drawer>
      <CancelModal farmId={farm.id} intervention={cancelling} onClose={() => setCancelling(null)} />
    </Stack>
  );
}
