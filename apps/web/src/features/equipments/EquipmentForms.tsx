import { useState } from "react";
import { ActionIcon, Alert, Button, Checkbox, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_STATE_LABELS,
  METERED_KINDS,
  type EquipmentAggregate,
  type EquipmentSheet,
  type EquipmentSummary,
  type EquipmentWrite,
  type MeterReadingResult,
} from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { formatDateTime } from "../../app/labels";

/** Instant → valeur d'un champ `datetime-local` (heure locale). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => new Date(v).toISOString();
export const formatHours = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

/** Après une écriture : liste, fiche et snapshot à jour. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["equipments"] });
    void queryClient.invalidateQueries({ queryKey: ["equipment-sheet"] });
    void queryClient.invalidateQueries({ queryKey: ["brands"] });
    void queryClient.invalidateQueries({ queryKey: ["snapshot"] });
  };
}

/**
 * Saisie d'un relevé en quelques gestes (FR-MAT-11) : date et valeur. Une
 * valeur plus basse que le relevé précédent est refusée par l'API ; on
 * propose alors une correction motivée (saisie fausse ou compteur remplacé).
 */
export function ReadingModal({ farmId, equipment, onClose }: { farmId: string; equipment: Pick<EquipmentSummary, "id" | "name" | "lastReading">; onClose: () => void }) {
  const refresh = useRefresh();
  const [readAt, setReadAt] = useState(toLocalInput(new Date().toISOString()));
  const [value, setValue] = useState<number | string>("");
  const [note, setNote] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState<"fix" | "replacement">("fix");
  const [reason, setReason] = useState("");
  const last = equipment.lastReading;

  const save = useMutation({
    mutationFn: () =>
      api.post<MeterReadingResult>(farmPath(farmId, `/equipments/${equipment.id}/readings`), {
        readAt: fromLocalInput(readAt),
        value: Number(value),
        note: note.trim() || null,
        ...(correcting ? { correction, correctionReason: reason.trim() } : {}),
      }),
    onSuccess: (r) => {
      notifications.show({ color: r.warning ? "paille" : "lichen", message: r.warning ?? `Relevé enregistré : ${formatHours(r.reading.value)}.` });
      refresh();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setRefused(e.detail ?? e.message);
      else setRefused(e instanceof ApiError ? e.message : String(e));
    },
  });

  return (
    <Modal opened onClose={onClose} title={`Relevé du compteur — ${equipment.name}`}>
      <Stack>
        {last && (
          <Text size="sm" c="dimmed">
            Dernier relevé : <b>{formatHours(last.value)}</b> le {formatDateTime(last.readAt)}
          </Text>
        )}
        <TextInput type="datetime-local" label="Date et heure" value={readAt} onChange={(e) => setReadAt(e.currentTarget.value)} required />
        <NumberInput
          label="Heures moteur"
          value={value}
          onChange={setValue}
          min={0}
          decimalScale={1}
          thousandSeparator=" "
          suffix=" h"
          required
          data-autofocus
        />
        <TextInput label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        {refused && (
          <Alert color="brique" title="Relevé refusé">
            {refused}
          </Alert>
        )}
        {(refused || correcting) && (
          <Checkbox label="C'est une correction" checked={correcting} onChange={(e) => setCorrecting(e.currentTarget.checked)} />
        )}
        {correcting && (
          <>
            <SegmentedControl
              value={correction}
              onChange={(v) => setCorrection(v as "fix" | "replacement")}
              data={[
                { value: "fix", label: "Saisie précédente fausse" },
                { value: "replacement", label: "Compteur remplacé" },
              ]}
            />
            <TextInput label="Motif" required value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={value === "" || !readAt || (correcting && !reason.trim())}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type Draft = EquipmentWrite & { aggregates: EquipmentAggregate[] };

const emptyDraft = (): Draft => ({ name: "", kind: "tractor", state: "active", brand: "", model: "", serialNumber: "", manufacturerType: "", year: null, meterUnit: "hours", commissionedAt: null, aggregates: [], externalIds: {}, notes: "" });

const fromSheet = (s: EquipmentSheet): Draft => ({
  name: s.name,
  kind: s.kind,
  state: s.state ?? "active",
  brand: s.brand ?? "",
  model: s.model ?? "",
  serialNumber: s.serialNumber ?? "",
  manufacturerType: s.manufacturerType ?? "",
  year: s.year,
  meterUnit: s.meterUnit,
  commissionedAt: s.commissionedAt,
  aggregates: s.aggregates,
  externalIds: s.externalIds,
  notes: s.notes ?? "",
});

/** Création ou modification de la fiche d'identité (responsable). */
export function EquipmentFormModal({ farmId, sheet, onClose, onCreated }: { farmId: string; sheet?: EquipmentSheet; onClose: () => void; onCreated?: (id: string) => void }) {
  const refresh = useRefresh();
  const [d, setD] = useState<Draft>(sheet ? fromSheet(sheet) : emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...d, aggregates: d.aggregates.filter((a) => a.organ.trim()) };
      return sheet ? api.put(farmPath(farmId, `/equipments/${sheet.id}`), body).then(() => ({ id: sheet.id })) : api.post<{ id: string }>(farmPath(farmId, "/equipments"), body);
    },
    onSuccess: (r) => {
      notifications.show({ color: "lichen", message: sheet ? "Fiche enregistrée." : "Matériel créé." });
      refresh();
      if (!sheet) onCreated?.(r.id);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  return (
    <Modal opened onClose={onClose} title={sheet ? `Fiche — ${sheet.name}` : "Nouveau matériel"} size="lg">
      <Stack>
        <TextInput label="Nom" required value={d.name} onChange={(e) => set("name", e.currentTarget.value)} />
        <Group grow>
          <Select
            label="Nature"
            data={Object.entries(EQUIPMENT_KIND_LABELS).map(([value, label]) => ({ value, label }))}
            value={d.kind}
            onChange={(v) => {
              if (!v) return;
              setD((x) => ({ ...x, kind: v, meterUnit: sheet ? x.meterUnit : METERED_KINDS.includes(v) ? "hours" : null }));
            }}
            allowDeselect={false}
          />
          <Select label="État" data={Object.entries(EQUIPMENT_STATE_LABELS).map(([value, label]) => ({ value, label }))} value={d.state ?? "active"} onChange={(v) => set("state", v)} allowDeselect={false} />
        </Group>
        <Group grow>
          <TextInput label="Marque" value={d.brand ?? ""} onChange={(e) => set("brand", e.currentTarget.value)} />
          <TextInput label="Modèle" value={d.model ?? ""} onChange={(e) => set("model", e.currentTarget.value)} />
        </Group>
        <Group grow>
          <TextInput label="N° de série" value={d.serialNumber ?? ""} onChange={(e) => set("serialNumber", e.currentTarget.value)} />
          <TextInput label="Type constructeur" value={d.manufacturerType ?? ""} onChange={(e) => set("manufacturerType", e.currentTarget.value)} />
          <NumberInput label="Année" min={1900} max={2100} value={d.year ?? ""} onChange={(v) => set("year", typeof v === "number" ? v : null)} />
        </Group>
        <Group grow align="flex-end">
          <Switch label="Compteur d'heures" checked={d.meterUnit === "hours"} onChange={(e) => set("meterUnit", e.currentTarget.checked ? "hours" : null)} />
          <TextInput
            type="date"
            label="Mise en service"
            value={d.commissionedAt?.slice(0, 10) ?? ""}
            onChange={(e) => set("commissionedAt", e.currentTarget.value ? new Date(`${e.currentTarget.value}T00:00:00`).toISOString() : null)}
          />
        </Group>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Agrégats (moteur, boîte, ponts…)
          </Text>
          {d.aggregates.map((a, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <TextInput aria-label="Organe" placeholder="Organe" value={a.organ} onChange={(e) => set("aggregates", d.aggregates.map((x, j) => (j === i ? { ...x, organ: e.currentTarget.value } : x)))} />
              <TextInput aria-label="Désignation" placeholder="Désignation" value={a.designation ?? ""} onChange={(e) => set("aggregates", d.aggregates.map((x, j) => (j === i ? { ...x, designation: e.currentTarget.value } : x)))} />
              <TextInput aria-label="N° d'agrégat" placeholder="N°" value={a.serial ?? ""} onChange={(e) => set("aggregates", d.aggregates.map((x, j) => (j === i ? { ...x, serial: e.currentTarget.value } : x)))} />
              <ActionIcon variant="subtle" color="brique" aria-label="Retirer l'agrégat" onClick={() => set("aggregates", d.aggregates.filter((_, j) => j !== i))}>
                <Trash2 size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button variant="subtle" size="compact-sm" w="fit-content" leftSection={<Plus size={14} />} onClick={() => set("aggregates", [...d.aggregates, { organ: "" }])}>
            Ajouter un agrégat
          </Button>
        </Stack>
        <TextInput
          label="Identifiant Traccar"
          description="Identifiant externe conservé sur la fiche (NFR-MAT-6)."
          value={d.externalIds.traccar ?? ""}
          onChange={(e) => {
            const v = e.currentTarget.value;
            const { traccar: _, ...rest } = d.externalIds;
            set("externalIds", v.trim() ? { ...rest, traccar: v } : rest);
          }}
        />
        <Textarea label="Notes" autosize minRows={2} value={d.notes ?? ""} onChange={(e) => set("notes", e.currentTarget.value)} />
        {error && <Alert color="brique">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!d.name.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
