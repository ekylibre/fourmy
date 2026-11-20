import { useState } from "react";
import { Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CROP_CYCLE_LABELS, CULTIVATION_MODE_LABELS, type ProductionCertificationWrite } from "@fourmy/contracts";
import type { AbParcelStatus, ConversionStatus } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

const STATUS: Record<ConversionStatus, { label: string; color: string; title: string }> = {
  C1: { label: "C1", color: "brique", title: "1re année de conversion : récolte vendue en conventionnel" },
  C2: { label: "C2", color: "paille", title: "En conversion : récolte vendable « en conversion vers l'AB »" },
  AB: { label: "AB", color: "lichen", title: "Agriculture biologique" },
};

function StatusBadge({ status }: { status: ConversionStatus }) {
  return (
    <Badge color={STATUS[status].color} variant="light" title={STATUS[status].title} aria-label={STATUS[status].title}>
      {STATUS[status].label}
    </Badge>
  );
}

type Production = AbParcelStatus["productions"][number];

/**
 * Onglet Parcelles du contrôle AB (lot CT2) : statut de conversion déduit de
 * chaque parcelle et de chaque récolte (D8 : jamais saisi), avec ce qui le
 * fixe (début, redémarrage, cycle, semis).
 */
export function AbParcels({ campaign }: { campaign: number }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const [editing, setEditing] = useState<Production | null>(null);
  const q = useQuery({
    queryKey: ["certifications", "ab-parcels", farm.id, campaign],
    queryFn: () => api.get<{ items: AbParcelStatus[] }>(farmPath(farm.id, `/control/ab/parcels?campaign=${campaign}`)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const items = q.data!.items;
  if (!items.length) return <Text c="dimmed">Aucune parcelle en conversion ou certifiée AB pendant la campagne {campaign}.</Text>;
  return (
    <>
      <Table withTableBorder aria-label="Statut de conversion des parcelles">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Parcelle</Table.Th>
            <Table.Th>Conversion</Table.Th>
            <Table.Th>Récoltes</Table.Th>
            <Table.Th>Statut</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((p) => (
            <Table.Tr key={p.parcelId}>
              <Table.Td>
                <Text fw={600}>{p.name}</Text>
                <Text size="xs" c="dimmed">
                  {(p.areaM2 / 10_000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ha · déclarée {p.declaredLevel === "certified" ? "certifiée" : "en conversion"}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">depuis le {formatDate(p.startedOn)}</Text>
                {p.resetBy && (
                  <Text size="xs" c="brique">
                    Redémarrée le {formatDate(p.conversionStart)} : {p.resetBy.product}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Stack gap={4}>
                  {p.productions.length === 0 && (
                    <Text size="xs" c="dimmed">
                      Aucune production saisie
                    </Text>
                  )}
                  {p.productions.map((x) => (
                    <Group key={x.id} gap="xs" wrap="nowrap">
                      <StatusBadge status={x.status} />
                      <Text size="sm">
                        {x.label}{" "}
                        <Text span size="xs" c="dimmed">
                          ({CROP_CYCLE_LABELS[x.cycle].split(" (")[0]!.toLowerCase()}, {x.sownOn ? `semée ou plantée le ${formatDate(x.sownOn)}, ` : ""}récolte le {formatDate(x.harvestOn)})
                        </Text>
                      </Text>
                      {owner && (
                        <Button size="compact-xs" variant="subtle" onClick={() => setEditing(x)} aria-label={`Modifier ${x.label}`}>
                          Modifier
                        </Button>
                      )}
                    </Group>
                  ))}
                </Stack>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={p.status} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {editing && <ProductionModal production={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Cycle, date de plantation, mode de culture : ce qui fixe la durée de conversion. */
function ProductionModal({ production, onClose }: { production: Production; onClose: () => void }) {
  const farm = useFarm();
  const client = useQueryClient();
  const [cycle, setCycle] = useState<string>(production.cycle);
  const [plantedOn, setPlantedOn] = useState(production.sownOn ?? "");
  const [mode, setMode] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (w: ProductionCertificationWrite) => api.put(farmPath(farm.id, `/productions/${production.id}/certification`), w),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["certifications"] });
      onClose();
    },
  });
  return (
    <Modal opened onClose={onClose} title={production.label}>
      <Stack>
        <Select
          label="Cycle de la culture"
          description="Conversion : 2 ans avant le semis d'une annuelle ou d'une prairie, 3 ans avant la récolte d'une pérenne"
          data={Object.entries(CROP_CYCLE_LABELS).map(([value, label]) => ({ value, label }))}
          value={cycle}
          onChange={(v) => v && setCycle(v)}
          allowDeselect={false}
        />
        <TextInput type="date" label="Semis ou plantation" value={plantedOn} onChange={(e) => setPlantedOn(e.currentTarget.value)} />
        <Select
          label="Mode de culture"
          placeholder="Inchangé"
          data={Object.entries(CULTIVATION_MODE_LABELS).map(([value, label]) => ({ value, label }))}
          value={mode}
          onChange={setMode}
          clearable
        />
        {save.error && <ErrorAlert error={save.error} />}
        <Group>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                cycle: cycle as ProductionCertificationWrite["cycle"],
                plantedOn: plantedOn || null,
                ...(mode ? { cultivationMode: mode as NonNullable<ProductionCertificationWrite["cultivationMode"]> } : {}),
              })
            }
          >
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
