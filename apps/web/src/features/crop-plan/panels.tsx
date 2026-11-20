import { useMemo, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { Ban, Crosshair, Eraser, Plus, Sprout } from "lucide-react";
import { ACTIVITY_FAMILY_LABELS, type ActivityFamily, type ControlFinding, type ControlSection, type CropPlanChange, type CropPlanContext, type CropPlanParcelKey, type CropPlanValidation } from "@fourmy/contracts";
import { useArea } from "../../app/prefs";
import { api, farmPath } from "../../app/api";
import { ControlLight } from "../certification/controls";
import { cropPlanKeys, useCropPlanVersion } from "./queries";
import { addSecondary, assignMain, clearParcels, markFallow, type CropPlanEditor } from "./useCropPlanEditor";

/** Panneaux de l'écran d'assolement (conception §7). */

const SECTION_ORDER = ["pac", "agronomy", "certification", "regulatory"];

/** Ce qui est prévu sur une parcelle, en clair. */
export function plannedLabel(editor: CropPlanEditor, key: string): string {
  const main = editor.draft.assignments.filter((a) => a.key === key && a.role === "main").map((a) => editor.activities.get(a.activityId)?.name ?? "?");
  const second = editor.draft.assignments.filter((a) => a.key === key && a.role === "secondary").map((a) => editor.activities.get(a.activityId)?.name ?? "?");
  const fallow = editor.draft.fallow.some((f) => f.key === key);
  if (!main.length && fallow) return "Sans culture";
  if (!main.length) return "—";
  return second.length ? `${main.join(" puis ")} + ${second.join(", ")}` : main.join(" puis ");
}

/** Culture de l'an passé d'une parcelle de départ. */
export function previousLabel(context: CropPlanContext, parcelId: string): string {
  return context.history[parcelId]?.[String(context.year - 1)]?.label ?? "—";
}

const activityOptions = (context: CropPlanContext) => {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const a of context.activities) {
    const g = ACTIVITY_FAMILY_LABELS[a.family as ActivityFamily] ?? a.family;
    groups.set(g, [...(groups.get(g) ?? []), { value: a.id, label: a.name }]);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
};

const touches = (f: ControlFinding, keys: Set<string>) => (f.refs.parcelIds ?? []).some((k) => keys.has(k));

/** Choix des parcelles (liste accessible, en plus de la carte) et affectation des cultures. */
export function AssignPanel({ editor, context, selected, onSelect, editable }: { editor: CropPlanEditor; context: CropPlanContext; selected: CropPlanParcelKey[]; onSelect: (keys: CropPlanParcelKey[]) => void; editable: boolean }) {
  const area = useArea();
  const [filter, setFilter] = useState<"all" | "todo">("all");
  const [activityId, setActivityId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [startedOn, setStartedOn] = useState("");
  const [stoppedOn, setStoppedOn] = useState("");
  const sel = new Set<string>(selected);
  const todo = new Set<string>(editor.summary.unassigned.keys);
  const parcels = editor.plan.parcels.filter((p) => filter === "all" || todo.has(p.key));
  const selectedArea = editor.plan.parcels.filter((p) => sel.has(p.key)).reduce((s, p) => s + p.areaM2, 0);
  const options = useMemo(() => activityOptions(context), [context]);
  const dates = { startedOn: startedOn || null, stoppedOn: stoppedOn || null };
  const findings = editor.sections.flatMap((s) => s.findings).filter((f) => f.level !== "ok" && f.level !== "na" && touches(f, sel));
  const toggle = (key: CropPlanParcelKey) => onSelect(sel.has(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={(v) => setFilter(v as "all" | "todo")}
          data={[
            { value: "all", label: `Toutes (${editor.plan.parcels.length})` },
            { value: "todo", label: `Sans culture prévue (${todo.size})` },
          ]}
        />
        <Group gap="xs">
          <Button size="compact-xs" variant="subtle" onClick={() => onSelect(parcels.map((p) => p.key))}>
            Tout choisir
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={() => onSelect([])} disabled={!selected.length}>
            Aucune
          </Button>
        </Group>
      </Group>
      <ScrollArea.Autosize mah={260}>
        <Table striped highlightOnHover aria-label="Parcelles de l'assolement">
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th>Parcelle</Table.Th>
              <Table.Th>Surface</Table.Th>
              <Table.Th>{context.year - 1}</Table.Th>
              <Table.Th>{context.year}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {parcels.map((p) => (
              <Table.Tr key={p.key}>
                <Table.Td>
                  <Checkbox size="xs" aria-label={`Choisir ${p.name}`} checked={sel.has(p.key)} onChange={() => toggle(p.key)} />
                </Table.Td>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td className="lv-num">{area(p.areaM2)}</Table.Td>
                <Table.Td>{p.origins.length === 1 ? previousLabel(context, p.origins[0]!.parcelId) : "plusieurs"}</Table.Td>
                <Table.Td>{plannedLabel(editor, p.key)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>

      {editable && (
        <Paper withBorder p="sm" aria-label="Affecter une culture">
          <Text fw={600} size="sm" mb="xs">
            {selected.length ? `${selected.length} parcelle(s) · ${area(selectedArea)}` : "Choisissez des parcelles sur la carte ou dans la liste"}
          </Text>
          <Stack gap="xs">
            <Select label="Activité" placeholder="Culture principale" data={options} value={activityId} onChange={setActivityId} searchable />
            <Group grow>
              <TextInput type="date" label="Semis (prévu)" value={startedOn} onChange={(e) => setStartedOn(e.currentTarget.value)} />
              <TextInput type="date" label="Récolte (prévue)" value={stoppedOn} onChange={(e) => setStoppedOn(e.currentTarget.value)} />
            </Group>
            <Group gap="xs">
              <Button size="xs" leftSection={<Sprout size={14} />} disabled={!selected.length || !activityId} onClick={() => editor.apply((d) => assignMain(d, selected, activityId!, dates))}>
                Affecter
              </Button>
              <Button size="xs" variant="light" leftSection={<Ban size={14} />} disabled={!selected.length} onClick={() => editor.apply((d) => markFallow(d, selected))}>
                Sans culture
              </Button>
              <Button size="xs" variant="subtle" color="brique" leftSection={<Eraser size={14} />} disabled={!selected.length} onClick={() => editor.apply((d) => clearParcels(d, selected))}>
                Retirer
              </Button>
            </Group>
            <Group gap="xs" align="flex-end">
              <Select size="xs" label="Culture dérobée" placeholder="Après la principale" data={options} value={secondaryId} onChange={setSecondaryId} searchable style={{ flex: 1 }} />
              <Button size="xs" variant="light" leftSection={<Plus size={14} />} disabled={!selected.length || !secondaryId} onClick={() => editor.apply((d) => addSecondary(d, selected, secondaryId!, { startedOn: null, stoppedOn: null }))}>
                Ajouter
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {findings.length > 0 && (
        <Stack gap={4} aria-label="Constats des parcelles choisies">
          {findings.map((f, i) => (
            <Group key={`${f.ruleId}-${i}`} gap="xs" wrap="nowrap" align="flex-start">
              <ControlLight level={f.level} variant="inline" />
              <Text size="sm">{f.message}</Text>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Récapitulatif (FR-AS-8) : surfaces par famille et activité, écart avec l'an passé. */
export function SummaryPanel({ editor, context }: { editor: CropPlanEditor; context: CropPlanContext }) {
  const area = useArea();
  const s = editor.summary;
  const pct = (x: number) => `${Math.round(x * 1000) / 10} %`.replace(".", ",");
  const delta = (now: number, before: number) => (now === before ? "=" : `${now > before ? "+" : "−"}${area(Math.abs(now - before))}`);
  return (
    <Stack gap="sm">
      <Group gap="xl">
        <Text size="sm">
          Parcellaire : <b className="lv-num">{area(s.totalM2)}</b>
        </Text>
        <Text size="sm">
          Cultures prévues : <b className="lv-num">{area(s.assignedM2)}</b>
        </Text>
        {s.fallowM2 > 0 && <Text size="sm">Sans culture : {area(s.fallowM2)}</Text>}
        {s.unassigned.keys.length > 0 && (
          <Text size="sm" c="brique">
            À affecter : {s.unassigned.keys.length} parcelle(s), {area(s.unassigned.areaM2)}
          </Text>
        )}
      </Group>
      <Table aria-label="Surfaces par activité">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Activité</Table.Th>
            <Table.Th>Famille</Table.Th>
            <Table.Th>{context.year}</Table.Th>
            <Table.Th>Part</Table.Th>
            <Table.Th>{context.year - 1}</Table.Th>
            <Table.Th>Écart</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.byActivity.map((l) => (
            <Table.Tr key={l.activityId}>
              <Table.Td>{l.name}</Table.Td>
              <Table.Td>{ACTIVITY_FAMILY_LABELS[l.family as ActivityFamily] ?? l.family}</Table.Td>
              <Table.Td className="lv-num">{l.areaM2 ? area(l.areaM2) : "—"}</Table.Td>
              <Table.Td className="lv-num">{l.areaM2 ? pct(l.share) : ""}</Table.Td>
              <Table.Td className="lv-num">{l.previousM2 ? area(l.previousM2) : "—"}</Table.Td>
              <Table.Td className="lv-num">{delta(l.areaM2, l.previousM2)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {s.secondary.length > 0 && (
        <Text size="sm">
          Cultures dérobées : {s.secondary.map((x) => `${x.name} ${area(x.areaM2)}`).join(", ")}
        </Text>
      )}
    </Stack>
  );
}

/** Contrôles en direct (FR-AS-9) : un clic sur « Voir » choisit les parcelles en cause. */
export function ChecksPanel({ sections, onSelect }: { sections: ControlSection[]; onSelect: (keys: CropPlanParcelKey[]) => void }) {
  const ordered = [...sections].sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id));
  return (
    <Stack gap="md">
      {ordered.map((s) => (
        <Paper key={s.id} withBorder p="sm" aria-label={`Contrôles ${s.label}`}>
          <Group justify="space-between" mb="xs">
            <Title order={4}>{s.label}</Title>
            <ControlLight level={s.level} />
          </Group>
          {s.findings.length === 0 && (
            <Text size="sm" c="dimmed">
              Rien à signaler.
            </Text>
          )}
          <Stack gap={6}>
            {s.findings.map((f, i) => (
              <Group key={`${f.ruleId}-${i}`} gap="xs" wrap="nowrap" align="flex-start">
                <ControlLight level={f.level} variant="inline" />
                <div style={{ flex: 1 }}>
                  <Text size="sm">{f.message}</Text>
                  {f.missing?.length ? (
                    <Text size="xs" c="dimmed">
                      À compléter : {f.missing.map((m) => m.what).join(", ")}
                    </Text>
                  ) : null}
                  <Text size="xs" c="dimmed">
                    {f.source}
                  </Text>
                </div>
                {f.refs.parcelIds?.length ? (
                  <Button size="compact-xs" variant="subtle" leftSection={<Crosshair size={12} />} onClick={() => onSelect(f.refs.parcelIds as CropPlanParcelKey[])}>
                    Voir
                  </Button>
                ) : null}
              </Group>
            ))}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

/** Un changement de la validation, en clair. */
function changeLabel(c: CropPlanChange, names: (key: string) => string, activity: (id: string) => string): string {
  switch (c.kind) {
    case "campaign.create":
      return `Campagne ${c.year} créée`;
    case "production.create":
      return `${names(c.key)} : ${activity(c.after.activityId)}${c.after.role === "secondary" ? " (dérobée)" : ""}`;
    case "production.update":
      return c.before.activityId === c.after.activityId
        ? `${names(c.key)} : ${activity(c.after.activityId)}, dates modifiées`
        : `${names(c.key)} : ${activity(c.before.activityId)} → ${activity(c.after.activityId)}`;
    case "production.delete":
      return `${names(c.key)} : ${activity(c.before.activityId)} retiré(e)`;
    case "parcel.split":
      return `${names(c.source)} découpée en ${c.pieces.map((p) => p.name).join(", ")}`;
    case "parcel.merge":
      return `${c.sources.map(names).join(", ")} fusionnées en ${c.result.name}`;
  }
}

export function ChangeList({ changes, editor, context }: { changes: CropPlanChange[]; editor: CropPlanEditor; context: CropPlanContext }) {
  const names = (key: string) => editor.plan.byKey.get(key as CropPlanParcelKey)?.name ?? context.parcels.find((p) => `p:${p.id}` === key)?.name ?? key;
  const activity = (id: string) => editor.activities.get(id)?.name ?? "activité inconnue";
  if (!changes.length) return <Text size="sm">Aucun changement.</Text>;
  return (
    <Stack gap={2} aria-label="Changements">
      {changes.map((c, i) => (
        <Text key={i} size="sm">
          {changeLabel(c, names, activity)}
        </Text>
      ))}
    </Stack>
  );
}

/** Fenêtre de validation (conception §6, §7) : aperçu, bloquants, constats, motif d'une révision. */
export function ValidateModal({ farmId, year, editor, context, revision, revising, opened, onClose, onSelect }: {
  farmId: string;
  year: number;
  editor: CropPlanEditor;
  context: CropPlanContext;
  revision: number;
  revising: boolean;
  opened: boolean;
  onClose: () => void;
  onSelect: (keys: CropPlanParcelKey[]) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const preview = useQuery({
    queryKey: ["crop-plans", farmId, year, "preview", revision],
    queryFn: () => api.post<CropPlanValidation>(farmPath(farmId, `/crop-plans/${year}/validate?dryRun=1`), { revision }),
    enabled: opened,
    staleTime: 0,
    gcTime: 0,
  });
  const validate = useMutation({
    mutationFn: () => api.post<CropPlanValidation>(farmPath(farmId, `/crop-plans/${year}/validate`), { revision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    onSuccess: async (r) => {
      notifications.show({ color: "lichen", message: `Assolement ${year} validé (version ${r.version}).` });
      await qc.invalidateQueries({ queryKey: cropPlanKeys.all(farmId) });
      await qc.invalidateQueries({ queryKey: ["activities", farmId] });
      onClose();
    },
  });
  const p = preview.data;
  const counts = (level: string) => (p?.sections ?? []).flatMap((s) => s.findings).filter((f) => f.level === level).length;
  return (
    <Modal opened={opened} onClose={onClose} title={`Valider l'assolement ${year}`} size="lg">
      {preview.isLoading && <Text size="sm">Calcul de l'aperçu…</Text>}
      {preview.error && <Alert color="brique">{(preview.error as Error).message}</Alert>}
      {p && (
        <Stack>
          {p.blockers.length > 0 && (
            <Alert color="brique" title="À corriger avant de valider">
              <Stack gap={4}>
                {p.blockers.map((b, i) => (
                  <Group key={i} justify="space-between" wrap="nowrap">
                    <Text size="sm">{b.message}</Text>
                    {b.keys.length > 0 && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() => {
                          onSelect(b.keys as CropPlanParcelKey[]);
                          onClose();
                        }}
                      >
                        Voir
                      </Button>
                    )}
                  </Group>
                ))}
              </Stack>
            </Alert>
          )}
          <div>
            <Text fw={600} size="sm" mb={4}>
              Ce qui sera enregistré
            </Text>
            <ChangeList changes={p.changes} editor={editor} context={context} />
          </div>
          <Group gap="xs">
            <Badge color="brique" variant="light">{counts("danger")} non conforme(s)</Badge>
            <Badge color="paille" variant="light">{counts("warning")} à vérifier</Badge>
            <Badge color="gray" variant="light">{counts("missing")} données manquantes</Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Les constats agronomiques et réglementaires ne bloquent pas la validation ; ils sont gardés avec la version.
          </Text>
          {revising && <Textarea label="Motif de la révision" placeholder="Sortie d'hiver, colza gelé…" value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} />}
          {validate.error && <Alert color="brique">{(validate.error as Error).message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Annuler
            </Button>
            <Button disabled={p.blockers.length > 0} loading={validate.isPending} onClick={() => validate.mutate()}>
              Valider l'assolement
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

/** Versions validées et leurs changements (FR-AS-12). */
export function HistoryPanel({ farmId, year, versions, editor, context }: { farmId: string; year: number; versions: { version: number; validatedAt: string; reason: string | null }[]; editor: CropPlanEditor; context: CropPlanContext }) {
  const [open, setOpen] = useState<number | null>(versions[0]?.version ?? null);
  const v = useCropPlanVersion(farmId, year, open);
  if (!versions.length) return <Text size="sm">Pas encore de version validée.</Text>;
  return (
    <Stack gap="sm">
      <SegmentedControl
        size="xs"
        value={String(open ?? "")}
        onChange={(x) => setOpen(Number(x))}
        data={versions.map((x) => ({ value: String(x.version), label: `Version ${x.version}` }))}
      />
      {v.data && (
        <Paper withBorder p="sm" aria-label={`Version ${v.data.version}`}>
          <Text size="sm" mb="xs">
            Validée le {new Date(v.data.validatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            {v.data.reason ? ` · motif : ${v.data.reason}` : ""}
          </Text>
          <ChangeList changes={v.data.changes} editor={editor} context={context} />
        </Paper>
      )}
    </Stack>
  );
}
