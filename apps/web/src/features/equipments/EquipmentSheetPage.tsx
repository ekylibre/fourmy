import { useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { ActionIcon, Alert, Badge, Button, ColorInput, FileButton, Grid, Group, Paper, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Gauge, ImageUp, Pencil, Plus, Trash2 } from "lucide-react";
import { METER_ORIGIN_LABELS, equipmentKindLabel, equipmentStateLabel, type EquipmentSheet, type FarmBrand, type MeterReading } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate, formatDateTime, procedureLabel } from "../../app/labels";
import { useEquipmentSheet } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { ProcedureIcon } from "../../components/ProcedureIcon";
import { EquipmentLogo, uploadLogo } from "./EquipmentLogo";
import { EquipmentFormModal, formatHours, ReadingModal } from "./EquipmentForms";

const TABS = ["general", "technical", "readings", "history"] as const;
type Tab = (typeof TABS)[number];

/**
 * Fiche d'un matériel (FR-MAT-71), en onglets comme la fiche parcelle :
 * Général (identité, logo, agrégats, options, traceurs), Technique (valeurs
 * sourcées), Relevés (échelle d'usage, corrections), Historique.
 * L'onglet est dans l'adresse (`?tab=`).
 */
export function EquipmentSheetPage() {
  const { equipmentId } = useParams();
  const farm = useFarm();
  const q = useEquipmentSheet(farm.id, equipmentId!);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  return <Sheet sheet={q.data!} />;
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["equipments"] });
    void queryClient.invalidateQueries({ queryKey: ["equipment-sheet"] });
    void queryClient.invalidateQueries({ queryKey: ["brands"] });
  };
}

