import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, History, Plus } from "lucide-react";
import { ITK_ORIGIN_LABELS, ITK_SYSTEM_LABELS, getProcedure, type ItkDetail, type ItkSystem, type ItkWrite } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useActivities } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { DeriveModal } from "./DeriveModal";
import { itksKey, useItks } from "./queries";

/**
 * Activités › Itinéraires techniques (lot IT1) : les ITK de la ferme, par
 * activité. Lecture pour tous, création et copie pour le responsable.
 */
export function ItinerariesPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activityId = params.get("activityId");
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  // `?derive=1` : ouvert depuis l'itinéraire d'une activité (« Créer depuis l'historique »).
  const [deriving, setDeriving] = useState(params.get("derive") === "1");
  const year = new Date().getFullYear();
  const activities = useActivities(farm.id, year);
  const q = useItks(farm.id, { activityId, active: showInactive ? undefined : true });

  const activityOptions = useMemo(
    () => (activities.data?.items ?? []).filter((a) => !a.suspended).map((a) => ({ value: a.id, label: a.name })),
    [activities.data],
  );
  const copy = useMutation({
    mutationFn: (id: string) => api.post<ItkDetail>(farmPath(farm.id, `/technical-itineraries/${id}/copy`), {}),
    onSuccess: (t) => {
      notifications.show({ color: "lichen", message: `« ${t.name} » créé.` });
      void queryClient.invalidateQueries({ queryKey: itksKey(farm.id) });
      navigate(`/f/${farm.id}/itineraries/${t.id}`);
    },
    onError: (e) => notifications.show({ color: "red", message: e instanceof Error ? e.message : String(e) }),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const items = q.data?.items ?? [];

  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="xs">
          <Button component={Link} to={`/f/${farm.id}/activities`} variant="subtle" px={4} aria-label="Retour aux activités">
            <ArrowLeft size={18} />
          </Button>
          <Title order={1}>Itinéraires techniques</Title>
        </Group>
        <Group>
          <Select
            placeholder="Toutes les activités"
            data={activityOptions}
            value={activityId}
            onChange={(v) => setParams(v ? { activityId: v } : {})}
            clearable
            searchable
            aria-label="Activité"
            w={220}
          />
          <Switch label="Inactifs aussi" checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
          {owner && (
            <Button variant="default" leftSection={<History size={16} />} onClick={() => setDeriving(true)}>
              Depuis l'historique
            </Button>
          )}
          {owner && (
            <Button leftSection={<Plus size={16} />} onClick={() => setCreating(true)}>
              Nouvel itinéraire
            </Button>
          )}
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        Un itinéraire technique décrit les interventions prévues d'une culture, datées par rapport au semis ou à la récolte : travaux, intrants et doses, matériels. Il
        servira à préparer l'assolement (temps de travaux, besoins en intrants) et les interventions prévues.
      </Text>
      <Paper withBorder>
        <Table verticalSpacing="xs" highlightOnHover aria-label="Itinéraires techniques">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th>
              <Table.Th>Activité</Table.Th>
              <Table.Th>Conduite</Table.Th>
              <Table.Th>Étapes</Table.Th>
              <Table.Th>Origine</Table.Th>
              {owner && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((t) => (
              <Table.Tr key={t.id} style={{ opacity: t.active ? 1 : 0.6 }}>
                <Table.Td>
                  <Group gap={6}>
                    <Text component={Link} to={`/f/${farm.id}/itineraries/${t.id}`} fw={600} size="sm" c="inherit">
                      {t.name}
                    </Text>
                    {!t.active && (
                      <Badge size="xs" color="gray" variant="light">
                        Inactif
                      </Badge>
                    )}
                    {t.missing > 0 && (
                      <Badge size="xs" color="orange" variant="light">
                        {t.missing} à remplacer
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={t.activityName ? undefined : "dimmed"}>
                    {t.activityName ?? "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{ITK_SYSTEM_LABELS[t.system]}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" title={t.procedures.map((p) => getProcedure(p).label).join(", ")}>
                    {t.steps}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{ITK_ORIGIN_LABELS[t.origin]}</Text>
                </Table.Td>
                {owner && (
                  <Table.Td ta="right">
                    <Button size="compact-sm" variant="subtle" leftSection={<Copy size={14} />} onClick={() => copy.mutate(t.id)} loading={copy.isPending && copy.variables === t.id} aria-label={`Dupliquer ${t.name}`}>
                      Dupliquer
                    </Button>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
            {items.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={owner ? 6 : 5}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Aucun itinéraire technique{activityId ? " pour cette activité" : ""}. {owner ? "Créez le premier depuis l'historique de vos interventions, ou avec « Nouvel itinéraire »." : ""}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {deriving && (
        <DeriveModal
          farmId={farm.id}
          activityOptions={activityOptions}
          defaultActivityId={activityId}
          onClose={() => {
            setDeriving(false);
            if (params.get("derive")) setParams(activityId ? { activityId } : {});
          }}
          onCreated={(t) => navigate(`/f/${farm.id}/itineraries/${t.id}`)}
        />
      )}
      {creating && (
        <NewItineraryModal
          farmId={farm.id}
          activityOptions={activityOptions}
          defaultActivityId={activityId}
          onClose={() => setCreating(false)}
          onCreated={(t) => navigate(`/f/${farm.id}/itineraries/${t.id}`)}
        />
      )}
    </Stack>
  );
}

function NewItineraryModal({
  farmId,
  activityOptions,
  defaultActivityId,
  onClose,
  onCreated,
}: {
  farmId: string;
  activityOptions: { value: string; label: string }[];
  defaultActivityId: string | null;
  onClose: () => void;
  onCreated: (t: ItkDetail) => void;
}) {
  const queryClient = useQueryClient();
  const [activityId, setActivityId] = useState<string | null>(defaultActivityId);
  const [system, setSystem] = useState<ItkSystem>("conventional");
  const activityLabel = activityOptions.find((o) => o.value === activityId)?.label;
  const [name, setName] = useState(activityLabel ?? "");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (body: ItkWrite) => api.post<ItkDetail>(farmPath(farmId, "/technical-itineraries"), body),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: itksKey(farmId) });
      onCreated(t);
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? "Un itinéraire porte déjà ce nom." : e instanceof Error ? e.message : String(e)),
  });
  return (
    <Modal opened onClose={onClose} title="Nouvel itinéraire technique">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ id: crypto.randomUUID(), name: name.trim(), activityId, system, content: { schema: 1, steps: [] } });
        }}
      >
        <Stack>
          <Select
            label="Activité"
            data={activityOptions}
            value={activityId}
            onChange={(v) => {
              setActivityId(v);
              const label = activityOptions.find((o) => o.value === v)?.label;
              if (label && (!name.trim() || activityOptions.some((o) => o.label === name.trim()))) setName(label);
            }}
            searchable
            clearable
          />
          <TextInput label="Nom" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={120} data-autofocus />
          <Select
            label="Conduite"
            data={Object.entries(ITK_SYSTEM_LABELS).map(([value, label]) => ({ value, label }))}
            value={system}
            onChange={(v) => setSystem((v as ItkSystem) ?? "conventional")}
            allowDeselect={false}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
              Créer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
