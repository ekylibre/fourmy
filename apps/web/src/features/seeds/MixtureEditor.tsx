import { useState } from "react";
import { ActionIcon, Badge, Button, Group, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { MixtureComponentWrite, MixtureComponentsSave, SeedDetail } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { ErrorAlert } from "../../components/states";
import { seedsKey, useSeedSpecies } from "./queries";

type Row = MixtureComponentWrite;
const blank = (): Row => ({ species: null, label: "", varietyName: null, gnisCode: null });

/** « 1 légumineuse sur 4 espèces » (FR-SE-14). */
export function legumeShare(legumes: number, total: number): string {
  return `${legumes} légumineuse${legumes > 1 ? "s" : ""} sur ${total} espèce${total > 1 ? "s" : ""}`;
}

/**
 * Espèces d'un mélange (lot SE6, FR-SE-13, 14) : espèce du référentiel ou
 * libellé libre, variété si connue. Pas de proportion : la dose de chaque
 * espèce se saisit au semis. Les légumineuses sont repérées.
 */
export function MixtureEditor({ detail, owner }: { detail: SeedDetail; owner: boolean }) {
  const farm = useFarm();
  const { at } = useAt();
  const client = useQueryClient();
  const species = useSeedSpecies(farm.id, true);
  const [rows, setRows] = useState<Row[]>(
    detail.components.length ? detail.components.map((c) => ({ species: c.species, label: c.label, varietyName: c.varietyName, gnisCode: c.gnisCode })) : [blank(), blank()],
  );
  const save = useMutation({
    mutationFn: (body: MixtureComponentsSave) => api.put<SeedDetail>(farmPath(farm.id, `/articles/${detail.articleId}/seed/components?at=${encodeURIComponent(at)}`), body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: seedsKey(farm.id) });
      notifications.show({ color: "lichen", message: `Espèces de ${detail.name} enregistrées.` });
    },
  });
  const options = (species.data?.items ?? []).map((s) => ({ value: s.species, label: s.legume ? `${s.label} (légumineuse)` : s.label }));
  const option = (s: string | null) => species.data?.items.find((x) => x.species === s);
  const legume = (r: Row) => !!option(r.species)?.legume;
  const filled = rows.filter((r) => r.label.trim());
  const labels = filled.map((r) => r.label.trim().toLowerCase());
  const duplicate = new Set(labels).size !== labels.length;
  const update = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!owner) {
    if (!detail.components.length) return <Text size="sm" c="dimmed">Espèces du mélange non décrites.</Text>;
    return (
      <Stack gap={4}>
        <Text size="sm">
          Espèces du mélange : {detail.components.map((c) => (c.legume ? `${c.label} (légumineuse)` : c.label)).join(", ")}.
        </Text>
        <Text size="xs" c="dimmed">
          {legumeShare(detail.components.filter((c) => c.legume).length, detail.components.length)}
        </Text>
      </Stack>
    );
  }
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        Pas de proportions : la dose de chaque espèce se saisit au semis, en kg/ha.
      </Text>
      <Table fz="sm" aria-label="Espèces du mélange">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Espèce</Table.Th>
            <Table.Th>Libellé</Table.Th>
            <Table.Th>Variété</Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <Select
                    aria-label={`Espèce ${i + 1}`}
                    placeholder={species.isLoading ? "Chargement…" : "Référentiel"}
                    data={options}
                    value={r.species}
                    onChange={(v) => update(i, { species: v, ...(v && !r.label.trim() ? { label: option(v)?.label ?? "" } : {}) })}
                    searchable
                    clearable
                    limit={50}
                    size="xs"
                    style={{ flex: 1 }}
                  />
                  {legume(r) && (
                    <Badge size="xs" variant="light" color="lichen" style={{ flexShrink: 0 }}>
                      Légumineuse
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <TextInput aria-label={`Libellé ${i + 1}`} size="xs" value={r.label} maxLength={120} onChange={(e) => update(i, { label: e.currentTarget.value })} />
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`Variété ${i + 1}`}
                  size="xs"
                  value={r.varietyName ?? ""}
                  maxLength={120}
                  onChange={(e) => update(i, { varietyName: e.currentTarget.value || null })}
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon variant="subtle" color="brique" aria-label={`Retirer l'espèce ${i + 1}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="space-between">
        <Button size="compact-sm" variant="subtle" leftSection={<Plus size={14} />} onClick={() => setRows((l) => [...l, blank()])} disabled={rows.length >= 20}>
          Ajouter une espèce
        </Button>
        {filled.length > 0 && (
          <Text size="xs" c="dimmed">
            {legumeShare(filled.filter(legume).length, filled.length)}
          </Text>
        )}
      </Group>
      {duplicate && <Text size="xs" c="brique">Une espèce est en double.</Text>}
      {save.error && <ErrorAlert error={save.error} />}
      <Group>
        <Button
          size="xs"
          variant="light"
          disabled={duplicate || !detail.sheet?.isMixture}
          loading={save.isPending}
          onClick={() => save.mutate({ components: filled.map((r) => ({ ...r, label: r.label.trim() })) })}
        >
          Enregistrer les espèces
        </Button>
        {!detail.sheet?.isMixture && (
          <Text size="xs" c="dimmed">
            Enregistrez d'abord la fiche comme mélange.
          </Text>
        )}
      </Group>
    </Stack>
  );
}