function Sheet({ sheet: s }: { sheet: EquipmentSheet }) {
  const farm = useFarm();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "general";
  const owner = farm.role === "owner";
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const back = new URLSearchParams(location.search);
  back.delete("tab");

  return (
    <Stack>
      <Button component={Link} to={`/f/${farm.id}/equipments${back.size ? `?${back}` : ""}`} variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={14} />} w="fit-content">
        Matériels
      </Button>
      <Group justify="space-between" align="flex-start">
        <Group gap="md" wrap="nowrap">
          <EquipmentLogo farmId={farm.id} assetId={s.logoAssetId} kind={s.kind} size={56} />
          <Stack gap={4}>
            <Title order={1}>{s.name}</Title>
            <Group gap="xs">
              <Badge variant="light">{equipmentKindLabel(s.kind)}</Badge>
              <Badge variant="light" color={!s.state || s.state === "active" ? "lichen" : "gray"}>
                {equipmentStateLabel(s.state)}
              </Badge>
              {s.lastReading && (
                <Text size="sm" className="lv-num">
                  {formatHours(s.lastReading.value)} le {formatDate(s.lastReading.readAt)}
                </Text>
              )}
            </Group>
          </Stack>
        </Group>
        <Group>
          {s.meterUnit && (
            <Button variant="light" leftSection={<Gauge size={16} />} onClick={() => setReading(true)}>
              Relevé
            </Button>
          )}
          {owner && (
            <Button variant="default" leftSection={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Modifier
            </Button>
          )}
        </Group>
      </Group>

      <Tabs
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(params);
          if (v && v !== "general") next.set("tab", v);
          else next.delete("tab");
          setParams(next, { replace: true });
        }}
        keepMounted={false}
      >
        <Tabs.List>
          <Tabs.Tab value="general">Général</Tabs.Tab>
          <Tabs.Tab value="technical">Technique</Tabs.Tab>
          <Tabs.Tab value="readings">Relevés ({s.readings.length})</Tabs.Tab>
          <Tabs.Tab value="history">Historique ({s.history.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general" pt="md">
          <General sheet={s} />
        </Tabs.Panel>
        <Tabs.Panel value="technical" pt="md">
          <Technical technical={s.technical} />
        </Tabs.Panel>
        <Tabs.Panel value="readings" pt="md">
          <Readings sheet={s} />
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <History sheet={s} />
        </Tabs.Panel>
      </Tabs>
      {editing && <EquipmentFormModal farmId={farm.id} sheet={s} onClose={() => setEditing(false)} />}
      {reading && <ReadingModal farmId={farm.id} equipment={s} onClose={() => setReading(false)} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Général
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Table.Tr>
      <Table.Th w={180} fw={500} c="dimmed">
        {label}
      </Table.Th>
      <Table.Td>{children ?? "—"}</Table.Td>
    </Table.Tr>
  );
}

function General({ sheet: s }: { sheet: EquipmentSheet }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Stack>
          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              Identité
            </Title>
            <Table aria-label="Identité">
              <Table.Tbody>
                <Row label="Marque">{s.brand}</Row>
                <Row label="Modèle">{s.model}</Row>
                <Row label="N° de série">{s.serialNumber}</Row>
                <Row label="Type constructeur">{s.manufacturerType}</Row>
                <Row label="Année">{s.year}</Row>
                <Row label="Mise en service">{s.commissionedAt ? formatDate(s.commissionedAt) : null}</Row>
                <Row label="Compteur">{s.meterUnit ? "Heures moteur" : "Sans compteur"}</Row>
                {Object.entries(s.externalIds).map(([k, v]) => (
                  <Row key={k} label={`Identifiant ${k === "traccar" ? "Traccar" : k}`}>
                    {v}
                  </Row>
                ))}
              </Table.Tbody>
            </Table>
            {s.notes && (
              <Text size="sm" mt="sm" style={{ whiteSpace: "pre-wrap" }}>
                {s.notes}
              </Text>
            )}
          </Paper>
          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              Agrégats
            </Title>
            {s.aggregates.length === 0 ? (
              <Text size="sm" c="dimmed">
                Aucun agrégat renseigné.
              </Text>
            ) : (
              <Table aria-label="Agrégats">
                <Table.Tbody>
                  {s.aggregates.map((a, i) => (
                    <Table.Tr key={i}>
                      <Table.Td fw={500}>{a.organ}</Table.Td>
                      <Table.Td>{a.designation ?? "—"}</Table.Td>
                      <Table.Td className="lv-num">{a.serial ?? ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
          <Options sheet={s} />
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Stack>
          <LogoPanel sheet={s} owner={owner} />
          {s.brandInfo && <BrandPanel brand={s.brandInfo} owner={owner} />}
          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              Traceurs GPS
            </Title>
            {s.trackers.length === 0 ? (
              <Text size="sm" c="dimmed">
                Aucun boîtier rattaché.
              </Text>
            ) : (
              s.trackers.map((t, i) => (
                <Text key={i} size="sm">
                  Boîtier {t.deviceId} : depuis le {formatDate(t.from)}
                  {t.to ? ` jusqu'au ${formatDate(t.to)}` : ""}
                </Text>
              ))
            )}
          </Paper>
        </Stack>
      </Grid.Col>
    </Grid>
  );
}

function LogoPanel({ sheet: s, owner }: { sheet: EquipmentSheet; owner: boolean }) {
  const farm = useFarm();
  const refresh = useRefresh();
  const send = useMutation({
    mutationFn: (file: File | null) =>
      file ? uploadLogo(farmPath(farm.id, `/equipments/${s.id}/logo`), file) : api.delete(farmPath(farm.id, `/equipments/${s.id}/logo`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Logo enregistré." });
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof Error ? e.message : String(e) }),
  });
  return (
    <Paper withBorder p="md">
      <Title order={4} mb="xs">
        Logo
      </Title>
      <Group align="center">
        <EquipmentLogo farmId={farm.id} assetId={s.logoAssetId} kind={s.kind} size={72} />
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            {s.logoSource === "equipment" ? "Logo propre à ce matériel." : s.logoSource === "brand" ? `Logo de la marque ${s.brand}.` : "Aucun logo : pictogramme de la nature."}
          </Text>
          {owner && (
            <Group gap="xs">
              <FileButton accept="image/png,image/jpeg,image/svg+xml" onChange={(f) => f && send.mutate(f)}>
                {(props) => (
                  <Button {...props} size="compact-sm" variant="light" leftSection={<ImageUp size={14} />} loading={send.isPending}>
                    Choisir une image
                  </Button>
                )}
              </FileButton>
              {s.logoSource === "equipment" && (
                <Button size="compact-sm" variant="subtle" color="brique" onClick={() => send.mutate(null)}>
                  Retirer
                </Button>
              )}
            </Group>
          )}
          <Text size="xs" c="dimmed">
            PNG, JPEG ou SVG, 1 Mo au plus. Servira aussi à l'avatar 3D.
          </Text>
        </Stack>
      </Group>
    </Paper>
  );
}

function BrandPanel({ brand, owner }: { brand: FarmBrand; owner: boolean }) {
  const farm = useFarm();
  const refresh = useRefresh();
  const [color, setColor] = useState(brand.color ?? "");
  const logo = useMutation({
    mutationFn: (file: File) => uploadLogo(farmPath(farm.id, `/brands/${brand.id}/logo`), file),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: `Logo de ${brand.name} enregistré.` });
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof Error ? e.message : String(e) }),
  });
  const save = useMutation({
    mutationFn: () => api.put(farmPath(farm.id, `/brands/${brand.id}`), { name: brand.name, color: color || null }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Couleur de la marque enregistrée." });
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  return (
    <Paper withBorder p="md">
      <Title order={4} mb={4}>
        Marque {brand.name}
      </Title>
      <Text size="xs" c="dimmed" mb="xs">
        Partagée par {brand.equipments} matériel(s) de la ferme.
      </Text>
      <Group align="flex-end">
        <EquipmentLogo farmId={farm.id} assetId={brand.logoAssetId} kind="" size={40} />
        {owner ? (
          <>
            <FileButton accept="image/png,image/jpeg,image/svg+xml" onChange={(f) => f && logo.mutate(f)}>
              {(props) => (
                <Button {...props} size="compact-sm" variant="light" leftSection={<ImageUp size={14} />} loading={logo.isPending}>
                  Logo de la marque
                </Button>
              )}
            </FileButton>
            <ColorInput label="Couleur" value={color} onChange={setColor} w={140} size="xs" format="hex" />
            <Button size="compact-sm" variant="default" onClick={() => save.mutate()} loading={save.isPending} disabled={(brand.color ?? "") === color}>
              Enregistrer
            </Button>
          </>
        ) : (
          brand.color && <Badge color={brand.color}>{brand.color}</Badge>
        )}
      </Group>
    </Paper>
  );
}

function Options({ sheet: s }: { sheet: EquipmentSheet }) {
  const farm = useFarm();
  const refresh = useRefresh();
  const owner = farm.role === "owner";
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const code = label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const add = useMutation({
    mutationFn: () => api.post(farmPath(farm.id, `/equipments/${s.id}/options`), { code, label: label.trim(), from: new Date(`${from}T00:00:00`).toISOString() }),
    onSuccess: () => {
      setLabel("");
      setFrom("");
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/equipment-options/${id}`)),
    onSuccess: refresh,
  });
  return (
    <Paper withBorder p="md">
      <Title order={4} mb="xs">
        Options montées
      </Title>
      {s.options.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucune option renseignée.
        </Text>
      )}
      {s.options.map((o) => (
        <Group key={o.id} justify="space-between">
          <Text size="sm">
            {o.label}{" "}
            <Text span size="xs" c="dimmed">
              depuis le {formatDate(o.from)}
              {o.to ? ` jusqu'au ${formatDate(o.to)}` : ""}
            </Text>
          </Text>
          {owner && (
            <ActionIcon variant="subtle" color="brique" aria-label={`Retirer ${o.label}`} onClick={() => remove.mutate(o.id)}>
              <Trash2 size={14} />
            </ActionIcon>
          )}
        </Group>
      ))}
      {owner && (
        <Group mt="sm" align="flex-end" gap="xs">
          <TextInput size="xs" label="Option" placeholder="Relevage avant" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
          <TextInput size="xs" type="date" label="Montée le" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
          <Button size="xs" variant="light" leftSection={<Plus size={14} />} disabled={!code || !from} loading={add.isPending} onClick={() => add.mutate()}>
            Ajouter
          </Button>
        </Group>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Technique : valeurs sourcées (format fiche_technique.json)
// ---------------------------------------------------------------------------

type Sourced = { valeur?: unknown; unite?: string | null; source?: { id?: string; page?: unknown } | null; alternatives?: { valeur?: unknown; unite?: string | null; note?: string | null }[]; note?: string | null };
const human = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const show = (v: unknown, unit?: string | null) => (v === null || v === undefined || v === "" ? "—" : `${typeof v === "number" ? v.toLocaleString("fr-FR") : String(v)}${unit ? ` ${unit}` : ""}`);

function Technical({ technical }: { technical: unknown }) {
  if (!technical || typeof technical !== "object") {
    return (
      <Text size="sm" c="dimmed">
        Pas de fiche technique. Elle sera remplie par l'import de la base matériel.
      </Text>
    );
  }
  const t = technical as Record<string, unknown>;
  const groups = Object.entries(t).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)) as [string, Record<string, unknown>][];
  return (
    <Stack>
      {typeof t.avertissement === "string" && <Alert color="paille">{t.avertissement}</Alert>}
      <Grid>
        {groups.map(([group, fields]) => (
          <Grid.Col key={group} span={{ base: 12, md: 6 }}>
            <Paper withBorder p="md">
              <Title order={4} mb="xs">
                {human(group)}
              </Title>
              <Table aria-label={human(group)}>
                <Table.Tbody>
                  {Object.entries(fields).map(([k, raw]) => {
                    const f: Sourced = raw && typeof raw === "object" && "valeur" in (raw as object) ? (raw as Sourced) : { valeur: Array.isArray(raw) ? raw.join(", ") : raw };
                    return (
                      <Table.Tr key={k}>
                        <Table.Th w="40%" fw={500} c="dimmed">
                          {human(k)}
                        </Table.Th>
                        <Table.Td>
                          <Text size="sm">{show(f.valeur, f.unite)}</Text>
                          {(f.alternatives ?? []).map((a, i) => (
                            <Text key={i} size="xs" c="dimmed">
                              ou {show(a.valeur, a.unite)}
                              {a.note ? ` (${a.note})` : ""}
                            </Text>
                          ))}
                          {f.note && (
                            <Text size="xs" c="dimmed">
                              {f.note}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td w={110}>
                          {f.source?.id && (
                            <Tooltip label="Source">
                              <Text size="xs" c="dimmed">
                                {f.source.id}
                                {f.source.page !== undefined && f.source.page !== null ? ` p. ${String(f.source.page)}` : ""}
                              </Text>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Paper>
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Relevés
// ---------------------------------------------------------------------------

/** Courbe des heures d'usage (relevés valides), en SVG. */
function UsageChart({ readings }: { readings: MeterReading[] }) {
  const pts = readings.filter((r) => r.status === "valid");
  if (pts.length < 2) return null;
  const W = 1200;
  const H = 180;
  const PAD = 70;
  const t0 = Date.parse(pts[0]!.readAt);
  const t1 = Date.parse(pts[pts.length - 1]!.readAt);
  const u0 = pts[0]!.usage;
  const u1 = pts[pts.length - 1]!.usage;
  const x = (r: MeterReading) => PAD + ((Date.parse(r.readAt) - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = (r: MeterReading) => H - 24 - ((r.usage - u0) / Math.max(1, u1 - u0)) * (H - 48);
  const first = pts[0]!;
  const lastPt = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Heures d'usage de ${formatHours(u0)} à ${formatHours(u1)}`}>
      <polyline points={pts.map((r) => `${x(r)},${y(r)}`).join(" ")} fill="none" stroke="var(--mantine-color-lichen-6)" strokeWidth={2} />
      <text x={x(first) - 8} y={y(first) + 4} textAnchor="end" fontSize={13} fill="currentColor">
        {formatHours(first.value)}
      </text>
      <text x={x(first)} y={H - 4} textAnchor="middle" fontSize={12} fill="var(--mantine-color-dimmed)">
        {formatDate(first.readAt)}
      </text>
      <text x={x(lastPt) + 8} y={y(lastPt) + 4} fontSize={13} fill="currentColor">
        {formatHours(lastPt.value)}
      </text>
      <text x={x(lastPt)} y={H - 4} textAnchor="middle" fontSize={12} fill="var(--mantine-color-dimmed)">
        {formatDate(lastPt.readAt)}
      </text>
      {pts.map((r) => (
        <circle key={r.id} cx={x(r)} cy={y(r)} r={3.5} fill={r.correction ? "var(--mantine-color-paille-6)" : "var(--mantine-color-lichen-7)"}>
          <title>{`${formatHours(r.value)} le ${formatDate(r.readAt)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Readings({ sheet: s }: { sheet: EquipmentSheet }) {
  const farm = useFarm();
  const refresh = useRefresh();
  const owner = farm.role === "owner";
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/meter-readings/${id}`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Relevé supprimé." });
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  if (!s.meterUnit) {
    return (
      <Text size="sm" c="dimmed">
        Ce matériel n'a pas de compteur.
      </Text>
    );
  }
  const list = [...s.readings].reverse();
  const replaced = s.readings.some((r) => r.correction === "replacement");
  return (
    <Stack>
      <Paper withBorder p="md">
        <UsageChart readings={s.readings} />
        {replaced && (
          <Text size="xs" c="dimmed">
            Compteur remplacé : la courbe suit les heures d'usage cumulées, les valeurs lues restent celles du compteur.
          </Text>
        )}
      </Paper>
      <Paper withBorder>
        <Table aria-label="Relevés" verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Compteur</Table.Th>
              <Table.Th>Origine</Table.Th>
              <Table.Th>Saisi par</Table.Th>
              <Table.Th>Note</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((r) => (
              <Table.Tr key={r.id} style={{ opacity: r.status === "superseded" ? 0.5 : 1 }}>
                <Table.Td>{formatDateTime(r.readAt)}</Table.Td>
                <Table.Td className="lv-num" fw={500} td={r.status === "superseded" ? "line-through" : undefined}>
                  {formatHours(r.value)}
                  {r.usage !== r.value && r.status === "valid" && (
                    <Text span size="xs" c="dimmed">
                      {" "}
                      ({formatHours(r.usage)} d'usage)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <Badge size="sm" variant="light" color="gray">
                      {METER_ORIGIN_LABELS[r.origin]}
                    </Badge>
                    {r.correction && (
                      <Tooltip label={r.correctionReason ?? ""}>
                        <Badge size="sm" variant="light" color="paille">
                          {r.correction === "fix" ? "Correction" : "Compteur remplacé"}
                        </Badge>
                      </Tooltip>
                    )}
                    {r.status === "superseded" && (
                      <Badge size="sm" variant="outline" color="gray">
                        Écarté
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{r.authorName ?? "—"}</Table.Td>
                <Table.Td>
                  <Text size="sm">{r.note ?? ""}</Text>
                  {r.interventionId && (
                    <Link to={`/f/${farm.id}/interventions/${r.interventionId}`} style={{ fontSize: 12 }}>
                      Voir l'intervention
                    </Link>
                  )}
                </Table.Td>
                <Table.Td>
                  {owner && (r.origin === "manual" || r.origin === "reference") && (
                    <ActionIcon variant="subtle" color="brique" aria-label={`Supprimer le relevé du ${formatDateTime(r.readAt)}`} onClick={() => remove.mutate(r.id)}>
                      <Trash2 size={14} />
                    </ActionIcon>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {list.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Aucun relevé. Saisissez les heures du compteur avec le bouton « Relevé ».
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

const STATUS: Record<string, string> = { done: "Réalisée", planned: "Planifiée" };

function History({ sheet: s }: { sheet: EquipmentSheet }) {
  const farm = useFarm();
  const location = useLocation();
  const keep = new URLSearchParams(location.search);
  keep.delete("tab");
  const suffix = keep.size ? `?${keep}` : "";
  if (s.history.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Aucune intervention avec ce matériel.
      </Text>
    );
  }
  return (
    <Paper withBorder>
      <Table aria-label="Historique" verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Intervention</Table.Th>
            <Table.Th>Rôle</Table.Th>
            <Table.Th>Parcelles</Table.Th>
            <Table.Th>État</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {s.history.map((h) => (
            <Table.Tr key={h.interventionId}>
              <Table.Td>{h.startedAt ? formatDate(h.startedAt) : "—"}</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <ProcedureIcon procedure={h.procedure} size={16} />
                  <Link to={`/f/${farm.id}/interventions/${h.interventionId}${suffix}`}>{procedureLabel(h.procedure)}</Link>
                </Group>
              </Table.Td>
              <Table.Td>
                <Badge size="sm" variant="light" color={h.role === "target" ? "paille" : "gray"}>
                  {h.role === "target" ? "Entretenu" : "Utilisé"}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm" lineClamp={1}>
                  {h.parcels.join(", ") || "—"}
                </Text>
              </Table.Td>
              <Table.Td>{STATUS[h.status] ?? h.status}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
