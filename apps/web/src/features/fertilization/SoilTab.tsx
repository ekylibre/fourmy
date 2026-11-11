import { useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  NITRATE_ZONE_LABELS,
  SOIL_ANALYSIS_KIND_LABELS,
  rshTotal,
  type NitrateZoneStatus,
  type ParcelFertilizationContext,
  type SoilAnalysisKind,
  type SoilAnalysisWrite,
  type SoilHorizon,
  type WaterSource,
} from "@fourmy/contracts";
import { NA_SOIL_TYPE_LABELS, NA_SOIL_TYPES } from "@fourmy/fertilization-refs";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

export const ZONE_COLOR: Record<NitrateZoneStatus, string> = { in: "brique", partial: "paille", out: "lichen", unknown: "gray" };
const SOIL_OPTIONS = NA_SOIL_TYPES.map((value) => ({ value, label: NA_SOIL_TYPE_LABELS[value] }));

export function useParcelFertilization(farmId: string, parcelId: string) {
  return useQuery({
    queryKey: ["fertilization-parcel", farmId, parcelId],
    queryFn: () => api.get<ParcelFertilizationContext>(farmPath(farmId, `/land-parcels/${parcelId}/fertilization`)),
  });
}

export function useWaterSources(farmId: string) {
  return useQuery({ queryKey: ["water-sources", farmId], queryFn: () => api.get<{ items: WaterSource[] }>(farmPath(farmId, "/water-sources")) });
}

/**
 * Onglet « Sol » de la fiche parcelle (lot AF, FR-FERT-1, 31, 32) : zonage
 * nitrates, type de sol du référentiel régional, profondeur, point d'eau
 * d'irrigation, analyses (reliquats, terre).
 */
