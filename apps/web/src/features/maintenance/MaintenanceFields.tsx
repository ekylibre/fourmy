import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Checkbox, Collapse, Group, MultiSelect, NumberInput, Paper, SegmentedControl, Stack, Table, Text, TextInput, Textarea, Title } from "@mantine/core";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { dueLabel } from "@fourmy/domain";
import type { EquipmentMaintenance, EquipmentSummary, Intervention, MaintenanceNature, MaintenanceRead } from "@fourmy/contracts";
import { formatDate } from "../../app/labels";
import { useMaintenance } from "../../app/queries";
import { EquipmentLogo } from "../equipments/EquipmentLogo";
import { formatHours } from "../equipments/EquipmentForms";
import { DueBadge } from "./Maintenance";

/** Saisie de l'entretien (lot K) : état du formulaire. */
export interface MaintenanceDraft {
  meters: Record<string, number | "">;
  operations: Record<string, { equipmentId: string; result: "done" | "ok" | "anomaly"; note: string }>;
  /** null : déduite des opérations cochées. */
  nature: MaintenanceNature | null;
  problem: string;
  workshop: string;
  workshopRef: string;
}

export function draftFrom(i: Intervention | undefined, initial?: { equipmentId?: string; operationIds?: string[]; nature?: MaintenanceNature | null; problem?: string }): MaintenanceDraft {
  const m: MaintenanceRead | null | undefined = i?.maintenance;
  return {
    meters: Object.fromEntries((i?.targets ?? []).filter((t) => t.meter).map((t) => [t.id, t.meter!.value])),
    operations: m
      ? Object.fromEntries(m.operations.map((o) => [o.operationId, { equipmentId: o.equipmentId, result: o.result, note: o.note ?? "" }]))
      : Object.fromEntries((initial?.operationIds ?? []).map((id) => [id, { equipmentId: initial!.equipmentId!, result: "done" as const, note: "" }])),
    nature: m?.nature ?? initial?.nature ?? null,
    problem: m?.problem ?? initial?.problem ?? "",
    workshop: m?.workshop?.name ?? "",
    workshopRef: m?.workshop?.reference ?? "",
  };
}

export const draftNature = (d: MaintenanceDraft): MaintenanceNature => d.nature ?? (Object.keys(d.operations).length ? "preventive" : "corrective");

/** Bloc `maintenance` et relevés envoyés à l'API. */
export function maintenanceBody(d: MaintenanceDraft, selected: string[]) {
  return {
    nature: draftNature(d),
    problem: d.problem.trim() || null,
    workshop: d.workshop.trim() ? { name: d.workshop.trim(), reference: d.workshopRef.trim() || null } : null,
    operations: Object.entries(d.operations)
      .filter(([, o]) => selected.includes(o.equipmentId))
      .map(([operationId, o]) => ({ equipmentId: o.equipmentId, operationId, result: o.result, note: o.note.trim() || null })),
  };
}

export type PartLine = { articleId: string; quantity: number; equipmentId: string };

