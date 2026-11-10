import { useEffect, useState } from "react";
import { ActionIcon, Alert, Button, Group, MultiSelect, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { BookmarkPlus, Copy, Plus, Trash2 } from "lucide-react";
import type { CrewTemplate, InterventionCrew, InterventionCrewRead, WorkPeriod } from "@fourmy/contracts";
import { CrewTemplateModal } from "../equipments/CrewTemplatesPage";
import { crewDurations } from "@fourmy/domain";
import { formatPeriod } from "../../app/labels";
import { durationMinutes, formatDuration, parseDuration, withDuration, withStart, type LocalPeriod } from "./periods";

/**
 * Saisie des moyens en attelages (lot N4, FR-ATT-1 à 5) : une carte par
 * attelage (matériels, intervenants, périodes propres), la synthèse
 * « chantier · temps de travail ». Les périodes sont en heure locale, comme
 * dans le reste du formulaire.
 */

type Option = { value: string; label: string } | { group: string; items: { value: string; label: string }[] };

export interface CrewRow {
  /** Clé React (stable pendant la saisie). */
  key: string;
  /** Identifiant enregistré (conservé à la modification). */
  id?: string;
  label: string;
  templateId?: string;
  tools: string[];
  doers: string[];
  periods: LocalPeriod[];
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → AAAA-MM-JJTHH:MM, heure locale (datetime-local). */
export const toLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const toIso = (value: string) => new Date(value).toISOString();
export const isoPeriods = (periods: LocalPeriod[]): WorkPeriod[] => periods.map((p) => ({ startedAt: toIso(p.startedAt), stoppedAt: toIso(p.stoppedAt) }));

export const newCrew = (patch: Partial<CrewRow> = {}): CrewRow => ({ key: crypto.randomUUID(), label: "", tools: [], doers: [], periods: [], ...patch });

/**
 * Copie d'un attelage (même composition) sur une période de même durée qui
 * suit sa dernière : la copie ne chevauche pas l'original (FR-ATT-3).
 */
export function duplicate(c: CrewRow): CrewRow {
  const last = c.periods.at(-1);
  const minutes = last ? durationMinutes(last) : null;
  const periods = last && minutes !== null ? [withDuration({ startedAt: last.stoppedAt, stoppedAt: last.stoppedAt }, minutes)] : [];
  return newCrew({ tools: [...c.tools], doers: [...c.doers], periods, ...(c.templateId ? { templateId: c.templateId } : {}) });
}

/**
 * Reprise d'un attelage type (FR-ATT-6) : matériels et intervenants copiés,
 * origine gardée ; les périodes saisies restent, le nom aussi s'il y en a un.
 */
export const fromTemplate = (c: CrewRow, t: CrewTemplate): CrewRow => ({
  ...c,
  label: c.label.trim() ? c.label : t.name,
  templateId: t.id,
  tools: [...t.equipmentIds],
  doers: [...t.personIds],
});

/** Attelages lus → lignes du formulaire. */
export const crewRowsOf = (crews: InterventionCrewRead[]): CrewRow[] =>
  crews.map((c) =>
    newCrew({
      id: c.id,
      label: c.label ?? "",
      ...(c.templateId ? { templateId: c.templateId } : {}),
      tools: c.tools.map((t) => t.equipmentId),
      doers: c.doers.map((d) => d.personId),
      periods: c.periods.map((p) => ({ startedAt: toLocal(p.startedAt), stoppedAt: toLocal(p.stoppedAt) })),
    }),
  );

/** Lignes du formulaire → attelages écrits (lève si une date est en cours de saisie). */
export const crewsBody = (rows: CrewRow[]): InterventionCrew[] =>
  rows.map((c) => ({
    ...(c.id ? { id: c.id } : {}),
    ...(c.label.trim() ? { label: c.label.trim() } : {}),
    ...(c.templateId ? { templateId: c.templateId } : {}),
    tools: c.tools.map((equipmentId) => ({ equipmentId })),
    doers: c.doers.map((personId) => ({ personId })),
    periods: isoPeriods(c.periods),
  }));

/** « Chantier : 15/09 08:00 → 12:00 · temps de travail : 5 h » (FR-ATT-5). */
export function CrewsSummary({ crews }: { crews: InterventionCrew[] | InterventionCrewRead[] }) {
  const { spanS, workDurationS } = crewDurations({ staffing: "crews", crews });
  const periods = crews.flatMap((c) => c.periods);
  if (spanS === null || workDurationS === null || periods.length === 0) return null;
  const start = periods.map((p) => p.startedAt).sort()[0]!;
  const stop = periods.map((p) => p.stoppedAt).sort().at(-1)!;
  return (
    <Text size="sm" className="lv-num" aria-label="Durées du chantier">
      <strong>Chantier :</strong> {formatPeriod(start, stop)} ({formatDuration(Math.round(spanS / 60))}) · <strong>temps de travail :</strong>{" "}
      {formatDuration(Math.round(workDurationS / 60))}
    </Text>
  );
}

/** Périodes de travail (début, durée, fin), ajout et retrait. */
export function PeriodsEditor({
  periods,
  onChange,
  onFirstStart,
  addLabel = "Ajouter une période de travail",
}: {
  periods: LocalPeriod[];
  onChange: (periods: LocalPeriod[]) => void;
  onFirstStart?: (value: string) => void;
  addLabel?: string;
}) {
  return (
    <>
      {periods.map((p, i) => (
        <Group key={i} grow align="flex-end" wrap="nowrap">
          <TextInput
            type="datetime-local"
            label={i === 0 ? "Début" : undefined}
            aria-label="Début"
            value={p.startedAt}
            onChange={(e) => {
              const v = e.currentTarget.value;
              onChange(periods.map((x, j) => (j === i ? withStart(x, v) : x)));
              if (i === 0) onFirstStart?.(v);
            }}
            required
          />
          <DurationInput
            label={i === 0 ? "Durée" : undefined}
            minutes={durationMinutes(p)}
            onChange={(m) => onChange(periods.map((x, j) => (j === i ? withDuration(x, m) : x)))}
          />
          <TextInput
            type="datetime-local"
            label={i === 0 ? "Fin" : undefined}
            aria-label="Fin"
            value={p.stoppedAt}
            onChange={(e) => onChange(periods.map((x, j) => (j === i ? { ...x, stoppedAt: e.currentTarget.value } : x)))}
            required
          />
          {periods.length > 1 && (
            <ActionIcon variant="subtle" color="brique" aria-label="Retirer la période" style={{ flex: "none" }} onClick={() => onChange(periods.filter((_, j) => j !== i))}>
              <Trash2 size={16} />
            </ActionIcon>
          )}
        </Group>
      ))}
      <Button
        variant="subtle"
        size="xs"
        leftSection={<Plus size={14} />}
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const last = periods.at(-1);
          const day = last?.startedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
          onChange([...periods, { startedAt: `${day}T14:00`, stoppedAt: `${day}T17:00` }]);
        }}
      >
        {addLabel}
      </Button>
    </>
  );
}

