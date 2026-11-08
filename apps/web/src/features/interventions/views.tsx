import { useState, type DragEvent } from "react";
import { ActionIcon, Badge, Group, Menu, Paper, ScrollArea, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { DataTable, type DataTableSortStatus } from "mantine-datatable";
import { Ellipsis } from "lucide-react";
import type { Intervention, InterventionDisplayStatus } from "@fourmy/contracts";
import { displayStatus } from "@fourmy/domain";
import { formatDate, procedureLabel } from "../../app/labels";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { interventionDay, quantityText, short, STATUS, targetName, type Names } from "./presenters";
import { slots, type Week } from "./week";

/** Actions communes aux vues : ouvrir la fiche, réaliser, annuler. */
export interface ViewActions {
  open: (i: Intervention) => void;
  complete: (i: Intervention) => void;
  cancel: (i: Intervention) => void;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Menu d'actions d'une intervention (clavier et souris : l'alternative au glisser-déposer). */
function ActionsMenu({ i, actions, now }: { i: Intervention; actions: ViewActions; now: string }) {
  const status = displayStatus(i, now);
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" size="sm" aria-label={`Actions : ${procedureLabel(i.procedure)}`} onClick={(e) => e.stopPropagation()}>
          <Ellipsis size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item onClick={() => actions.open(i)}>Ouvrir la fiche</Menu.Item>
        {(status === "planned" || status === "in_progress") && <Menu.Item onClick={() => actions.complete(i)}>Réaliser…</Menu.Item>}
        {status !== "cancelled" && (
          <Menu.Item color="brique" onClick={() => actions.cancel(i)}>
            Annuler…
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Carte compacte du calendrier : heure, intervention, parcelles, chacune sur sa ligne. */
function SlotCard({ i, names, actions, now, when }: { i: Intervention; names: Names; actions: ViewActions; now: string; when: string }) {
  return (
    <Paper
      withBorder
      p={6}
      radius="sm"
      role="article"
      aria-label={procedureLabel(i.procedure)}
      style={{ cursor: "pointer", opacity: i.status === "cancelled" ? 0.55 : 1, borderLeft: `3px solid var(--mantine-color-${STATUS[displayStatus(i, now)].color}-6)` }}
      onClick={() => actions.open(i)}
    >
      <Group gap={4} justify="space-between" wrap="nowrap">
        <Text size="xs" fw={700} className="lv-num">
          {when}
        </Text>
        <ActionsMenu i={i} actions={actions} now={now} />
      </Group>
      <Group gap={4} wrap="nowrap" align="flex-start">
        <ProcedureIcon procedure={i.procedure} size={14} />
        <Text size="xs" fw={600} lh={1.2}>
          {procedureLabel(i.procedure)}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" lh={1.2} mt={2}>
        {short(i.targets.map((t) => targetName(names, t)))}
      </Text>
    </Paper>
  );
}

/** Carte d'intervention (kanban). */
function Card({ i, names, actions, now, draggable }: { i: Intervention; names: Names; actions: ViewActions; now: string; draggable?: boolean }) {
  const status = displayStatus(i, now);
  return (
    <Paper
      withBorder
      p={8}
      radius="sm"
      role="article"
      aria-label={procedureLabel(i.procedure)}
      style={{ cursor: "pointer", opacity: i.status === "cancelled" ? 0.55 : 1 }}
      onClick={() => actions.open(i)}
      draggable={draggable}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData("text/plain", i.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <Group gap={6} wrap="nowrap" justify="space-between" align="flex-start">
        <Group gap={6} wrap="nowrap" align="flex-start">
          <ProcedureIcon procedure={i.procedure} size={18} />
          <Stack gap={0}>
            <Text size="sm" fw={600} lh={1.25}>
              {procedureLabel(i.procedure)}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {short(i.targets.map((t) => targetName(names, t)))}
            </Text>
          </Stack>
        </Group>
        <ActionsMenu i={i} actions={actions} now={now} />
      </Group>
      <Badge size="xs" mt={4} color={STATUS[status].color} variant="light">
        {formatDate(interventionDay(i))}
      </Badge>
    </Paper>
  );
}

// --- Liste --------------------------------------------------------------------

type SortKey = "date" | "procedure" | "status";

export function ListView({ items, names, actions, now }: { items: Intervention[]; names: Names; actions: ViewActions; now: string }) {
  const [sort, setSort] = useState<DataTableSortStatus<Intervention>>({ columnAccessor: "date", direction: "desc" });
  const key = sort.columnAccessor as SortKey;
  const value = (i: Intervention) =>
    key === "procedure" ? procedureLabel(i.procedure) : key === "status" ? STATUS[displayStatus(i, now)].label : interventionDay(i);
  const rows = [...items].sort((a, b) => value(a).localeCompare(value(b), "fr") * (sort.direction === "asc" ? 1 : -1));
  return (
    <DataTable
      withTableBorder
      striped
      highlightOnHover
      minHeight={150}
      noRecordsText="Aucune intervention"
      records={rows}
      sortStatus={sort}
      onSortStatusChange={setSort}
      rowStyle={(i) => (i.status === "cancelled" ? { opacity: 0.55, cursor: "pointer" } : { cursor: "pointer" })}
      onRowClick={({ record }) => actions.open(record)}
      columns={[
        { accessor: "date", title: "Date", sortable: true, render: (i) => <span className="lv-num">{formatDate(interventionDay(i))}</span> },
        {
          accessor: "procedure",
          title: "Intervention",
          sortable: true,
          render: (i) => (
            <Group gap={8} wrap="nowrap">
              <ProcedureIcon procedure={i.procedure} />
              <span>{procedureLabel(i.procedure)}</span>
            </Group>
          ),
        },
        { accessor: "targets", title: "Cibles", render: (i) => short(i.targets.map((t) => targetName(names, t))) },
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
          sortable: true,
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
          render: (i) => (
            <Group justify="flex-end" onClick={(e) => e.stopPropagation()}>
              <ActionsMenu i={i} actions={actions} now={now} />
            </Group>
          ),
        },
      ]}
    />
  );
}

// --- Kanban -------------------------------------------------------------------

const COLUMNS: InterventionDisplayStatus[] = ["planned", "in_progress", "done", "cancelled"];

/**
 * Kanban par statut (« en cours » calculé). Glisser vers « Réalisée » ouvre
 * la réalisation, vers « Annulée » la confirmation ; le menu de chaque carte
 * offre les mêmes actions au clavier.
 */
export function KanbanView({
  items,
  names,
  actions,
  now,
  onRefused,
}: {
  items: Intervention[];
  names: Names;
  actions: ViewActions;
  now: string;
  onRefused: (message: string) => void;
}) {
  const [over, setOver] = useState<InterventionDisplayStatus | null>(null);
  const drop = (column: InterventionDisplayStatus, id: string) => {
    const i = items.find((x) => x.id === id);
    if (!i) return;
    const from = displayStatus(i, now);
    if (from === column) return;
    if (column === "done" && (from === "planned" || from === "in_progress")) return actions.complete(i);
    if (column === "cancelled" && from !== "cancelled") return actions.cancel(i);
    onRefused(
      from === "cancelled"
        ? "Une intervention annulée ne change plus de statut."
        : column === "planned" || column === "in_progress"
          ? "« En cours » se déduit de la date : modifiez la date depuis la fiche."
          : "Ce déplacement n'est pas possible.",
    );
  };
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
      {COLUMNS.map((column) => {
        const cards = items.filter((i) => displayStatus(i, now) === column);
        return (
          <Paper
            key={column}
            p="xs"
            withBorder
            role="region"
            aria-label={STATUS[column].label}
            bg={over === column ? "var(--mantine-color-paille-light)" : "var(--mantine-color-gray-0)"}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(column);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              drop(column, e.dataTransfer.getData("text/plain"));
            }}
          >
            <Group justify="space-between" mb="xs">
              <Title order={5}>{STATUS[column].label}</Title>
              <Badge color={STATUS[column].color} variant="light">
                {cards.length}
              </Badge>
            </Group>
            <ScrollArea.Autosize mah="62vh">
              <Stack gap={6} mih={60}>
                {cards.map((i) => (
                  <Card key={i.id} i={i} names={names} actions={actions} now={now} draggable={column !== "cancelled"} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

// --- Calendrier ---------------------------------------------------------------

/** Semaine en colonnes (lundi → dimanche) ; chaque période à son jour et son heure. */
export function CalendarView({ items, week, names, actions, now }: { items: Intervention[]; week: Week; names: Names; actions: ViewActions; now: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const byDay = new Map(week.days.map((d) => [d, [] as { i: Intervention; startedAt: string; stoppedAt: string | null }[]]));
  for (const i of items) for (const s of slots(i)) byDay.get(s.day)?.push({ i, startedAt: s.startedAt, stoppedAt: s.stoppedAt });
  return (
    <SimpleGrid cols={{ base: 1, sm: 4, lg: 7 }} spacing={6}>
      {week.days.map((day) => {
        const entries = [...byDay.get(day)!].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        const raw = new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
        const label = raw.charAt(0).toUpperCase() + raw.slice(1);
        return (
          <Paper key={day} p={6} withBorder role="region" aria-label={label} bg={day === today ? "var(--mantine-color-lichen-light)" : undefined}>
            <Text size="xs" fw={700} mb={6}>
              {label}
            </Text>
            <Stack gap={6} mih={80}>
              {entries.map(({ i, startedAt, stoppedAt }, k) => (
                <SlotCard
                  key={`${i.id}-${k}`}
                  i={i}
                  names={names}
                  actions={actions}
                  now={now}
                  when={stoppedAt ? `${time(startedAt)}–${time(stoppedAt)}` : `prévue ${time(startedAt)}`}
                />
              ))}
            </Stack>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}