export function SoilTab({ farmId, parcelId, owner }: { farmId: string; parcelId: string; owner: boolean }) {
  const client = useQueryClient();
  const q = useParcelFertilization(farmId, parcelId);
  const waters = useWaterSources(farmId);
  const [adding, setAdding] = useState(false);
  const refresh = (c: ParcelFertilizationContext) => {
    client.setQueryData(["fertilization-parcel", farmId, parcelId], c);
    void client.invalidateQueries({ queryKey: ["fertilization-parcels", farmId] });
  };
  const profile = useMutation({
    mutationFn: (w: { soilType: string | null; rootingDepthCm: number | null; waterSourceId: string | null }) =>
      api.put<ParcelFertilizationContext>(farmPath(farmId, `/land-parcels/${parcelId}/soil-profile`), w),
    onSuccess: (c) => {
      refresh(c);
      notifications.show({ color: "lichen", message: "Sol de la parcelle enregistré." });
    },
  });
  const zone = useMutation({
    mutationFn: (status: NitrateZoneStatus) => api.put<ParcelFertilizationContext>(farmPath(farmId, `/land-parcels/${parcelId}/nitrate-zone`), { status, note: null }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<ParcelFertilizationContext>(farmPath(farmId, `/land-parcels/${parcelId}/soil-analyses/${id}`)),
    onSuccess: (c) => c && refresh(c),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const c = q.data!;
  const s = c.soil;
  const save = (patch: Partial<{ soilType: string | null; rootingDepthCm: number | null; waterSourceId: string | null }>) =>
    profile.mutate({ soilType: s.soilType, rootingDepthCm: s.rootingDepthCm, waterSourceId: s.waterSourceId, ...patch });

  return (
    <Stack>
      <Paper withBorder p="md" aria-label="Zonage nitrates">
        <Group justify="space-between">
          <Title order={4}>Zonage nitrates</Title>
          {c.zone ? (
            <Badge color={ZONE_COLOR[c.zone.status]} variant="light">
              {NITRATE_ZONE_LABELS[c.zone.status]}
            </Badge>
          ) : (
            <Badge color="gray" variant="light">
              Non déterminé
            </Badge>
          )}
        </Group>
        {c.zone ? (
          <Text size="sm" c="dimmed" mt={4}>
            {c.zone.commune ? `Commune : ${c.zone.commune} (${c.zone.insee}). ` : ""}
            {c.zone.confirmedAt ? `Confirmé le ${formatDate(c.zone.confirmedAt)}. ` : `D'après ${c.zone.referential}. `}
            {c.zone.zones.length ? `Calendrier d'épandage : zone ${c.zone.zones.join(", ")}. ` : ""}
            {c.zone.note ?? ""}
            {c.zone.status === "in" || c.zone.status === "partial"
              ? " En zone vulnérable : plan prévisionnel de fumure et cahier d'enregistrement obligatoires pour cette parcelle, fertilisée ou non."
              : ""}
          </Text>
        ) : (
          <Text size="sm" c="dimmed" mt={4}>
            Le zonage se calcule pour toute la ferme depuis Réglementaire → Fertilisation azotée.
          </Text>
        )}
        {owner && c.zone?.status === "partial" && (
          <Group mt="xs" gap="xs">
            <Text size="sm">Cette parcelle est-elle dans la partie classée ?</Text>
            <Button size="compact-sm" variant="light" onClick={() => zone.mutate("in")} loading={zone.isPending}>
              Oui
            </Button>
            <Button size="compact-sm" variant="light" onClick={() => zone.mutate("out")} loading={zone.isPending}>
              Non
            </Button>
          </Group>
        )}
      </Paper>

      <Paper withBorder p="md" aria-label="Sol de la parcelle">
        <Title order={4} mb="xs">
          Sol
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Type de sol (référentiel Nouvelle-Aquitaine)"
            placeholder="À choisir"
            data={SOIL_OPTIONS}
            value={s.soilType}
            clearable
            disabled={!owner}
            onChange={(v) => save({ soilType: v })}
          />
          <NumberInput
            label="Profondeur d'enracinement"
            suffix=" cm"
            min={10}
            max={300}
            step={10}
            disabled={!owner}
            value={s.rootingDepthCm ?? ""}
            onBlur={(e) => {
              const v = e.currentTarget.value.replace(/\D/g, "");
              const n = v ? Number(v) : null;
              if (n !== s.rootingDepthCm) save({ rootingDepthCm: n });
            }}
          />
          <Select
            label="Point d'eau d'irrigation"
            placeholder={s.irrigated ? "À choisir" : "Parcelle en sec"}
            data={(waters.data?.items ?? []).map((w) => ({ value: w.id, label: w.name }))}
            value={s.waterSourceId}
            clearable
            disabled={!owner}
            onChange={(v) => save({ waterSourceId: v })}
          />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="xs">
          Réserve utile {s.tawMm ?? "par défaut"}
          {s.tawMm ? " mm" : ""} · {s.irrigated ? "irriguée" : "en sec"} (modifiables dans l'onglet Végétation). Le type de sol donne les valeurs du
          référentiel régional : azote restant à la récolte, minéralisation de l'humus, reliquat estimé.
        </Text>
        {profile.error && <ErrorAlert error={profile.error} />}
      </Paper>

      <Paper withBorder p="md" aria-label="Analyses de sol">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Analyses</Title>
          {owner && (
            <Button size="compact-sm" variant="light" leftSection={<Plus size={14} />} onClick={() => setAdding(true)}>
              Ajouter une analyse
            </Button>
          )}
        </Group>
        {c.analyses.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucune analyse. Un reliquat sortie d'hiver mesuré remplace l'estimation du référentiel ; en zone vulnérable, une analyse par campagne est
            obligatoire au-delà de 3 ha (sur l'une des trois principales cultures).
          </Text>
        ) : (
          <Table fz="sm">
            <Table.Tbody>
              {c.analyses.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td className="lv-num">{formatDate(a.sampledOn)}</Table.Td>
                  <Table.Td>{SOIL_ANALYSIS_KIND_LABELS[a.kind]}</Table.Td>
                  <Table.Td className="lv-num">
                    {a.horizons?.length
                      ? `${rshTotal(a.horizons)} kg N/ha sur ${a.horizons[a.horizons.length - 1]!.toCm} cm`
                      : [
                          a.values?.organicMatterPct != null ? `MO ${a.values.organicMatterPct} %` : null,
                          a.values?.clayGKg != null ? `argile ${a.values.clayGKg} g/kg` : null,
                          a.values?.caco3GKg != null ? `CaCO3 ${a.values.caco3GKg} g/kg` : null,
                          a.values?.ph != null ? `pH ${a.values.ph}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </Table.Td>
                  <Table.Td>{a.lab ?? ""}</Table.Td>
                  {owner && (
                    <Table.Td>
                      <ActionIcon variant="subtle" color="brique" aria-label="Retirer l'analyse" onClick={() => remove.mutate(a.id)}>
                        <Trash2 size={14} />
                      </ActionIcon>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
      {adding && <AnalysisModal farmId={farmId} parcelId={parcelId} onClose={() => setAdding(false)} onSaved={refresh} />}
    </Stack>
  );
}

const DEFAULT_HORIZONS: SoilHorizon[] = [
  { fromCm: 0, toCm: 30, no3KgHa: 0, nh4KgHa: null },
  { fromCm: 30, toCm: 60, no3KgHa: 0, nh4KgHa: null },
  { fromCm: 60, toCm: 90, no3KgHa: 0, nh4KgHa: null },
];
const opt = (v: string | number) => (v === "" ? null : Number(v));

function AnalysisModal({ farmId, parcelId, onClose, onSaved }: { farmId: string; parcelId: string; onClose: () => void; onSaved: (c: ParcelFertilizationContext) => void }) {
  const [w, setW] = useState<SoilAnalysisWrite>({ sampledOn: new Date().toISOString().slice(0, 10), kind: "rsh", horizons: DEFAULT_HORIZONS, values: null, lab: null });
  const save = useMutation({
    mutationFn: () =>
      api.post<ParcelFertilizationContext>(farmPath(farmId, `/land-parcels/${parcelId}/soil-analyses`), {
        ...w,
        horizons: w.kind === "soil" ? null : w.horizons,
        values: w.kind === "soil" ? w.values : null,
      }),
    onSuccess: (c) => {
      onSaved(c);
      onClose();
    },
  });
  const horizons = w.horizons ?? DEFAULT_HORIZONS;
  const setH = (k: number, patch: Partial<SoilHorizon>) => setW({ ...w, horizons: horizons.map((h, j) => (j === k ? { ...h, ...patch } : h)) });
  const v = w.values ?? { organicMatterPct: null, nTotalGKg: null, clayGKg: null, caco3GKg: null, ph: null, cecMeq: null, stonesPct: null };
  return (
    <Modal opened onClose={onClose} title="Analyse de sol" size="lg">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Nature"
            data={Object.entries(SOIL_ANALYSIS_KIND_LABELS).map(([value, label]) => ({ value, label }))}
            value={w.kind}
            allowDeselect={false}
            onChange={(k) => setW({ ...w, kind: (k ?? "rsh") as SoilAnalysisKind })}
          />
          <TextInput label="Prélevé le" type="date" value={w.sampledOn} onChange={(e) => setW({ ...w, sampledOn: e.currentTarget.value })} />
          <TextInput label="Laboratoire" value={w.lab ?? ""} onChange={(e) => setW({ ...w, lab: e.currentTarget.value || null })} />
        </SimpleGrid>
        {w.kind !== "soil" ? (
          <>
            <Table aria-label="Horizons">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Horizon</Table.Th>
                  <Table.Th>N nitrique (kg N/ha)</Table.Th>
                  <Table.Th>N ammoniacal (kg N/ha)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {horizons.map((h, k) => (
                  <Table.Tr key={k}>
                    <Table.Td className="lv-num">
                      {h.fromCm}–{h.toCm} cm
                    </Table.Td>
                    <Table.Td>
                      <NumberInput aria-label={`Nitrates ${h.fromCm}-${h.toCm} cm`} size="xs" min={0} decimalSeparator="," value={h.no3KgHa} onChange={(x) => setH(k, { no3KgHa: Number(x) || 0 })} />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput aria-label={`Ammonium ${h.fromCm}-${h.toCm} cm`} size="xs" min={0} decimalSeparator="," value={h.nh4KgHa ?? ""} onChange={(x) => setH(k, { nh4KgHa: opt(x) })} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Group justify="space-between">
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle" onClick={() => setW({ ...w, horizons: horizons.slice(0, -1) })} disabled={horizons.length <= 1}>
                  Retirer un horizon
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => {
                    const last = horizons[horizons.length - 1]!;
                    setW({ ...w, horizons: [...horizons, { fromCm: last.toCm, toCm: last.toCm + 30, no3KgHa: 0, nh4KgHa: null }] });
                  }}
                  disabled={horizons.length >= 6}
                >
                  Ajouter un horizon
                </Button>
              </Group>
              <Text size="sm" className="lv-num" aria-label="Reliquat total">
                Reliquat : <b>{rshTotal(horizons)} kg N/ha</b>
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              Nitrates sur toute la profondeur, ammonium sur 0–40 cm seulement (COMIFER 2013).
            </Text>
          </>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3 }}>
            <NumberInput label="Matière organique (%)" decimalSeparator="," min={0} value={v.organicMatterPct ?? ""} onChange={(x) => setW({ ...w, values: { ...v, organicMatterPct: opt(x) } })} />
            <NumberInput label="Azote total (g/kg)" decimalSeparator="," min={0} value={v.nTotalGKg ?? ""} onChange={(x) => setW({ ...w, values: { ...v, nTotalGKg: opt(x) } })} />
            <NumberInput label="Argile (g/kg)" min={0} value={v.clayGKg ?? ""} onChange={(x) => setW({ ...w, values: { ...v, clayGKg: opt(x) } })} />
            <NumberInput label="Calcaire total (g/kg)" min={0} value={v.caco3GKg ?? ""} onChange={(x) => setW({ ...w, values: { ...v, caco3GKg: opt(x) } })} />
            <NumberInput label="pH eau" decimalSeparator="," min={3} max={10} value={v.ph ?? ""} onChange={(x) => setW({ ...w, values: { ...v, ph: opt(x) } })} />
            <NumberInput label="CEC (méq/100 g)" decimalSeparator="," min={0} value={v.cecMeq ?? ""} onChange={(x) => setW({ ...w, values: { ...v, cecMeq: opt(x) } })} />
          </SimpleGrid>
        )}
        {save.error && <ErrorAlert error={save.error} />}
        {w.kind === "rsh" && rshTotal(horizons) === 0 && <Alert color="paille">Reliquat nul : vérifiez les valeurs saisies.</Alert>}
        <Group>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