/** Les attelages de l'intervention : une carte chacun, ajout, duplication, retrait. */
export function CrewsEditor({
  crews,
  onChange,
  equipmentOptions,
  peopleOptions,
  defaultDay,
  errors,
  templates,
}: {
  crews: CrewRow[];
  onChange: (crews: CrewRow[]) => void;
  equipmentOptions: Option[];
  peopleOptions: Option[];
  defaultDay: string;
  errors: string[];
  /** Attelages types de la ferme ; `canWrite` : « Enregistrer comme attelage type » (responsable). */
  templates?: { farmId: string; items: CrewTemplate[]; canWrite: boolean };
}) {
  const update = (k: number, patch: Partial<CrewRow>) => onChange(crews.map((c, j) => (j === k ? { ...c, ...patch } : c)));
  const [saving, setSaving] = useState<number | null>(null);
  const flat = (options: Option[]) => options.flatMap((o) => ("group" in o ? o.items : [o]));
  const templateOptions = (templates?.items ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }));
  let body: InterventionCrew[] | null = null;
  try {
    body = crewsBody(crews);
  } catch {
    body = null; // date en cours de saisie
  }
  return (
    <Stack gap="sm">
      {crews.map((c, k) => {
        const name = c.label.trim() || `Attelage ${k + 1}`;
        return (
          <Paper key={c.key} withBorder p="sm" role="group" aria-label={`Attelage ${k + 1}`}>
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} size="sm">
                  {name}
                </Text>
                <Group gap={4} wrap="nowrap">
                  {templates?.canWrite && c.tools.length > 0 && (
                    <ActionIcon variant="subtle" aria-label="Créer un attelage type depuis cet attelage" title="Enregistrer comme attelage type" onClick={() => setSaving(k)}>
                      <BookmarkPlus size={16} />
                    </ActionIcon>
                  )}
                  <ActionIcon
                    variant="subtle"
                    aria-label="Dupliquer l'attelage"
                    title="Dupliquer : mêmes matériels et intervenants, à la suite de la dernière période"
                    onClick={() => onChange([...crews.slice(0, k + 1), duplicate(c), ...crews.slice(k + 1)])}
                  >
                    <Copy size={16} />
                  </ActionIcon>
                  {crews.length > 1 && (
                    <ActionIcon variant="subtle" color="brique" aria-label="Retirer l'attelage" onClick={() => onChange(crews.filter((_, j) => j !== k))}>
                      <Trash2 size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Group>
              {templateOptions.length > 0 && (
                <Select
                  size="xs"
                  aria-label="Attelage type"
                  placeholder="Reprendre un attelage type…"
                  data={templateOptions}
                  value={c.templateId && templateOptions.some((o) => o.value === c.templateId) ? c.templateId : null}
                  onChange={(id) => {
                    const t = templates?.items.find((x) => x.id === id);
                    if (t) onChange(crews.map((x, j) => (j === k ? fromTemplate(x, t) : x)));
                  }}
                  searchable
                />
              )}
              <TextInput size="xs" aria-label="Nom de l'attelage" placeholder="Nom (facultatif)" maxLength={80} value={c.label} onChange={(e) => update(k, { label: e.currentTarget.value })} />
              <MultiSelect label="Matériels" searchable data={equipmentOptions} value={c.tools} onChange={(tools) => update(k, { tools })} />
              <MultiSelect
                label="Intervenants"
                placeholder={c.doers.length ? undefined : "Conducteur inconnu"}
                searchable
                data={peopleOptions}
                value={c.doers}
                onChange={(doers) => update(k, { doers })}
                nothingFoundMessage="Aucune personne — à ajouter dans Équipe"
              />
              <PeriodsEditor periods={c.periods} onChange={(periods) => update(k, { periods })} />
            </Stack>
          </Paper>
        );
      })}
      <Button
        variant="light"
        size="xs"
        leftSection={<Plus size={14} />}
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const day = crews.at(-1)?.periods[0]?.startedAt.slice(0, 10) ?? defaultDay;
          onChange([...crews, newCrew({ periods: [{ startedAt: `${day}T08:00`, stoppedAt: `${day}T10:00` }] })]);
        }}
      >
        Ajouter un attelage
      </Button>
      {body && <CrewsSummary crews={body} />}
      {saving !== null && templates && crews[saving] && (
        <CrewTemplateModal
          farmId={templates.farmId}
          template={null}
          initial={{ name: crews[saving]!.label.trim(), equipmentIds: crews[saving]!.tools, personIds: crews[saving]!.doers }}
          equipmentOptions={flat(equipmentOptions)}
          peopleOptions={flat(peopleOptions)}
          onClose={() => setSaving(null)}
          onSaved={(t) => update(saving, { templateId: t.id, label: crews[saving]!.label.trim() ? crews[saving]!.label : t.name })}
        />
      )}
      {errors.length > 0 && (
        <Alert color="paille" variant="light" title="Attelages à compléter">
          <Stack gap={2}>
            {errors.map((e) => (
              <Text key={e} size="sm">
                {e}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}

/**
 * Durée d'une période (« 2 h 30 », « 2,5 », « 45 min ») : la fin se calcule
 * en quittant le champ (ou avec Entrée).
 */
export function DurationInput({ label, minutes, onChange }: { label?: string; minutes: number | null; onChange: (minutes: number) => void }) {
  const shown = minutes === null ? "" : formatDuration(minutes);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const m = parseDuration(text);
    if (m === null) setText(shown);
    else if (m !== minutes) onChange(m);
  };
  return (
    <TextInput
      label={label}
      aria-label="Durée"
      placeholder="2 h 30"
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      style={{ flex: "0 0 7rem" }}
    />
  );
}