interface FieldsProps {
  farmId: string;
  at: string;
  equipments: EquipmentSummary[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  value: MaintenanceDraft;
  onChange: (d: MaintenanceDraft) => void;
  completing: boolean;
  /** Pièces des opérations cochées : ajoutées aux intrants (pré-remplissage). */
  onParts: (parts: PartLine[]) => void;
  /** Nouvelle saisie : les pièces des opérations déjà cochées (depuis une échéance) sont ajoutées. */
  prefill?: boolean;
}

/**
 * Champs d'une intervention d'entretien (FR-MAT-30 à 33, 50 à 55) : matériels,
 * relevé de compteur, opérations du plan (échéances d'abord), résultat des
 * contrôles, nature, problème, atelier externe.
 */
export function MaintenanceFields({ farmId, at, equipments, selected, onSelect, value: d, onChange, completing, onParts, prefill }: FieldsProps) {
  const nature = draftNature(d);
  return (
    <Stack gap="sm">
      <MultiSelect
        label="Matériels entretenus"
        searchable
        data={equipments.map((e) => ({ value: e.id, label: e.name }))}
        value={selected}
        onChange={onSelect}
      />
      {selected.map((id) => {
        const e = equipments.find((x) => x.id === id);
        return e ? <EquipmentCard key={id} farmId={farmId} at={at} equipment={e} value={d} onChange={onChange} completing={completing} onParts={onParts} prefill={prefill} /> : null;
      })}
      <Group align="flex-end" gap="sm">
        <SegmentedControl
          aria-label="Nature de l'entretien"
          value={nature}
          onChange={(v) => onChange({ ...d, nature: v as MaintenanceNature })}
          data={[
            { value: "preventive", label: "Préventif (plan)" },
            { value: "corrective", label: "Curatif (panne, réparation)" },
          ]}
        />
        {d.nature && (
          <Button size="compact-xs" variant="subtle" onClick={() => onChange({ ...d, nature: null })}>
            Selon les opérations
          </Button>
        )}
      </Group>
      {(nature === "corrective" || d.problem) && (
        <Textarea
          label="Problème constaté"
          required={nature === "corrective" && completing}
          autosize
          minRows={2}
          maxLength={2000}
          value={d.problem}
          onChange={(e) => onChange({ ...d, problem: e.currentTarget.value })}
        />
      )}
      <Group grow>
        <TextInput label="Atelier externe" placeholder="Concessionnaire, garage…" value={d.workshop} onChange={(e) => onChange({ ...d, workshop: e.currentTarget.value })} />
        <TextInput label="N° de bon ou de facture" value={d.workshopRef} onChange={(e) => onChange({ ...d, workshopRef: e.currentTarget.value })} disabled={!d.workshop.trim()} />
      </Group>
    </Stack>
  );
}

function EquipmentCard({
  farmId,
  at,
  equipment: e,
  value: d,
  onChange,
  completing,
  onParts,
  prefill,
}: { farmId: string; at: string; equipment: EquipmentSummary } & Pick<FieldsProps, "value" | "onChange" | "completing" | "onParts" | "prefill">) {
  const q = useMaintenance(farmId, e.id, at);
  const [others, setOthers] = useState(false);
  // Opérations cochées d'avance (depuis une échéance) : leurs pièces rejoignent les intrants, une fois.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!prefill || prefilled.current || !q.data) return;
    prefilled.current = true;
    const parts = q.data.operations
      .filter((o) => d.operations[o.id]?.equipmentId === e.id)
      .flatMap((o) => o.parts.map((p) => ({ articleId: p.articleId, quantity: p.quantity, equipmentId: e.id })));
    if (parts.length) onParts(parts);
  }, [prefill, q.data, d.operations, e.id, onParts]);
  const ops = (q.data?.operations ?? []).filter((o) => o.due.status !== "not_applicable");
  const urgent = ops.filter((o) => ["overdue", "soon"].includes(o.due.status) || d.operations[o.id]);
  const rest = ops.filter((o) => !urgent.includes(o));
  const toggle = (op: EquipmentMaintenance["operations"][number], on: boolean) => {
    const next = { ...d.operations };
    if (on) {
      next[op.id] = { equipmentId: e.id, result: op.kind === "inspection" ? "ok" : "done", note: "" };
      if (op.parts.length) onParts(op.parts.map((p) => ({ articleId: p.articleId, quantity: p.quantity, equipmentId: e.id })));
    } else delete next[op.id];
    onChange({ ...d, operations: next });
  };
  const row = (op: EquipmentMaintenance["operations"][number]) => {
    const checked = d.operations[op.id];
    return (
      <Stack key={op.id} gap={4}>
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Checkbox checked={!!checked} onChange={(ev) => toggle(op, ev.currentTarget.checked)} aria-label={op.label} mt={2} />
          <Stack gap={0} style={{ flex: 1 }}>
            <Group gap={6}>
              <Text size="sm">{op.label}</Text>
              {op.due.status !== "ok" && op.due.status !== "on_demand" && <DueBadge status={op.due.status} />}
            </Group>
            <Text size="xs" c="dimmed">
              {op.due.status === "unknown" ? "Dernière réalisation inconnue" : dueLabel(op.due)}
              {op.parts.length ? ` · ${op.parts.length} pièce(s)` : ""}
            </Text>
          </Stack>
        </Group>
        {checked && op.kind === "inspection" && (
          <Group gap="xs" ml={28}>
            <SegmentedControl
              size="xs"
              aria-label={`Résultat : ${op.label}`}
              value={checked.result}
              onChange={(v) => onChange({ ...d, operations: { ...d.operations, [op.id]: { ...checked, result: v as "ok" | "anomaly" } } })}
              data={[
                { value: "ok", label: "RAS" },
                { value: "anomaly", label: "Anomalie" },
              ]}
            />
            {checked.result === "anomaly" && (
              <TextInput
                size="xs"
                placeholder="Ce qui a été constaté"
                aria-label={`Anomalie : ${op.label}`}
                value={checked.note}
                onChange={(ev) => onChange({ ...d, operations: { ...d.operations, [op.id]: { ...checked, note: ev.currentTarget.value } } })}
                style={{ flex: 1 }}
              />
            )}
          </Group>
        )}
      </Stack>
    );
  };
  return (
    <Paper withBorder p="sm" aria-label={`Entretien de ${e.name}`}>
      <Stack gap="xs">
        <Group gap="sm" justify="space-between">
          <Group gap="xs">
            <EquipmentLogo farmId={farmId} assetId={e.logoAssetId} kind={e.kind} size={24} />
            <Text fw={600}>{e.name}</Text>
          </Group>
          {e.meterUnit && completing && (
            <NumberInput
              size="xs"
              w={190}
              aria-label={`Compteur de ${e.name}`}
              placeholder="Compteur"
              description={e.lastReading ? `Dernier : ${formatHours(e.lastReading.value)} le ${formatDate(e.lastReading.readAt)}` : "Aucun relevé"}
              min={0}
              suffix=" h"
              thousandSeparator=" "
              value={d.meters[e.id] ?? ""}
              onChange={(v) => onChange({ ...d, meters: { ...d.meters, [e.id]: v === "" ? "" : Number(v) } })}
            />
          )}
        </Group>
        {q.data && ops.length === 0 && (
          <Text size="xs" c="dimmed">
            Pas de plan d'entretien pour ce matériel : saisie libre (réparation, entretien hors plan).
          </Text>
        )}
        {urgent.map(row)}
        {rest.length > 0 && (
          <>
            <Button size="compact-xs" variant="subtle" w="fit-content" leftSection={others ? <ChevronDown size={12} /> : <ChevronRight size={12} />} onClick={() => setOthers((o) => !o)}>
              Autres opérations du plan ({rest.length})
            </Button>
            <Collapse expanded={others}>
              <Stack gap="xs">{rest.map(row)}</Stack>
            </Collapse>
          </>
        )}
      </Stack>
    </Paper>
  );
}

