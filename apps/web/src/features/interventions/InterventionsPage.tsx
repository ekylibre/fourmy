import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ActionIcon, Button, CloseButton, Drawer, Group, SegmentedControl, Stack, Switch, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, List, Plus, Search } from "lucide-react";
import type { Intervention } from "@fourmy/contracts";
import { todayIso, useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { useArticles, useCampaignInterventions, useParcelNames, usePeople, useProcedures, useSnapshot } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { CancelModal } from "./CancelModal";
import { InterventionForm } from "./InterventionForm";
import type { Names } from "./presenters";
import { makeMatcher, searchText } from "./search";
import { CalendarView, KanbanView, ListView, type ViewActions } from "./views";
import { addDays, inWeek, weekLabel, weekOf } from "./week";

type View = "list" | "kanban" | "calendar";
const VIEWS: View[] = ["list", "kanban", "calendar"];
const STORE_KEY = "fourmy.interventions.view";

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
 * (`?view=`) et, à défaut, dans le navigateur.
 */
export function InterventionsPage() {
  const farm = useFarm();
  const { at, day, setDay } = useAt();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // `?vue=` : ancienne adresse en français, encore acceptée.
  const asked = params.get("view") ?? ({ liste: "list", kanban: "kanban", calendrier: "calendar" } as Record<string, string>)[params.get("vue") ?? ""] ?? null;
  const view: View = VIEWS.includes(asked as View) ? (asked as View) : (stored() ?? "list");
  const [wholeCampaign, setWholeCampaign] = useState(false);
  const query = params.get("q") ?? "";
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

  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value) n.set(key, value);
        else n.delete(key);
        return n;
      },
      { replace: true },
    );

  const setView = (v: View) => {
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {
      // Stockage indisponible : la vue reste dans l'adresse.
    }
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("view", v);
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
    article: new Map(articles.data?.items.map((a) => [a.id, { name: a.name, unit: a.unit, amm: a.amm }])),
    person: new Map(people.data?.items.map((p) => [p.id, p.name])),
  };
  const now = new Date().toISOString();
  const campaign = list.data!.items;
  const pool = edgeYear ? [...campaign, ...(edge.data?.items ?? []).filter((i) => !campaign.some((c) => c.id === i.id))] : campaign;
  // Recherche (vue Liste) : toujours sur toute la campagne.
  const matcher = view === "list" ? makeMatcher(query) : null;
  const listWhole = view === "list" && (wholeCampaign || matcher !== null);
  const scoped = matcher ? campaign.filter((i) => matcher(searchText(i, names))) : listWhole ? campaign : pool.filter((i) => inWeek(i, week));
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
            { value: "list", label: <Group gap={6} wrap="nowrap"><List size={16} aria-hidden /><span>Liste</span></Group> },
            { value: "kanban", label: <Group gap={6} wrap="nowrap"><Columns3 size={16} aria-hidden /><span>Kanban</span></Group> },
            { value: "calendar", label: <Group gap={6} wrap="nowrap"><CalendarDays size={16} aria-hidden /><span>Calendrier</span></Group> },
          ]}
        />
      </Group>

      <Group justify="space-between">
        <Text c="dimmed" size="sm">
          {matcher
            ? `${visible.length} intervention(s) trouvée(s) sur la campagne ${year}.`
            : `${visible.length} intervention(s) ${listWhole ? `sur la campagne ${year}` : "cette semaine"}.`}
        </Text>
        <Group gap="md">
          {view === "list" && (
            <Switch
              size="xs"
              label={`Toute la campagne ${year}`}
              checked={wholeCampaign || matcher !== null}
              disabled={matcher !== null}
              onChange={(e) => setWholeCampaign(e.currentTarget.checked)}
            />
          )}
          {view !== "kanban" && cancelledCount > 0 && (
            <Switch size="xs" label={`Afficher les annulées (${cancelledCount})`} checked={showCancelled} onChange={(e) => setShowCancelled(e.currentTarget.checked)} />
          )}
        </Group>
      </Group>

      {view === "list" && (
        <>
          <TextInput
            aria-label="Rechercher dans la campagne"
            placeholder={`Rechercher dans la campagne ${year} : intervention, parcelle, produit ou AMM, matériel, personne, notes`}
            leftSection={<Search size={16} />}
            rightSection={query ? <CloseButton aria-label="Effacer la recherche" onClick={() => setParam("q", "")} /> : null}
            value={query}
            onChange={(e) => setParam("q", e.currentTarget.value)}
          />
          <ListView items={visible} names={names} actions={actions} now={now} />
        </>
      )}
      {view === "kanban" && (
        <KanbanView items={visible} names={names} actions={actions} now={now} onRefused={(message) => notifications.show({ color: "paille", message })} />
      )}
      {view === "calendar" && <CalendarView items={visible} week={week} names={names} actions={actions} now={now} />}

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
