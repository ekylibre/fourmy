import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Anchor, Badge, Button, Group, List, Paper, SegmentedControl, Stack, Text, Textarea, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, ClipboardCheck, X } from "lucide-react";
import type { Proposal } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDateTime, procedureLabel } from "../../app/labels";
import { useArticles, useParcelNames } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { quantityText, short, type Names } from "../interventions/presenters";
import { CHANNEL_LABELS, CHECK_BADGES, STATUS_BADGES } from "./labels";
import { useProposals } from "./queries";

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/**
 * « À valider » (lot AM8, conception_api_mcp.md §8) : les propositions des
 * accès externes (assistant IA, API). Le responsable de la ferme ouvre le
 * formulaire prérempli pour vérifier et enregistrer, ou refuse (B9). Les
 * autres membres y suivent leurs propres dépôts.
 */
export function ProposalsPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const list = useProposals(farm.id, filter === "pending" ? "pending" : undefined);
  const parcels = useParcelNames(farm.id);
  const articles = useArticles(farm.id);
  const names: Names = {
    parcel: parcels.data ?? new Map(),
    equipment: new Map(),
    article: new Map((articles.data?.items ?? []).map((a) => [a.id, { name: a.name, unit: a.unit }])),
    person: new Map(),
  };

  return (
    <Stack>
      <Title order={1}>À valider</Title>
      <Text maw={760}>
        Les interventions proposées par les accès externes de la ferme : assistant IA, logiciel relié par l'API. Elles sont contrôlées au dépôt mais rien
        n'est enregistré tant que {owner ? "vous ne les avez pas acceptées" : "le responsable de la ferme ne les a pas acceptées"}. Sans suite, elles
        expirent après 90 jours.
      </Text>
      <SegmentedControl
        w="fit-content"
        value={filter}
        onChange={(v) => setFilter(v as "pending" | "all")}
        data={[
          { value: "pending", label: `En attente${list.data ? ` (${list.data.pending})` : ""}` },
          { value: "all", label: "Toutes" },
        ]}
      />
      {list.error && <ErrorAlert error={list.error} />}
      {list.isLoading && <Loading />}
      {list.data && !list.data.items.length && (
        <Text c="dimmed" size="sm">
          {filter === "pending" ? "Aucune proposition en attente." : "Aucune proposition."}
        </Text>
      )}
      {list.data?.items.map((p) => <ProposalCard key={p.id} proposal={p} names={names} owner={owner} />)}
    </Stack>
  );
}

function ProposalCard({ proposal: p, names, owner }: { proposal: Proposal; names: Names; owner: boolean }) {
  const farm = useFarm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const reject = useMutation({
    mutationFn: () => api.post<Proposal>(farmPath(farm.id, `/proposals/${p.id}/reject`), note.trim() ? { note: note.trim() } : {}),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Proposition refusée." });
      void queryClient.invalidateQueries({ queryKey: ["proposals"] });
    },
  });
  const at = p.payload.periods[0]?.startedAt ?? p.payload.plannedAt ?? null;
  const done = p.payload.periods.length > 0 || p.payload.crews.length > 0;
  const parcels = p.payload.targets.filter((t) => t.kind === "land_parcel").map((t) => names.parcel.get(t.id) ?? "parcelle");
  const status = STATUS_BADGES[p.status];
  const check = p.checks ? CHECK_BADGES[p.checks.level] : null;
  const open = () => navigate(`/f/${farm.id}/interventions/new${at ? `?at=${at.slice(0, 10)}` : ""}`, { state: { proposal: p } });

  return (
    <Paper withBorder p="md" radius="md" aria-label={`Proposition : ${procedureLabel(p.payload.procedure)}`}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap">
            <ProcedureIcon procedure={p.payload.procedure} size={24} />
            <div>
              <Text fw={600}>
                {procedureLabel(p.payload.procedure)} {done ? "réalisée" : "prévue"} le {formatDateTime(at)}
              </Text>
              <Text size="sm" c="dimmed">
                {parcels.length ? short(parcels) : "sans parcelle"}
              </Text>
            </div>
          </Group>
          <Group gap={6}>
            {check && p.status === "pending" && (
              <Badge variant="light" color={check.color}>
                {check.label}
              </Badge>
            )}
            <Badge variant="light" color={status.color}>
              {p.status === "accepted" && p.corrected ? "Acceptée après correction" : status.label}
            </Badge>
          </Group>
        </Group>
        {p.payload.inputs.length > 0 && <Text size="sm">{p.payload.inputs.map((i) => quantityText(names, i)).join(" · ")}</Text>}
        <Group gap={6}>
          <Bot size={14} />
          <Text size="sm" c="dimmed">
            {p.accessName ?? p.user.name} ({CHANNEL_LABELS[p.channel]}{p.accessName ? `, ${p.user.name}` : ""}) · déposée le {formatDateTime(p.createdAt)}
          </Text>
        </Group>
        {p.message && (
          <Text size="sm" fs="italic">
            « {p.message} »
          </Text>
        )}
        {p.status === "pending" && p.checks && p.checks.messages.length > 0 && (
          <List size="sm" spacing={2}>
            {p.checks.messages.map((m, i) => (
              <List.Item key={i} c={m.level === "danger" ? "brique" : undefined}>
                {m.message}
              </List.Item>
            ))}
          </List>
        )}
        {p.decidedAt && (
          <Text size="sm" c="dimmed">
            {status.label} le {formatDateTime(p.decidedAt)}
            {p.decisionNote ? ` : « ${p.decisionNote} »` : ""}
            {p.resultId && (
              <>
                {" · "}
                <Anchor component={Link} to={`/f/${farm.id}/interventions/${p.resultId}`}>
                  voir l'intervention
                </Anchor>
              </>
            )}
          </Text>
        )}
        {owner && p.status === "pending" && !rejecting && (
          <Group gap="xs">
            <Button size="xs" leftSection={<ClipboardCheck size={14} />} onClick={open}>
              Vérifier et enregistrer
            </Button>
            <Button size="xs" variant="default" leftSection={<X size={14} />} onClick={() => setRejecting(true)}>
              Refuser
            </Button>
          </Group>
        )}
        {rejecting && (
          <Stack gap="xs">
            <Textarea label="Motif (facultatif), visible de l'accès" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={2} maxLength={2000} />
            {reject.error && <Alert color="brique">{message(reject.error)}</Alert>}
            <Group gap="xs">
              <Button size="xs" color="brique" loading={reject.isPending} onClick={() => reject.mutate()}>
                Refuser la proposition
              </Button>
              <Button size="xs" variant="subtle" onClick={() => setRejecting(false)}>
                Annuler
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
