import { useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, SegmentedControl, Select, Stack, Switch, Table, Text, TextInput, Textarea, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Pencil, Plus } from "lucide-react";
import { dueLabel } from "@fourmy/domain";
import {
  DUE_STATUS_LABELS,
  OPERATION_KIND_LABELS,
  PERFORMER_LABELS,
  type DueStatus,
  type DueView,
  type EquipmentMaintenance,
  type OperationKind,
  type PlanOperation,
} from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { useMaintenance } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { formatHours, toLocalInput } from "../equipments/EquipmentForms";

export const DUE_COLORS: Record<DueStatus, string> = {
  overdue: "brique",
  soon: "paille",
  ok: "lichen",
  unknown: "gray",
  on_demand: "gray",
  done: "lichen",
  not_applicable: "gray",
};

export function DueBadge({ status }: { status: DueStatus }) {
  return (
    <Badge size="sm" color={DUE_COLORS[status]} variant={status === "overdue" || status === "soon" ? "filled" : "light"} styles={{ root: { overflow: "visible" }, label: { overflow: "visible" } }}>
      {DUE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Périodicité lisible : « 500 h ou 12 mois », « à 100 h », « selon besoin ». */
export function periodLabel(op: Pick<PlanOperation, "everyHours" | "everyMonths" | "firstHours">): string {
  const parts: string[] = [];
  if (op.everyHours) parts.push(`${op.everyHours.toLocaleString("fr-FR")} h`);
  if (op.everyMonths) parts.push(`${op.everyMonths} mois`);
  if (parts.length) return `Toutes les ${parts.join(" ou ")}`;
  if (op.firstHours) return `Une fois, à ${op.firstHours.toLocaleString("fr-FR")} h`;
  return "Selon besoin";
}

const sourceLabel = (s: PlanOperation["source"]) => (s ? `${s.id}${s.page !== null && s.page !== undefined ? ` p. ${String(s.page)}` : ""}` : null);

function lastLabel(due: DueView): string {
  if (!due.last) return "—";
  const hours = due.last.usage !== null ? `${formatHours(due.last.usage)}, ` : "";
  const how = due.last.source === "baseline" ? " (connue)" : due.last.source === "commissioning" ? " (mise en service)" : "";
  return `${hours}le ${formatDate(due.last.at)}${how}`;
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-due"] });
    void queryClient.invalidateQueries({ queryKey: ["equipments"] });
  };
}

type Filter = "todo" | "all" | "off";

/** Saisie d'entretien pré-remplie depuis des échéances (FR-MAT-55). */
export const newMaintenance = (farmId: string, equipmentId: string, operations: string[], status: "done" | "planned") =>
  `/f/${farmId}/interventions/new?${new URLSearchParams({ procedure: "equipment_maintenance", equipment: equipmentId, operations: operations.join(","), status })}`;

/**
 * Onglet Entretien de la fiche matériel (FR-MAT-20 à 26) : échéances triées
 * par urgence, à la date de la frise ; « dernière fois connue » pour amorcer
 * une échéance ; plan ajustable par le responsable ; fluides préconisés.
 */
export function MaintenanceTab({ equipmentId, hasMeter }: { equipmentId: string; hasMeter: boolean }) {
  const farm = useFarm();
  const { at } = useAt();
  const q = useMaintenance(farm.id, equipmentId, at);
  const [filter, setFilter] = useState<Filter>("todo");
  const [baseline, setBaseline] = useState<PlanOperation | null>(null);
  const [editing, setEditing] = useState<PlanOperation | "new" | null>(null);
  const [baselineAll, setBaselineAll] = useState(false);
  const owner = farm.role === "owner";
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const m = q.data!;
  const count = (s: DueStatus) => m.operations.filter((o) => o.due.status === s).length;
  const shown = m.operations.filter((o) =>
    filter === "off" ? o.due.status === "not_applicable" : filter === "todo" ? ["overdue", "soon", "unknown"].includes(o.due.status) : o.due.status !== "not_applicable",
  );

  return (
    <Stack>
      {m.model?.warning && <Alert color="paille">{m.model.warning}</Alert>}
      <Group justify="space-between">
        <Group gap="xs">
          {count("overdue") > 0 && <Badge color="brique">{count("overdue")} en retard</Badge>}
          {count("soon") > 0 && <Badge color="paille">{count("soon")} bientôt</Badge>}
          {count("unknown") > 0 && (
            <Tooltip label="Indiquez la dernière réalisation connue (« Dernière fois ») pour calculer l'échéance.">
              <Badge color="gray" variant="light">
                {count("unknown")} à renseigner
              </Badge>
            </Tooltip>
          )}
          {count("unknown") > 0 && (
            <Button size="compact-xs" variant="subtle" onClick={() => setBaselineAll(true)}>
              Amorcer le plan
            </Button>
          )}
          <Text size="sm" c="dimmed">
            {hasMeter ? (m.usageNow !== null ? `Compteur : ${formatHours(m.usageNow)} au ${formatDate(m.at)}` : "Aucun relevé de compteur") : "Sans compteur : échéances en mois"}
            {m.model ? ` · plan ${m.model.label}` : ""}
          </Text>
        </Group>
        <Group>
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            data={[
              { value: "todo", label: "À faire" },
              { value: "all", label: "Tout le plan" },
              { value: "off", label: `Non applicables (${count("not_applicable")})` },
            ]}
          />
          <Button size="xs" variant="default" component={Link} to={`/f/${farm.id}/interventions/new?${new URLSearchParams({ procedure: "equipment_maintenance", equipment: equipmentId, nature: "corrective" })}`}>
            Réparation
          </Button>
          {owner && (
            <Button size="xs" variant="light" leftSection={<Plus size={14} />} onClick={() => setEditing("new")}>
              Opération
            </Button>
          )}
        </Group>
      </Group>
      {m.operations.length === 0 ? (
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            Pas de plan d'entretien. Importez la base matériel (Imports), ou ajoutez des opérations.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder>
          <Table aria-label="Plan d'entretien" verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={120}>État</Table.Th>
                <Table.Th>Opération</Table.Th>
                <Table.Th>Périodicité</Table.Th>
                <Table.Th>Dernière réalisation</Table.Th>
                <Table.Th>Prochaine</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((o) => (
                <Table.Tr key={o.id}>
                  <Table.Td>
                    <DueBadge status={o.due.status} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {o.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[OPERATION_KIND_LABELS[o.kind], o.performer === "workshop" ? PERFORMER_LABELS.workshop : null, sourceLabel(o.source)].filter(Boolean).join(" · ")}
                    </Text>
                    {o.parts.length > 0 && (
                      <Tooltip label={o.parts.map((p) => `${p.reference ?? ""} ${p.name}`).join(" · ")} multiline w={360} disabled={o.parts.length <= 3}>
                        <Text size="xs" c="dimmed">
                          Pièces : {o.parts.slice(0, 3).map((p) => `${p.reference ?? p.name}${p.quantity !== 1 ? ` × ${p.quantity}` : ""}`).join(", ")}
                          {o.parts.length > 3 ? ` et ${o.parts.length - 3} autres` : ""}
                        </Text>
                      </Tooltip>
                    )}
                    {(o.condition || o.archivedReason) && (
                      <Text size="xs" c="dimmed" fs="italic" lineClamp={2}>
                        {o.archivedReason ?? o.condition}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{periodLabel(o)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{lastLabel(o.due)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={o.due.status === "overdue" ? "brique" : o.due.status === "unknown" ? "dimmed" : undefined}>
                      {o.due.status === "unknown" ? "—" : dueLabel(o.due)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      {o.due.status !== "not_applicable" && (
                        <>
                          <Button size="compact-xs" variant="light" component={Link} to={newMaintenance(farm.id, equipmentId, [o.id], "done")} aria-label={`Réaliser : ${o.label}`}>
                            Réaliser
                          </Button>
                          <Button size="compact-xs" variant="subtle" component={Link} to={newMaintenance(farm.id, equipmentId, [o.id], "planned")} aria-label={`Planifier : ${o.label}`}>
                            Planifier
                          </Button>
                        </>
                      )}
                      {o.due.status !== "not_applicable" && o.due.status !== "on_demand" && (
                        <Button size="compact-xs" variant="subtle" leftSection={<CalendarCheck size={12} />} onClick={() => setBaseline(o)} aria-label={`Dernière fois : ${o.label}`}>
                          Dernière fois
                        </Button>
                      )}
                      {owner && (
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setEditing(o)} aria-label={`Modifier : ${o.label}`}>
                          <Pencil size={12} />
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {shown.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text size="sm" c="dimmed" ta="center" py="sm">
                      Rien à faire pour l'instant.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      <Fluids fluids={m.fluids} />
      {baseline && <BaselineModal farmId={farm.id} op={baseline} hasMeter={hasMeter} onClose={() => setBaseline(null)} />}
      {baselineAll && <BaselineModal farmId={farm.id} equipmentId={equipmentId} count={count("unknown")} hasMeter={hasMeter} onClose={() => setBaselineAll(false)} />}
      {editing && <OperationModal farmId={farm.id} equipmentId={equipmentId} op={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function Fluids({ fluids }: { fluids: EquipmentMaintenance["fluids"] }) {
  if (!fluids.length) return null;
  return (
    <Paper withBorder p="md">
      <Title order={4} mb="xs">
        Fluides préconisés
      </Title>
      <Table aria-label="Fluides préconisés">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Organe</Table.Th>
            <Table.Th>Produit</Table.Th>
            <Table.Th>Norme</Table.Th>
            <Table.Th>Capacité</Table.Th>
            <Table.Th>Source</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {fluids.map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td>{f.organ.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Table.Td>
              <Table.Td>
                {f.fluid}
                {f.viscosity && (
                  <Text span size="xs" c="dimmed">
                    {" "}
                    {f.viscosity}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="xs">{f.standard ?? "—"}</Text>
              </Table.Td>
              <Table.Td>
                {f.capacity ? `${f.capacity}${/kg/i.test(f.capacity) ? "" : " L"}` : "—"}
                {f.note && (
                  <Text size="xs" c="dimmed">
                    {f.note}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed">
                  {sourceLabel(f.source) ?? ""}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

/**
 * « Dernière fois connue » : date (et heures) de la dernière réalisation, sans
 * intervention. Pour une opération, ou pour toutes celles à renseigner
 * (« Amorcer le plan » : révision complète à l'achat, par exemple).
 */
function BaselineModal({ farmId, op, equipmentId, count, hasMeter, onClose }: { farmId: string; op?: PlanOperation; equipmentId?: string; count?: number; hasMeter: boolean; onClose: () => void }) {
  const refresh = useRefresh();
  const [day, setDay] = useState(op?.baselineAt ? toLocalInput(op.baselineAt).slice(0, 10) : "");
  const [hours, setHours] = useState<number | string>(op?.baselineHours ?? "");
  const save = useMutation({
    mutationFn: (clear: boolean) => {
      const body = clear ? { at: null, hours: null } : { at: new Date(`${day}T12:00:00`).toISOString(), hours: hours === "" ? null : Number(hours) };
      return op ? api.put(farmPath(farmId, `/plan-operations/${op.id}/baseline`), body) : api.post(farmPath(farmId, `/equipments/${equipmentId}/plan/baseline`), body);
    },
    onSuccess: () => {
      notifications.show({ color: "lichen", message: op ? "Dernière réalisation enregistrée." : "Plan amorcé." });
      refresh();
      onClose();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  return (
    <Modal opened onClose={onClose} title={op ? `Dernière fois : ${op.label}` : "Amorcer le plan d'entretien"}>
      <Stack>
        <Text size="sm" c="dimmed">
          {op
            ? "Sans intervention enregistrée dans Fourmy, indiquez quand l'opération a été faite pour la dernière fois. Une intervention plus récente l'emportera."
            : `Les ${count} opérations à renseigner partiront de cette date (par exemple une révision complète à l'achat). Vous pourrez ajuster chacune ensuite.`}
        </Text>
        <TextInput type="date" label="Date" value={day} onChange={(e) => setDay(e.currentTarget.value)} required />
        {hasMeter && <NumberInput label="Heures au compteur" value={hours} onChange={setHours} min={0} thousandSeparator=" " suffix=" h" description="Facultatif : sans heures, seule la périodicité en mois s'applique." />}
        <Group justify="space-between">
          {op?.baselineAt ? (
            <Button variant="subtle" color="brique" onClick={() => save.mutate(true)}>
              Effacer
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={() => save.mutate(false)} loading={save.isPending} disabled={!day}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Ajout ou modification d'une opération du plan (responsable). */
function OperationModal({ farmId, equipmentId, op, onClose }: { farmId: string; equipmentId: string; op: PlanOperation | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [label, setLabel] = useState(op?.label ?? "");
  const [kind, setKind] = useState<OperationKind>(op?.kind ?? "inspection");
  const [everyHours, setEveryHours] = useState<number | string>(op?.everyHours ?? "");
  const [everyMonths, setEveryMonths] = useState<number | string>(op?.everyMonths ?? "");
  const [firstHours, setFirstHours] = useState<number | string>(op?.firstHours ?? "");
  const [performer, setPerformer] = useState<"member" | "workshop">(op?.performer ?? "member");
  const [condition, setCondition] = useState(op?.condition ?? "");
  const [archived, setArchived] = useState(!!op?.archivedAt);
  const n = (v: number | string) => (v === "" ? null : Number(v));
  const save = useMutation({
    mutationFn: () => {
      const body = { label, kind, everyHours: n(everyHours), everyMonths: n(everyMonths), firstHours: n(firstHours), performer, condition: condition || null, archived };
      return op ? api.put(farmPath(farmId, `/plan-operations/${op.id}`), body) : api.post(farmPath(farmId, `/equipments/${equipmentId}/plan`), body);
    },
    onSuccess: () => {
      notifications.show({ color: "lichen", message: op ? "Opération modifiée." : "Opération ajoutée." });
      refresh();
      onClose();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  return (
    <Modal opened onClose={onClose} title={op ? "Modifier l'opération" : "Nouvelle opération"}>
      <Stack>
        {op?.fromModel && (
          <Text size="xs" c="dimmed">
            Copiée du modèle : la modifier n'affecte que ce matériel.
          </Text>
        )}
        <TextInput label="Libellé" value={label} onChange={(e) => setLabel(e.currentTarget.value)} required />
        <Group grow>
          <Select label="Type" data={Object.entries(OPERATION_KIND_LABELS).map(([value, l]) => ({ value, label: l }))} value={kind} onChange={(v) => v && setKind(v as OperationKind)} allowDeselect={false} />
          <Select
            label="Réalisée par"
            data={Object.entries(PERFORMER_LABELS).map(([value, l]) => ({ value, label: l }))}
            value={performer}
            onChange={(v) => v && setPerformer(v as "member" | "workshop")}
            allowDeselect={false}
          />
        </Group>
        <Group grow>
          <NumberInput label="Toutes les (heures)" value={everyHours} onChange={setEveryHours} min={1} suffix=" h" />
          <NumberInput label="ou tous les (mois)" value={everyMonths} onChange={setEveryMonths} min={1} />
        </Group>
        <NumberInput label="Une seule fois, à (heures)" description="Visite initiale ou opération ponctuelle." value={firstHours} onChange={setFirstHours} min={1} suffix=" h" />
        <Textarea label="Condition, remarque" autosize value={condition} onChange={(e) => setCondition(e.currentTarget.value)} />
        {op && <Switch label="Retirée du plan" checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />}
        <Group justify="flex-end">
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!label.trim()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Onglet Pièces : référentiel des pièces d'entretien du matériel (FR-MAT-40, 41). */
export function PartsTab({ equipmentId }: { equipmentId: string }) {
  const farm = useFarm();
  const { at } = useAt();
  const q = useMaintenance(farm.id, equipmentId, at);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const parts = q.data!.parts;
  if (!parts.length) {
    return (
      <Text size="sm" c="dimmed">
        Aucune pièce référencée. L'import de la base matériel les ajoute.
      </Text>
    );
  }
  return (
    <Paper withBorder>
      <Table aria-label="Pièces d'entretien" verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Famille</Table.Th>
            <Table.Th>Référence</Table.Th>
            <Table.Th>Désignation</Table.Th>
            <Table.Th>Qté</Table.Th>
            <Table.Th>Catalogue</Table.Th>
            <Table.Th>Opérations</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {parts.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>
                <Text size="sm">{p.family?.replace(/_/g, " ") ?? "—"}</Text>
              </Table.Td>
              <Table.Td className="lv-num" style={{ whiteSpace: "nowrap" }}>
                {p.reference ?? "—"}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{p.name}</Text>
                {p.note && (
                  <Text size="xs" c="dimmed">
                    {p.note}
                  </Text>
                )}
              </Table.Td>
              <Table.Td className="lv-num">{p.quantity ?? ""}</Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed">
                  {[p.catalog?.plate, p.catalog?.item ? `rep. ${p.catalog.item}` : null].filter(Boolean).join(" · ")}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" lineClamp={2}>
                  {p.operations.join(" ; ") || "—"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
