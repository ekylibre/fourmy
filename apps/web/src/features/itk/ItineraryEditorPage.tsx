import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ActionIcon, Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Save, Trash2 } from "lucide-react";
import {
  ITK_ORIGIN_LABELS,
  ITK_SYSTEM_LABELS,
  WORK_RATE_SOURCE_LABELS,
  getProcedure,
  unitLabel,
  type ArticleKind,
  type ItkDetail,
  type ItkStep,
  type ItkSystem,
  type ItkWrite,
} from "@fourmy/contracts";
import { anchorLabel, itkPerHectare, itkPreview, scheduleSteps } from "@fourmy/domain";
import { fmtH, fmtRate, useItkWorkContext } from "./work";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useActivities, useArticles, useCrewTemplates, useEquipments, usePeople } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ItineraryView, type ItineraryChartView } from "../itinerary/ItineraryView";
import { StepModal, type StepOptions } from "./StepModal";
import { itksKey, useItk } from "./queries";

type Form = { name: string; activityId: string | null; system: ItkSystem; notes: string; active: boolean; steps: ItkStep[] };
const formOf = (t: ItkDetail): Form => ({ name: t.name, activityId: t.activityId, system: t.system, notes: t.notes ?? "", active: t.active, steps: t.content.steps });
const fmt = (n: number) => String(n).replace(".", ",");

/**
 * Éditeur d'un itinéraire technique (lot IT1, conception §11) : tableau des
 * étapes, aperçu sur la frise TIKA à des dates d'exemple, enregistrement d'un
 * bloc avec la révision lue (409 : recharger ou écraser).
 */
export function ItineraryEditorPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const { itineraryId = "" } = useParams();
  const q = useItk(farm.id, itineraryId);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorAlert error={q.error} />;
  return <Editor key={q.data.id} detail={q.data} owner={owner} refetch={() => q.refetch()} />;
}

