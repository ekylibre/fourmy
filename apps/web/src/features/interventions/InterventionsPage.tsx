import { useState } from "react";
import { Alert, Badge, Button, Drawer, Group, Modal, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { DataTable } from "mantine-datatable";
import type { Intervention } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, formatNumber, procedureLabel, unitLabel } from "../../app/labels";
import { useArticles, useInterventions, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { InterventionForm } from "./InterventionForm";

const STATUS: Record<Intervention["status"], { label: string; color: string }> = {
  done: { label: "Réalisée", color: "lichen" },
  planned: { label: "Planifiée", color: "paille" },
  cancelled: { label: "Annulée", color: "gray" },
};

const short = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", "));

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
  const [editing, setEditing] = useState<Intervention | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Intervention | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  if (list.isLoading || snap.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;
  const parcelName = new Map(snap.data?.landParcels.map((p) => [p.id, p.name]));
  const equipmentName = new Map(snap.data?.equipments.map((e) => [e.id, e.name]));
  const articleName = new Map(articles.data?.items.map((a) => [a.id, a.name]));
  const personName = new Map(people.data?.items.map((p) => [p.id, p.name]));
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
        rowStyle={(i) => (i.status === "cancelled" ? { opacity: 0.55 } : undefined)}
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
            render: (i) =>
              short(
                i.targets.map((t) =>
                  t.kind === "land_parcel"
                    ? (parcelName.get(t.id) ?? "parcelle d'une autre date")
                    : t.kind === "equipment"
                      ? (equipmentName.get(t.id) ?? "matériel")
                      : "lieu",
                ),
              ),
          },
          {
            accessor: "inputs",
            title: "Intrants et sorties",
            ellipsis: false,
            render: (i) =>
              [...i.inputs, ...i.outputs]
                .map((q) => `${articleName.get(q.articleId) ?? "?"} ${formatNumber(q.quantity, 3)} ${unitLabel(q.unit)}${q.per === "hectare" ? "/ha" : ""}`)
                .join(" · "),
          },
          { accessor: "doers", title: "Intervenants", render: (i) => short(i.doers.map((d) => personName.get(d.personId) ?? "?")) },
          {
            accessor: "status",
            title: "Statut",
            noWrap: true,
            width: 210,
            render: (i) => (
              <Group gap={4} wrap="nowrap">
                <Badge color={STATUS[i.status].color}>{STATUS[i.status].label}</Badge>
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
                <Group gap={4} justify="flex-end" wrap="nowrap">
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

/** Annulation avec motif : une intervention réalisée voit ses mouvements de stock contre-passés. */
function CancelModal({ farmId, intervention, onClose }: { farmId: string; intervention: Intervention | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };
  const cancel = useMutation({
    mutationFn: () => api.post<Intervention>(farmPath(farmId, `/interventions/${intervention!.id}/cancel`), { reason }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Intervention annulée." });
      for (const key of ["interventions", "stock", "register", "snapshot", "contents", "procedures"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      close();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });
  return (
    <Modal opened={intervention !== null} onClose={close} title="Annuler l'intervention">
      {intervention && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cancel.mutate();
          }}
        >
          <Stack>
            <Text size="sm">
              {procedureLabel(intervention.procedure)} du {formatDate(intervention.stoppedAt ?? intervention.startedAt)}.
              {intervention.status === "done" &&
                " Ses mouvements de stock seront contre-passés et elle sortira du registre phyto ; l'historique garde la trace de l'annulation."}
            </Text>
            <TextInput label="Motif" required minLength={3} value={reason} onChange={(e) => setReason(e.currentTarget.value)} data-autofocus />
            {error && <Alert color="brique">{error}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Garder
              </Button>
              <Button type="submit" color="brique" loading={cancel.isPending} disabled={reason.trim().length < 3}>
                Annuler l'intervention
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