/** Colonne de droite d'un entretien (FR-MAT-56) : relevé, échéances, fluides du matériel. */
export function MaintenanceAside({ farmId, at, equipments, selected }: { farmId: string; at: string; equipments: EquipmentSummary[]; selected: string[] }) {
  if (!selected.length) {
    return (
      <Paper withBorder p="md">
        <Group gap="xs">
          <Wrench size={16} aria-hidden />
          <Text size="sm" c="dimmed">
            Choisissez le matériel entretenu : ses échéances et ses fluides s'affichent ici.
          </Text>
        </Group>
      </Paper>
    );
  }
  return (
    <>
      {selected.map((id) => {
        const e = equipments.find((x) => x.id === id);
        return e ? <AsideCard key={id} farmId={farmId} at={at} equipment={e} /> : null;
      })}
    </>
  );
}

function AsideCard({ farmId, at, equipment: e }: { farmId: string; at: string; equipment: EquipmentSummary }) {
  const q = useMaintenance(farmId, e.id, at);
  const m = q.data;
  const due = (m?.operations ?? []).filter((o) => o.due.status === "overdue" || o.due.status === "soon");
  return (
    <Paper withBorder p="md" aria-label={`Échéances de ${e.name}`}>
      <Title order={4} mb={4}>
        {e.name}
      </Title>
      <Text size="sm" c="dimmed" mb="xs">
        {e.meterUnit ? (e.lastReading ? `Compteur : ${formatHours(e.lastReading.value)} le ${formatDate(e.lastReading.readAt)}` : "Aucun relevé") : "Sans compteur"}
      </Text>
      {due.length === 0 ? (
        <Text size="sm">Aucune échéance en retard ni proche.</Text>
      ) : (
        <Stack gap={4}>
          {due.slice(0, 8).map((o) => (
            <Group key={o.id} gap="xs" wrap="nowrap">
              <DueBadge status={o.due.status} />
              <Text size="sm" lineClamp={1}>
                {o.label}
              </Text>
            </Group>
          ))}
          {due.length > 8 && (
            <Text size="xs" c="dimmed">
              et {due.length - 8} autres
            </Text>
          )}
        </Stack>
      )}
      {m && m.fluids.length > 0 && (
        <Table mt="sm" aria-label={`Fluides de ${e.name}`}>
          <Table.Tbody>
            {m.fluids.slice(0, 6).map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td>
                  <Text size="xs">{f.organ.replace(/_/g, " ")}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{f.fluid}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" className="lv-num">
                    {f.capacity ? `${f.capacity}${/kg/i.test(f.capacity) ? "" : " L"}` : ""}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}

/** Fiche d'intervention : bloc entretien (FR-MAT-57). */
export function MaintenanceSummary({ farmId, intervention: i, names }: { farmId: string; intervention: Intervention; names: Map<string, string> }) {
  const m = i.maintenance;
  if (!m) return null;
  const anomalies = m.operations.filter((o) => o.result === "anomaly");
  return (
    <Paper p="md" withBorder aria-label="Entretien">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Entretien</Title>
        <Badge variant="light" color={m.nature === "preventive" ? "lichen" : "paille"}>
          {m.nature === "preventive" ? "Préventif" : "Curatif"}
        </Badge>
      </Group>
      {m.problem && (
        <Text size="sm" mb="xs" style={{ whiteSpace: "pre-wrap" }}>
          <b>Problème : </b>
          {m.problem}
        </Text>
      )}
      {m.workshop && (
        <Text size="sm" mb="xs">
          <b>Atelier : </b>
          {m.workshop.name}
          {m.workshop.reference ? ` (bon ${m.workshop.reference})` : ""}
        </Text>
      )}
      {i.targets.filter((t) => t.meter).map((t) => (
        <Text key={t.id} size="sm" mb={4}>
          <b>Compteur {names.get(t.id) ?? ""} : </b>
          {formatHours(t.meter!.value)}
          {t.meter!.correction ? ` (correction : ${t.meter!.correctionReason ?? ""})` : ""}
        </Text>
      ))}
      {m.operations.length > 0 && (
        <Table aria-label="Opérations réalisées" mt="xs">
          <Table.Tbody>
            {m.operations.map((o) => (
              <Table.Tr key={o.operationId}>
                <Table.Td>
                  <Text size="sm">{o.label}</Text>
                  {o.note && (
                    <Text size="xs" c="dimmed">
                      {o.note}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{names.get(o.equipmentId) ?? ""}</Table.Td>
                <Table.Td>
                  <Badge size="sm" variant="light" color={o.result === "anomaly" ? "brique" : "lichen"}>
                    {o.result === "anomaly" ? "Anomalie" : o.result === "ok" ? "RAS" : "Réalisée"}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {anomalies.length > 0 && (
        <Alert color="paille" mt="sm" title="Anomalie constatée">
          <Stack gap={4}>
            {anomalies.map((a) => (
              <Group key={a.operationId} justify="space-between">
                <Text size="sm">
                  {a.label}
                  {a.note ? ` : ${a.note}` : ""}
                </Text>
                <Button
                  component={Link}
                  size="compact-xs"
                  variant="light"
                  to={`/f/${farmId}/interventions/new?${new URLSearchParams({
                    procedure: "equipment_maintenance",
                    equipment: a.equipmentId,
                    status: "planned",
                    nature: "corrective",
                    problem: `${a.label}${a.note ? ` : ${a.note}` : ""}`,
                  })}`}
                >
                  Planifier une réparation
                </Button>
              </Group>
            ))}
          </Stack>
        </Alert>
      )}
    </Paper>
  );
}
