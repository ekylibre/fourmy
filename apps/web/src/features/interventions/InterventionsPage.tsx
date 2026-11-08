import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ActionIcon, Button, Drawer, Group, SegmentedControl, Stack, Switch, Text, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List, Plus } from "lucide-react";
import type { Intervention } from "@fourmy/contracts";
import { todayIso, useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { useArticles, useCampaignInterventions, useParcelNames, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { CancelModal } from "./CancelModal";
import { InterventionForm } from "./InterventionForm";
import type { Names } from "./presenters";
import { CalendarView, KanbanView, ListView, type ViewActions } from "./views";
import { addDays, inWeek, weekLabel, weekOf } from "./week";

type View = "liste" | "kanban" | "calendrier";
const VIEWS: View[] = ["liste", "kanban", "calendrier"];
const STORE_KEY = "fourmy.interventions.vue";

const stored = (): View | null => {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return VIEWS.includes(v as View) ? (v as View) : null;
  } catch {
    return null;
  }
};

/**
 * Interventions (exigence INT-UI-4) : la semaine de la frise (lundi →
 * dimanche) en liste, kanban par statut ou calendrier ; la liste peut aussi
 * montrer toute la campagne. La vue choisie est gardée dans l'adresse
 * (`?vue=`) et, à défaut, dans le navigateur.
 */
export function InterventionsPage() {
  const farm = useFarm();
  const { at, day, setDay } = useAt();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const view: View = VIEWS.includes(params.get("vue") as View) ? (params.get("vue") as View) : (stored() ?? "liste");
  const [wholeCampaign, setWholeCampaign] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [completing, setCompleting] = useState<Intervention | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Intervention | null>(null);

  const week = weekOf(day);
  const year = Number(day.slice(0, 4));
  const list = useCampaignInterventions(farm.id, year);
  // L'année précédente ou suivante quand la semaine enjambe le 1er janvier.
  const edgeYear = Number(week.start.slice(0, 4)) !== year ? Number(week.start.slice(0, 4)) : Number(week.end.slice(0, 4)) !== year ? Number(week.end.slice(0, 4)) : null;
  const edge = useCampaignInterventions(farm.id, edgeYear ?? year);
  const snap = useSnapshot(farm.id, at);
  const articles = useArticles(farm.id);
  const people = usePeople(farm.id);
  const catalogue = useProcedures(farm.id);
  const parcelNames = useParcelNames(farm.id);

  const setView = (v: View) => {
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {
      // Stockage indisponible : la vue reste dans l'adresse.
    }
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("vue", v);
        return n;
      },
      { replace: true },
    );
  };

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;

  const names: Names = {
    parcel: parcelNames.data ?? new Map(),
    equipment: new Map(snap.data?.equipments.map((e) => [e.id, e.name])),
    article: new Map(articles.data?.items.map((a) => [a.id, { name: a.name, unit: a.unit }])),
    person: new Map(people.data?.items.map((p) => [p.id, p.name])),
  };
  const now = new Date().toISOString();
  const campaign = list.data!.items;
  const pool = edgeYear ? [...campaign, ...(edge.data?.items ?? []).filter((i) => !campaign.some((c) => c.id === i.id))] : campaign;
  const listWhole = view === "liste" && wholeCampaign;
  const scoped = listWhole ? campaign : pool.filter((i) => inWeek(i, week));
  const visible = showCancelled || view === "kanban" ? scoped : scoped.filter((i) => i.status !== "cancelled");
  const cancelledCount = scoped.filter((i) => i.status === "cancelled").length;

  const actions: ViewActions = {
    open: (i) => navigate(`${i.id}${location.search}`),
    complete: (i) => setCompleting(i),
    cancel: (i) => setCancelling(i),
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Interventions {year}</Title>
        <Button leftSection={<Plus size={16} />} onClick={() => setCompleting("new")} disabled={!catalogue.data}>
          Nouvelle intervention
        </Button>
      </Group>

      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Semaine précédente">
            <ActionIcon variant="default" aria-label="Semaine précédente" onClick={() => setDay(addDays(week.start, -7))} disabled={listWhole}>
              <ChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <Text fw={600} miw={220} ta="center" aria-live="polite" c={listWhole ? "dimmed" : undefined}>
            {listWhole ? `Campagne ${year}` : `Semaine ${weekLabel(week)}`}
          </Text>
          <Tooltip label="Semaine suivante (planification)">
            <ActionIcon variant="default" aria-label="Semaine suivante" onClick={() => setDay(addDays(week.start, 7))} disabled={listWhole}>
              <ChevronRight size={16} />
            </ActionIcon>
          </Tooltip>
          <Button variant="subtle" size="xs" onClick={() => setDay(todayIso())} disabled={listWhole}>
            Cette semaine
          </Button>
        </Group>
        <SegmentedControl
          aria-label="Vue"
          value={view}
          onChange={(v) => setView(v as View)}
          data={[
            { value: "liste", label: <Group gap={6} wrap="nowrap"><List size={16} aria-hidden /><span>Liste</span></Group> },
            { value: "kanban", label: <Group gap={6} wrap="nowrap"><Columns3 size={16} aria-hidden /><span>Kanban</span></Group> },
            { value: "calendrier", label: <Group gap={6} wrap="nowrap"><CalendarDays size={16} aria-hidden /><span>Calendrier</span></Group> },
          ]}
        />
      </Group>

      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {visible.length} intervention(s) {listWhole ? `sur la campagne ${year}` : "cette semaine"}.
        </Text>
        <Group gap="md">
          {view === "liste" && (
            <Switch size="xs" label={`Toute la campagne ${year}`} checked={wholeCampaign} onChange={(e) => setWholeCampaign(e.currentTarget.checked)} />
          )}
          {view !== "kanban" && cancelledCount > 0 && (
            <Switch size="xs" label={`Afficher les annulées (${cancelledCount})`} checked={showCancelled} onChange={(e) => setShowCancelled(e.currentTarget.checked)} />
          )}
        </Group>
      </Group>

      {view === "liste" && <ListView items={visible} names={names} actions={actions} now={now} />}
      {view === "kanban" && (
        <KanbanView items={visible} names={names} actions={actions} now={now} onRefused={(message) => notifications.show({ color: "paille", message })} />
      )}
      {view === "calendrier" && <CalendarView items={visible} week={week} names={names} actions={actions} now={now} />}

      <Drawer
        opened={completing !== null}
        onClose={() => setCompleting(null)}
        position="right"
        size="lg"
        title={completing === "new" ? "Nouvelle intervention" : "Réaliser l'intervention"}
      >
        {completing !== null && snap.data && articles.data && catalogue.data && (
          <InterventionForm
            farmId={farm.id}
            snapshot={snap.data}
            articles={articles.data.items}
            people={people.data?.items ?? []}
            catalogue={catalogue.data}
            planned={completing === "new" ? undefined : completing}
            defaultDay={day}
            onDone={() => setCompleting(null)}
          />
        )}
      </Drawer>
      <CancelModal farmId={farm.id} intervention={cancelling} onClose={() => setCancelling(null)} />
    </Stack>
  );
}