function Editor({ detail, owner, refetch }: { detail: ItkDetail; owner: boolean; refetch: () => Promise<unknown> }) {
  const farm = useFarm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(detail));
  const [revision, setRevision] = useState(detail.revision);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<ItkStep | "new" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [view, setView] = useState<ItineraryChartView>("horizontal");
  const [sowingOn, setSowingOn] = useState(detail.example.sowingOn);
  const [harvestOn, setHarvestOn] = useState(detail.example.harvestOn);

  const activities = useActivities(farm.id, new Date().getFullYear());
  const articles = useArticles(farm.id);
  const equipments = useEquipments(farm.id);
  const people = usePeople(farm.id);
  const crews = useCrewTemplates(farm.id);
  // Débits et heures par hectare (lot IT4) : même contexte que l'assolement, sans les trajets.
  const work = useItkWorkContext(farm.id, detail.example.year, { routes: false });
  const perHa = useMemo(() => (work.data ? new Map(itkPerHectare({ steps: form.steps }, work.data).map((x) => [x.stepId, x])) : null), [work.data, form.steps]);
  const totalPerHa = perHa ? [...perHa.values()].reduce((s, x) => s + (x.hoursPerHa ?? 0), 0) : 0;
  const unknownRates = perHa ? [...perHa.values()].filter((x) => !x.rate).length : 0;

  // Prévenir avant de quitter la page avec des modifications non enregistrées.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const options: StepOptions = useMemo(
    () => ({
      articles: (articles.data?.items ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind as ArticleKind })),
      equipments: (equipments.data?.items ?? []).filter((e) => !e.state || e.state === "active").map((e) => ({ value: e.id, label: e.name })),
      people: (people.data?.items ?? []).filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })),
      crewTemplates: (crews.data?.items ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })),
    }),
    [articles.data, equipments.data, people.data, crews.data],
  );
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of [...options.equipments, ...options.people, ...options.crewTemplates]) m.set(o.value, o.label);
    return m;
  }, [options]);
  const activity = (activities.data?.items ?? []).find((a) => a.id === form.activityId);
  const missingSteps = new Set(detail.missing.map((m) => m.stepId));

  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(sowingOn) && /^\d{4}-\d{2}-\d{2}$/.test(harvestOn) && sowingOn <= harvestOn;
  const year = datesOk ? Number(harvestOn.slice(0, 4)) : detail.example.year;
  const preview = useMemo(
    () => (datesOk ? itkPreview({ name: form.name || "Itinéraire", color: activity?.color ?? null, content: { steps: form.steps }, dates: { sowingOn, harvestOn, year } }) : null),
    [datesOk, form.name, form.steps, activity?.color, sowingOn, harvestOn, year],
  );
  const firstDates = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of scheduleSteps({ steps: form.steps }, { sowingOn: datesOk ? sowingOn : null, harvestOn: datesOk ? harvestOn : null, year })) m.set(s.step.id, s.occurrences[0]?.on ?? null);
    return m;
  }, [form.steps, sowingOn, harvestOn, datesOk, year]);

  const update = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setSteps = (fn: (steps: ItkStep[]) => ItkStep[]) => update({ steps: fn(form.steps) });
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const out = [...s];
      [out[i], out[i + d]] = [out[i + d]!, out[i]!];
      return out;
    });
  const sortByDate = () =>
    setSteps((s) => {
      const order = scheduleSteps({ steps: s }, { sowingOn, harvestOn, year }).map((x) => x.step.id);
      return [...s].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    });

  const body = (rev: number): ItkWrite => ({
    revision: rev,
    name: form.name.trim(),
    activityId: form.activityId,
    production: detail.production,
    system: form.system,
    origin: detail.origin,
    source: detail.source,
    notes: form.notes.trim() || null,
    active: form.active,
    content: { schema: 1, ...(detail.content.startMonthDay ? { startMonthDay: detail.content.startMonthDay } : {}), steps: form.steps },
  });
  const save = useMutation({
    mutationFn: (rev: number) => api.put<ItkDetail>(farmPath(farm.id, `/technical-itineraries/${detail.id}`), body(rev)),
    onSuccess: (t) => {
      setRevision(t.revision);
      setDirty(false);
      setConflict(false);
      queryClient.setQueryData([...itksKey(farm.id), "detail", t.id], t);
      void queryClient.invalidateQueries({ queryKey: [...itksKey(farm.id), "list"] });
      notifications.show({ color: "lichen", message: "Itinéraire enregistré." });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else notifications.show({ color: "red", message: e instanceof ApiError && e.title === "Conflit" ? "Un itinéraire porte déjà ce nom." : e instanceof Error ? e.message : String(e) });
    },
  });
  /** Après un 409 : relire le serveur, puis garder ses modifications (écraser) ou les abandonner (recharger). */
  const resolve = async (keepMine: boolean) => {
    const fresh = await api.get<ItkDetail>(farmPath(farm.id, `/technical-itineraries/${detail.id}`));
    if (keepMine) save.mutate(fresh.revision);
    else {
      setForm(formOf(fresh));
      setRevision(fresh.revision);
      setDirty(false);
      setConflict(false);
      await refetch();
    }
  };
  const copy = useMutation({
    mutationFn: () => api.post<ItkDetail>(farmPath(farm.id, `/technical-itineraries/${detail.id}/copy`), {}),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: itksKey(farm.id) });
      notifications.show({ color: "lichen", message: `« ${t.name} » créé.` });
      navigate(`/f/${farm.id}/itineraries/${t.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>(farmPath(farm.id, `/technical-itineraries/${detail.id}`)),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: itksKey(farm.id) });
      notifications.show({ color: "lichen", message: r?.deleted ? "Itinéraire supprimé." : "Itinéraire utilisé par un assolement : désactivé." });
      navigate(`/f/${farm.id}/itineraries`);
    },
  });

  const inputsOf = (s: ItkStep) => s.inputs.map((i) => `${i.label} ${fmt(i.dose)} ${unitLabel(i.unit)}`).join(" · ");
  const staffingOf = (s: ItkStep) => {
    if (s.staffing.crewTemplateId) return names.get(s.staffing.crewTemplateId) ?? "Attelage supprimé";
    const parts = [...s.staffing.equipmentIds, ...s.staffing.personIds].map((id) => names.get(id) ?? "?");
    if (!s.staffing.personIds.length && s.staffing.people) parts.push(`${s.staffing.people} pers.`);
    return parts.join(" + ");
  };
  const whenOf = (s: ItkStep) => {
    const parts = [anchorLabel(s.anchor)];
    if (s.windowDays) parts.push(`±${s.windowDays} j`);
    if (s.repeat && s.repeat.count > 1) parts.push(`${s.repeat.count} passages tous les ${s.repeat.everyDays} j`);
    return parts.join(" · ");
  };
  const frenchDate = (d: string | null | undefined) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }) : "à préciser");

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Button component={Link} to={`/f/${farm.id}/itineraries${form.activityId ? `?activityId=${form.activityId}` : ""}`} variant="subtle" px={4} aria-label="Retour aux itinéraires">
            <ArrowLeft size={18} />
          </Button>
          <Title order={1}>{form.name || "Itinéraire"}</Title>
          <Badge variant="light" color="gray">
            {ITK_ORIGIN_LABELS[detail.origin]} · révision {revision}
          </Badge>
          {!form.active && (
            <Badge variant="light" color="gray">
              Inactif
            </Badge>
          )}
        </Group>
        {owner && (
          <Group>
            <Button variant="default" leftSection={<Copy size={16} />} onClick={() => copy.mutate()} loading={copy.isPending} disabled={dirty}>
              Dupliquer
            </Button>
            <Button variant="default" color="red" leftSection={<Trash2 size={16} />} onClick={() => setRemoving(true)}>
              Supprimer
            </Button>
            <Button leftSection={<Save size={16} />} onClick={() => save.mutate(revision)} loading={save.isPending} disabled={!dirty || !form.name.trim()}>
              Enregistrer
            </Button>
          </Group>
        )}
      </Group>

      {conflict && (
        <Alert color="orange" title="Itinéraire modifié entre-temps">
          <Text size="sm" mb="xs">
            Quelqu'un (ou un autre onglet) l'a enregistré depuis votre ouverture.
          </Text>
          <Group>
            <Button size="xs" variant="default" onClick={() => void resolve(false)}>
              Recharger (abandonner mes modifications)
            </Button>
            <Button size="xs" color="orange" onClick={() => void resolve(true)}>
              Écraser avec mes modifications
            </Button>
          </Group>
        </Alert>
      )}
      {detail.missing.length > 0 && (
        <Alert color="orange">
          {detail.missing.length} élément{detail.missing.length > 1 ? "s" : ""} n'existe{detail.missing.length > 1 ? "nt" : ""} plus dans la ferme (article, matériel, intervenant ou attelage) :
          à remplacer dans les étapes signalées.
        </Alert>
      )}

      <Paper withBorder p="md">
        <Group grow align="flex-start" wrap="wrap">
          <TextInput label="Nom" value={form.name} onChange={(e) => update({ name: e.currentTarget.value })} maxLength={120} required disabled={!owner} />
          <Select
            label="Activité"
            data={(activities.data?.items ?? []).filter((a) => !a.suspended || a.id === form.activityId).map((a) => ({ value: a.id, label: a.name }))}
            value={form.activityId}
            onChange={(v) => update({ activityId: v })}
            searchable
            clearable
            disabled={!owner}
          />
          <Select
            label="Conduite"
            data={Object.entries(ITK_SYSTEM_LABELS).map(([value, label]) => ({ value, label }))}
            value={form.system}
            onChange={(v) => v && update({ system: v as ItkSystem })}
            allowDeselect={false}
            disabled={!owner}
          />
        </Group>
        <Group align="flex-end" mt="sm" wrap="wrap">
          <Textarea label="Notes" value={form.notes} onChange={(e) => update({ notes: e.currentTarget.value })} maxLength={2000} autosize minRows={1} style={{ flex: 1 }} disabled={!owner} />
          <Switch label="Actif" checked={form.active} onChange={(e) => update({ active: e.currentTarget.checked })} disabled={!owner} mb={8} />
        </Group>
      </Paper>

      <Paper withBorder>
        <Group justify="space-between" p="sm">
          <Text fw={600}>
            {form.steps.length} étape{form.steps.length > 1 ? "s" : ""}
          </Text>
          {owner && (
            <Group gap="xs">
              <Button size="compact-sm" variant="subtle" onClick={sortByDate} disabled={form.steps.length < 2}>
                Trier par date
              </Button>
              <Button size="compact-sm" leftSection={<Plus size={14} />} onClick={() => setEditing("new")}>
                Ajouter une étape
              </Button>
            </Group>
          )}
        </Group>
        <Table verticalSpacing="xs" highlightOnHover aria-label="Étapes de l'itinéraire">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Étape</Table.Th>
              <Table.Th>Quand</Table.Th>
              <Table.Th>Part</Table.Th>
              <Table.Th>Intrants</Table.Th>
              <Table.Th>Chantier</Table.Th>
              <Table.Th>Débit</Table.Th>
              {owner && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {form.steps.map((s, i) => (
              <Table.Tr key={s.id} onClick={() => setEditing(s)} style={{ cursor: "pointer" }}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500}>
                      {s.label || getProcedure(s.procedure).label}
                    </Text>
                    {s.optional && (
                      <Badge size="xs" variant="light" color="gray">
                        si besoin
                      </Badge>
                    )}
                    {missingSteps.has(s.id) && (
                      <Badge size="xs" variant="light" color="orange">
                        à remplacer
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{whenOf(s)}</Text>
                  <Text size="xs" c="dimmed">
                    {frenchDate(firstDates.get(s.id))}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{Math.round(s.share * 100)} %</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={s.inputs.length ? undefined : "dimmed"}>
                    {inputsOf(s) || "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={staffingOf(s) ? undefined : "dimmed"}>
                    {staffingOf(s) || "à compléter"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {(() => {
                    const r = perHa?.get(s.id)?.rate;
                    if (!r) return <Text size="sm" c={perHa ? "orange" : "dimmed"}>{perHa ? "inconnu" : "—"}</Text>;
                    return (
                      <Text size="sm" title={r.label ?? undefined}>
                        {fmtRate(r.haH)}{" "}
                        <Text span size="xs" c="dimmed">
                          {WORK_RATE_SOURCE_LABELS[r.source]}
                        </Text>
                      </Text>
                    );
                  })()}
                </Table.Td>
                {owner && (
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    <Group gap={2} wrap="nowrap" justify="flex-end">
                      <ActionIcon variant="subtle" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">
                        <ArrowUp size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" onClick={() => move(i, 1)} disabled={i === form.steps.length - 1} aria-label="Descendre">
                        <ArrowDown size={16} />
                      </ActionIcon>
                      <Tooltip label="Dupliquer l'étape">
                        <ActionIcon variant="subtle" onClick={() => setSteps((l) => [...l.slice(0, i + 1), { ...s, id: crypto.randomUUID(), evidence: undefined }, ...l.slice(i + 1)])} aria-label="Dupliquer l'étape">
                          <Copy size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <ActionIcon variant="subtle" color="red" onClick={() => setSteps((l) => l.filter((x) => x.id !== s.id))} aria-label="Supprimer l'étape">
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
            {form.steps.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={owner ? 7 : 6}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Aucune étape. {owner ? "Ajoutez les interventions prévues de la culture : travail du sol, semis, fertilisation, traitements, récolte." : ""}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" p="sm">
          {perHa
            ? `Par hectare : ${fmtH(Math.round(totalPerHa * 100) / 100)} de chantier${unknownRates ? `, ${unknownRates} débit(s) inconnu(s) non comptés` : ""}. Débits : saisi, sinon observé sur vos chantiers, sinon ${work.data!.rateSource}.`
            : "Calcul des débits…"}
          {" "}Besoins en intrants : à venir (lot IT5).
        </Text>
      </Paper>

      {preview && form.steps.length > 0 ? (
        <ItineraryView
          itinerary={preview}
          view={view}
          onView={setView}
          hint="Aperçu sur des dates d'exemple : travaux au-dessus de la culture, intrants au-dessous. Cliquez sur une étape pour l'ouvrir."
          onIntervention={(ref) => {
            const stepId = ref.interventionIds[0]?.split(":")[0];
            const s = form.steps.find((x) => x.id === stepId);
            if (s) setEditing(s);
          }}
          toolbar={
            <>
              <TextInput type="date" size="xs" label="Semis d'exemple" value={sowingOn} onChange={(e) => setSowingOn(e.currentTarget.value)} />
              <TextInput type="date" size="xs" label="Récolte d'exemple" value={harvestOn} onChange={(e) => setHarvestOn(e.currentTarget.value)} error={!datesOk ? "Récolte après le semis" : undefined} />
            </>
          }
        />
      ) : null}

      {editing && (
        <StepModal
          farmId={farm.id}
          step={editing === "new" ? null : editing}
          options={options}
          readOnly={!owner}
          onClose={() => setEditing(null)}
          onSave={(step) => {
            setSteps((l) => (editing === "new" ? [...l, step] : l.map((x) => (x.id === step.id ? step : x))));
            setEditing(null);
          }}
        />
      )}
      {removing && (
        <Modal opened onClose={() => setRemoving(false)} title={`Supprimer « ${detail.name} » ?`}>
          <Stack>
            <Text size="sm">S'il sert déjà à un assolement, il est seulement désactivé : les assolements qui l'utilisent ne changent pas.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setRemoving(false)}>
                Annuler
              </Button>
              <Button color="red" onClick={() => remove.mutate()} loading={remove.isPending}>
                Supprimer
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}
