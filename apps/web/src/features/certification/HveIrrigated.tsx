import { useState } from "react";
import { Badge, Button, Group, Modal, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HveIrrigatedParcel } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

const Missing = () => (
  <Badge color="paille" variant="light">
    À renseigner
  </Badge>
);

/**
 * Onglet Irrigation du contrôle HVE (lot CT3c) : les 5 données de chaque
 * parcelle irriguée (item 7.1), dont la variété tolérante et les pratiques
 * économes en eau, saisies ici.
 */
export function HveIrrigated({ campaign }: { campaign: number }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const [editing, setEditing] = useState<HveIrrigatedParcel | null>(null);
  const q = useQuery({
    queryKey: ["certifications", "hve-irrigated", farm.id, campaign],
    queryFn: () => api.get<{ items: HveIrrigatedParcel[]; irrigations: number }>(farmPath(farm.id, `/control/hve/irrigated?campaign=${campaign}`)),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const { items, irrigations } = q.data!;
  if (!items.length) return <Text c="dimmed">Aucun apport d'irrigation enregistré pendant la campagne {campaign} : l'indicateur irrigation est sans objet.</Text>;
  return (
    <>
      <Text size="sm" c="dimmed">
        {irrigations} apport(s) d'irrigation. L'origine de l'eau, le facteur déclenchant et le matériel se saisissent sur chaque intervention.
      </Text>
      <Table withTableBorder aria-label="Parcelles irriguées">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Parcelle</Table.Th>
            <Table.Th>Culture</Table.Th>
            <Table.Th>Semis</Table.Th>
            <Table.Th>Variété tolérante</Table.Th>
            <Table.Th>Pratiques économes</Table.Th>
            <Table.Th>Rendement</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.name}</Table.Td>
              <Table.Td>{p.crop ?? <Missing />}</Table.Td>
              <Table.Td>{p.sownOn ? formatDate(p.sownOn) : <Missing />}</Table.Td>
              <Table.Td>{p.droughtTolerant === null ? <Missing /> : p.droughtTolerant ? "Oui" : "Non"}</Table.Td>
              <Table.Td>{p.waterSaving ?? <Missing />}</Table.Td>
              <Table.Td>{p.harvested ? "Enregistré" : <Missing />}</Table.Td>
              <Table.Td>
                {owner && p.productionId && (
                  <Button size="compact-xs" variant="subtle" onClick={() => setEditing(p)} aria-label={`Modifier ${p.name}`}>
                    Modifier
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {editing && <WaterModal parcel={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function WaterModal({ parcel, onClose }: { parcel: HveIrrigatedParcel; onClose: () => void }) {
  const farm = useFarm();
  const client = useQueryClient();
  const [tolerant, setTolerant] = useState(parcel.droughtTolerant === null ? "" : parcel.droughtTolerant ? "yes" : "no");
  const [saving, setSaving] = useState(parcel.waterSaving ?? "");
  const save = useMutation({
    mutationFn: () =>
      api.put(farmPath(farm.id, `/productions/${parcel.productionId}/certification`), {
        droughtTolerant: tolerant === "" ? null : tolerant === "yes",
        waterSaving: saving.trim() || null,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["certifications"] });
      onClose();
    },
  });
  return (
    <Modal opened onClose={onClose} title={`Irrigation : ${parcel.name}`}>
      <Stack>
        <Select
          label="Variété tolérante à la sécheresse"
          description="Variété enregistrée comme tolérante par un institut technique"
          data={[
            { value: "", label: "Non renseigné" },
            { value: "yes", label: "Oui" },
            { value: "no", label: "Non" },
          ]}
          value={tolerant}
          onChange={(v) => setTolerant(v ?? "")}
          allowDeselect={false}
        />
        <TextInput
          label="Autres pratiques économes en eau"
          description="Couverture estivale, non-labour, paillage, densité réduite… ; « aucune » le cas échéant"
          maxLength={200}
          value={saving}
          onChange={(e) => setSaving(e.currentTarget.value)}
        />
        {save.error && <ErrorAlert error={save.error} />}
        <Group>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
