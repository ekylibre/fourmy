import { useState } from "react";
import { Alert, Anchor, Badge, Button, Checkbox, Group, NumberInput, Paper, Progress, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { IGN_LAYER_LABELS, type FarmIgnSettings, type IgnCacheJob, type IgnCacheState, type IgnLayer } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatBytes, formatDateTime } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { OfflinePanel } from "./OfflinePanel";

/**
 * Onglet « Données IGN » de « Ma ferme » (lot F4, E12, E13, N3, R6) : couches
 * et marge à précharger, estimation, lancement sur le serveur, progression.
 * Les cartes de la ferme lisent ensuite les tuiles depuis le cache du serveur.
 */

const STATUS: Record<IgnCacheJob["status"], { label: string; color: string }> = {
  pending: { label: "En attente", color: "gray" },
  running: { label: "En cours", color: "blue" },
  done: { label: "Terminé", color: "lichen" },
  partial: { label: "Incomplet", color: "orange" },
  failed: { label: "Échec", color: "brique" },
  cancelled: { label: "Annulé", color: "gray" },
};

const active = (job: IgnCacheJob | null) => job?.status === "pending" || job?.status === "running";

export function IgnTab() {
  const farm = useFarm();
  const state = useQuery({
    queryKey: ["ign-cache", farm.id],
    queryFn: () => api.get<IgnCacheState>(farmPath(farm.id, "/ign/cache")),
    // Suivre la progression tant qu'une tâche tourne (E13).
    refetchInterval: (q) => (active(q.state.data?.lastJob ?? null) ? 3000 : false),
  });
  if (state.isLoading) return <Loading />;
  if (state.error) return <ErrorAlert error={state.error} />;
  const s = state.data!;
  return (
    <Stack>
      <IgnSettingsForm state={s} />
      <IgnCachePanel state={s} />
      {s.plan && <OfflinePanel serverTiles={s.cached.tiles} />}
    </Stack>
  );
}

