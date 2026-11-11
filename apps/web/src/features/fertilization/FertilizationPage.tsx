import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Alert, Anchor, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import {
  NITRATE_ZONE_LABELS,
  WATER_ORIGIN_LABELS,
  rshTotal,
  type ParcelFertilizationContext,
  type WaterOrigin,
  type WaterSource,
  type WaterSourceWrite,
} from "@fourmy/contracts";
import { NA_SOIL_TYPE_LABELS, isNaSoilType } from "@fourmy/fertilization-refs";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { useWaterSources, ZONE_COLOR } from "./SoilTab";

const ha = (m2: number) => (m2 / 10_000).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Fertilisation azotée de la ferme (lot AF ; le plan de fumure et le cahier
 * viennent ensuite) : zonage nitrates de chaque parcelle, sol, dernier
 * reliquat, points d'eau d'irrigation.
 */
export function FertilizationPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const { day } = useAt();
  const location = useLocation();
  const client = useQueryClient();
  const parcels = useQuery({
    queryKey: ["fertilization-parcels", farm.id, day],
    queryFn: () => api.get<{ items: ParcelFertilizationContext[] }>(farmPath(farm.id, `/fertilization/parcels?at=${day}`)),
  });
  const refresh = useMutation({
    mutationFn: () => api.post<{ updated: number; failed: string[] }>(farmPath(farm.id, "/fertilization/zones/refresh"), {}),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ["fertilization-parcels", farm.id] });
      notifications.show({
        color: r.failed.length ? "paille" : "lichen",
        message: `Zonage de ${r.updated} parcelle${r.updated > 1 ? "s" : ""} mis à jour${r.failed.length ? ` ; commune introuvable pour ${r.failed.join(", ")}` : ""}.`,
      });
    },
  });
  if (parcels.isLoading) return <Loading />;
  if (parcels.error) return <ErrorAlert error={parcels.error} />;
  const items = parcels.data!.items;
  const inZone = items.filter((p) => p.zone?.status === "in" || p.zone?.status === "partial");
  const areaInZone = inZone.reduce((s, p) => s + p.areaM2, 0);
  const noSoil = inZone.filter((p) => !p.soil.soilType).length;
  const unknownZone = items.filter((p) => !p.zone || p.zone.status === "unknown").length;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={1}>Fertilisation azotée</Title>
          <Text size="sm" c="dimmed">
            Directive nitrates : zonage, sol et analyses des parcelles. Le plan prévisionnel de fumure et le cahier d'enregistrement s'appuient sur ces
            données.
          </Text>
        </div>
        {owner && (
          <Button leftSection={<RefreshCw size={16} />} variant="light" onClick={() => refresh.mutate()} loading={refresh.isPending}>
            Actualiser le zonage
          </Button>
        )}
      </Group>

      {items.length > 0 && (
        <Alert color={inZone.length ? "brique" : "lichen"} aria-label="Obligations">
          {inZone.length
            ? `${inZone.length} parcelle${inZone.length > 1 ? "s" : ""} en zone vulnérable (${ha(areaInZone)} ha) : plan prévisionnel de fumure et cahier d'enregistrement obligatoires pour chacune, fertilisée ou non, conservés 5 campagnes.${areaInZone > 30_000 ? " Au-delà de 3 ha, une analyse de sol par campagne." : ""}`
            : unknownZone
              ? "Zonage à déterminer : actualisez-le."
              : "Aucune parcelle en zone vulnérable : plan de fumure et cahier conseillés, non obligatoires."}
          {noSoil > 0 && ` ${noSoil} parcelle${noSoil > 1 ? "s" : ""} en zone vulnérable sans type de sol.`}
        </Alert>
      )}

      <Paper withBorder>
        <Table aria-label="Parcelles et zonage" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Parcelle</Table.Th>
              <Table.Th>Surface</Table.Th>
              <Table.Th>Zonage</Table.Th>
              <Table.Th>Sol</Table.Th>
              <Table.Th>Dernier reliquat</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((p) => {
              const rsh = p.analyses.find((a) => a.kind === "rsh" && a.horizons?.length);
              return (
                <Table.Tr key={p.parcelId}>
                  <Table.Td>
                    <Anchor component={Link} to={`/f/${farm.id}/land-parcels/${p.parcelId}${location.search}${location.search ? "&" : "?"}tab=soil`}>
                      {p.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td className="lv-num">{ha(p.areaM2)} ha</Table.Td>
                  <Table.Td>
                    {p.zone ? (
                      <Badge variant="light" color={ZONE_COLOR[p.zone.status]} title={p.zone.commune ?? undefined}>
                        {NITRATE_ZONE_LABELS[p.zone.status]}
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {p.soil.soilType && isNaSoilType(p.soil.soilType) ? (
                      NA_SOIL_TYPE_LABELS[p.soil.soilType].split(" (")[0]
                    ) : (
                      <Text size="xs" c="dimmed">
                        à renseigner
                      </Text>
                    )}
                    {p.soil.irrigated && (
                      <Text span size="xs" c="dimmed">
                        {" "}
                        · irriguée
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="lv-num">{rsh ? `${rshTotal(rsh.horizons!)} kg N/ha (${formatDate(rsh.sampledOn)})` : "—"}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Paper>
      <Text size="xs" c="dimmed">
        Zonage d'après la commune de chaque parcelle (API Géo de l'État) et l'arrêté du préfet coordonnateur de bassin Adour-Garonne du 24/08/2026.
        Une commune classée en partie est à confirmer parcelle par parcelle.
      </Text>

      <WaterSources farmId={farm.id} owner={owner} />
    </Stack>
  );
}

function WaterSources({ farmId, owner }: { farmId: string; owner: boolean }) {
  const q = useWaterSources(farmId);
  const [editing, setEditing] = useState<WaterSource | "new" | null>(null);
  return (
    <Paper withBorder p="md" aria-label="Points d'eau d'irrigation">
      <Group justify="space-between" mb="xs">
        <div>
          <Title order={4}>Points d'eau d'irrigation</Title>
          <Text size="sm" c="dimmed">
            Les nitrates de l'eau d'irrigation comptent dans le bilan. Sans mesure, le référentiel régional retient 25 mg/L pour une eau de surface et 40
            mg/L pour une eau souterraine.
          </Text>
        </div>
        {owner && (
          <Button size="compact-sm" variant="light" leftSection={<Plus size={14} />} onClick={() => setEditing("new")}>
            Ajouter
          </Button>
        )}
      </Group>
      {q.isLoading ? (
        <Loading />
      ) : q.data!.items.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun point d'eau.
        </Text>
      ) : (
        <Table fz="sm">
          <Table.Tbody>
            {q.data!.items.map((w) => (
              <Table.Tr key={w.id}>
                <Table.Td>{w.name}</Table.Td>
                <Table.Td>{WATER_ORIGIN_LABELS[w.origin]}</Table.Td>
                <Table.Td className="lv-num">
                  {w.nitrateMgL !== null ? `${w.nitrateMgL.toLocaleString("fr-FR")} mg/L (${w.method === "strip" ? "bandelette" : "analyse"}, ${formatDate(w.measuredOn)})` : "teneur de référence"}
                </Table.Td>
                <Table.Td className="lv-num">
                  {w.parcels} parcelle{w.parcels > 1 ? "s" : ""}
                </Table.Td>
                {owner && (
                  <Table.Td>
                    <Button size="compact-xs" variant="subtle" onClick={() => setEditing(w)}>
                      Modifier
                    </Button>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {editing && <WaterModal farmId={farmId} source={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Paper>
  );
}

function WaterModal({ farmId, source, onClose }: { farmId: string; source: WaterSource | null; onClose: () => void }) {
  const client = useQueryClient();
  const [w, setW] = useState<WaterSourceWrite>(
    source ? { name: source.name, origin: source.origin, nitrateMgL: source.nitrateMgL, measuredOn: source.measuredOn, method: source.method } : { name: "", origin: "groundwater", nitrateMgL: null, measuredOn: null, method: null },
  );
  const done = () => {
    void client.invalidateQueries({ queryKey: ["water-sources", farmId] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => (source ? api.put(farmPath(farmId, `/water-sources/${source.id}`), w) : api.post(farmPath(farmId, "/water-sources"), w)),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.delete(farmPath(farmId, `/water-sources/${source!.id}`)), onSuccess: done });
  return (
    <Modal opened onClose={onClose} title={source ? source.name : "Nouveau point d'eau"}>
      <Stack>
        <TextInput label="Nom" placeholder="Forage du Braquet, retenue collinaire…" value={w.name} onChange={(e) => setW({ ...w, name: e.currentTarget.value })} required maxLength={100} />
        <Select
          label="Origine de l'eau"
          data={Object.entries(WATER_ORIGIN_LABELS).map(([value, label]) => ({ value, label }))}
          value={w.origin}
          allowDeselect={false}
          onChange={(v) => setW({ ...w, origin: (v ?? "groundwater") as WaterOrigin })}
        />
        <SimpleGrid cols={2}>
          <NumberInput
            label="Nitrates mesurés"
            suffix=" mg/L"
            decimalSeparator=","
            min={0}
            max={500}
            value={w.nitrateMgL ?? ""}
            onChange={(v) => setW({ ...w, nitrateMgL: v === "" ? null : Number(v), method: v === "" ? null : (w.method ?? "lab") })}
          />
          <TextInput label="Mesurés le" type="date" value={w.measuredOn ?? ""} onChange={(e) => setW({ ...w, measuredOn: e.currentTarget.value || null })} />
        </SimpleGrid>
        {w.nitrateMgL !== null && (
          <Select
            label="Méthode"
            data={[
              { value: "lab", label: "Analyse de laboratoire" },
              { value: "strip", label: "Bandelette, pendant la période d'irrigation" },
            ]}
            value={w.method}
            onChange={(v) => setW({ ...w, method: (v as WaterSourceWrite["method"]) ?? null })}
          />
        )}
        {(save.error || remove.error) && <ErrorAlert error={save.error ?? remove.error} />}
        <Group>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!w.name.trim()}>
            Enregistrer
          </Button>
          {source && (
            <Button variant="subtle" color="brique" onClick={() => remove.mutate()} loading={remove.isPending}>
              Supprimer
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