function IgnSettingsForm({ state }: { state: IgnCacheState }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FarmIgnSettings>(state.settings);
  const changed = JSON.stringify(form) !== JSON.stringify(state.settings);
  const save = useMutation({
    mutationFn: () => api.put<FarmIgnSettings>(farmPath(farm.id, "/settings/ign"), form),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Réglages des données IGN enregistrés." });
      void queryClient.invalidateQueries({ queryKey: ["ign-cache", farm.id] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  return (
    <Paper withBorder p="md" aria-label="Réglages des données IGN">
      <Title order={4} mb="xs">
        Couches à préparer
      </Title>
      <Stack gap="sm">
        <Checkbox.Group value={form.layers} onChange={(v) => setForm((f) => ({ ...f, layers: v as IgnLayer[] }))}>
          <Group>
            {(Object.keys(IGN_LAYER_LABELS) as IgnLayer[]).map((l) => (
              <Checkbox key={l} value={l} label={IGN_LAYER_LABELS[l]} disabled={!state.canEdit} />
            ))}
          </Group>
        </Checkbox.Group>
        <NumberInput
          label="Marge de détail autour des parcelles"
          description="Zone où les photos descendent au niveau le plus fin (zoom 18)."
          suffix=" m"
          min={0}
          max={1000}
          step={50}
          w={260}
          disabled={!state.canEdit}
          value={form.detailMarginM}
          onChange={(v) => setForm((f) => ({ ...f, detailMarginM: typeof v === "number" ? v : 0 }))}
        />
        <Switch
          label="Relancer automatiquement quand un site ou son rayon change"
          disabled={!state.canEdit}
          checked={form.autoRefresh}
          onChange={(e) => setForm((f) => ({ ...f, autoRefresh: e.currentTarget.checked }))}
        />
        {state.canEdit && (
          <Group>
            <Button variant="default" disabled={!changed || form.layers.length === 0} loading={save.isPending} onClick={() => save.mutate()}>
              Enregistrer
            </Button>
          </Group>
        )}
        <Text size="xs" c="dimmed">
          Les cours d'eau (zones non traitées) sont déjà gardés par Fourmy et mis à jour tous les 30 jours : ils ne font pas partie de ce téléchargement.
        </Text>
      </Stack>
    </Paper>
  );
}

function IgnCachePanel({ state }: { state: IgnCacheState }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["ign-cache", farm.id] });
  const onError = (e: unknown) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) });
  const start = useMutation({
    mutationFn: (confirm: boolean) => api.post<IgnCacheJob>(farmPath(farm.id, "/ign/cache/jobs"), { confirm }),
    onSuccess: () => {
      setConfirming(false);
      notifications.show({ color: "lichen", message: "Téléchargement lancé : il se poursuit sur le serveur, même si vous quittez la page." });
      refresh();
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/ign/cache/jobs/${id}`)),
    onSuccess: refresh,
    onError,
  });

  const { plan, cached, lastJob: job } = state;
  if (!plan) {
    return (
      <Alert color="orange" title="Aucune zone à préparer">
        Les données IGN se préparent autour des sites de la ferme.{" "}
        <Anchor component={Link} to="?tab=sites">
          Placez d'abord le siège sur la carte
        </Anchor>
        .
      </Alert>
    );
  }
  const big = plan.estimateBytes > state.confirmAboveBytes;
  const ratio = plan.tiles ? cached.tiles / plan.tiles : 0;
  return (
    <Paper withBorder p="md" aria-label="État du cache IGN">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Sur le serveur</Title>
        {job && <Badge color={STATUS[job.status].color}>{STATUS[job.status].label}</Badge>}
      </Group>
      <Stack gap="sm">
        <Text size="sm">
          Zones des sites : {plan.tiles.toLocaleString("fr-FR")} tuiles, environ {formatBytes(plan.estimateBytes)}.{" "}
          {cached.tiles === plan.tiles
            ? "Tout est déjà en cache."
            : `${cached.tiles.toLocaleString("fr-FR")} déjà en cache (${Math.floor(ratio * 100)} %).`}
        </Text>
        {job && <JobDetail job={job} />}
        {state.canEdit && !active(job) && !confirming && (
          <Group>
            <Button loading={start.isPending} onClick={() => (big ? setConfirming(true) : start.mutate(false))}>
              Télécharger maintenant
            </Button>
          </Group>
        )}
        {confirming && (
          <Alert color="orange" title="Téléchargement volumineux">
            <Text size="sm" mb="xs">
              Environ {formatBytes(plan.estimateBytes)} seront téléchargés depuis l'IGN et gardés sur le serveur. Réduisez le rayon des sites ou la marge de détail pour alléger.
            </Text>
            <Group>
              <Button color="orange" loading={start.isPending} onClick={() => start.mutate(true)}>
                Confirmer
              </Button>
              <Button variant="default" onClick={() => setConfirming(false)}>
                Annuler
              </Button>
            </Group>
          </Alert>
        )}
        {state.canEdit && job && active(job) && (
          <Group>
            <Button variant="default" color="brique" loading={cancel.isPending} onClick={() => cancel.mutate(job.id)}>
              Arrêter le téléchargement
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function JobDetail({ job }: { job: IgnCacheJob }) {
  const layers = Object.entries(job.progress) as [IgnLayer, NonNullable<IgnCacheJob["progress"][IgnLayer]>][];
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {job.finishedAt ? `Dernier téléchargement le ${formatDateTime(job.finishedAt)}` : `Demandé le ${formatDateTime(job.createdAt)}`}
      </Text>
      <Table withRowBorders={false} verticalSpacing={4}>
        <Table.Tbody>
          {layers.map(([layer, p]) => (
            <Table.Tr key={layer}>
              <Table.Td w={160}>{IGN_LAYER_LABELS[layer]}</Table.Td>
              <Table.Td>
                <Progress value={p.total ? (p.done / p.total) * 100 : 0} color={p.failed ? "orange" : "lichen"} aria-label={`Progression ${IGN_LAYER_LABELS[layer]}`} />
              </Table.Td>
              <Table.Td w={220}>
                <Text size="xs">
                  {p.done.toLocaleString("fr-FR")} / {p.total.toLocaleString("fr-FR")}
                  {p.failed ? `, ${p.failed.toLocaleString("fr-FR")} en échec` : ""}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {job.error && (
        <Text size="sm" c={job.status === "failed" ? "brique" : "orange"}>
          {job.error} {job.status === "partial" && "Relancez le téléchargement : seules les tuiles manquantes seront demandées."}
        </Text>
      )}
    </Stack>
  );
}
