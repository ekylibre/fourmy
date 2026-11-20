import { useState } from "react";
import { ActionIcon, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { AbSeedUse, ArticleOrganicWrite, SeedDerogation, SeedDerogationWrite } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

const STATUS = [
  { value: "", label: "Non renseigné" },
  { value: "organic", label: "Biologique" },
  { value: "conversion", label: "En conversion" },
  { value: "conventional", label: "Non biologique" },
];
const TREATED = [
  { value: "", label: "Non renseigné" },
  { value: "no", label: "Non traitée" },
  { value: "yes", label: "Traitée" },
];

/**
 * Onglet Semences du contrôle AB (lot CT5a, R24 et R25) : statut des
 * semences semées sur les parcelles AB, dérogations de la saison (obtenues
 * avant le semis).
 */
export function AbSeeds({ campaign }: { campaign: number }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const client = useQueryClient();
  const uses = useQuery({
    queryKey: ["certifications", "ab-seeds", farm.id, campaign],
    queryFn: () => api.get<{ items: AbSeedUse[] }>(farmPath(farm.id, `/control/ab/seeds?campaign=${campaign}`)),
  });
  const derogations = useQuery({ queryKey: ["certifications", "seed-derogations", farm.id], queryFn: () => api.get<{ items: SeedDerogation[] }>(farmPath(farm.id, "/seed-derogations")) });
  const refresh = () => void client.invalidateQueries({ queryKey: ["certifications"] });
  const onError = (e: unknown) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) });
  const organic = useMutation({ mutationFn: ({ id, w }: { id: string; w: ArticleOrganicWrite }) => api.put(farmPath(farm.id, `/articles/${id}/organic`), w), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(farmPath(farm.id, `/seed-derogations/${id}`)), onSuccess: refresh, onError });

  if (uses.isLoading || derogations.isLoading) return <Loading />;
  if (uses.error || derogations.error) return <ErrorAlert error={uses.error ?? derogations.error} />;
  const items = uses.data!.items;
  return (
    <Stack>
      {items.length === 0 ? (
        <Text c="dimmed">Aucune semence semée sur une parcelle AB pendant la campagne {campaign}.</Text>
      ) : (
        <Table withTableBorder aria-label="Semences des parcelles AB">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Semence ou plant</Table.Th>
              <Table.Th>Parcelles</Table.Th>
              <Table.Th>Statut</Table.Th>
              <Table.Th>Traitement</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((s) => (
              <Table.Tr key={s.articleId}>
                <Table.Td>
                  {s.name}
                  <Text size="xs" c="dimmed">
                    semé le {formatDate(s.firstSownOn)}
                  </Text>
                </Table.Td>
                <Table.Td>{s.parcels.join(", ")}</Table.Td>
                <Table.Td>
                  <Select
                    aria-label={`Statut de ${s.name}`}
                    size="xs"
                    data={STATUS}
                    value={s.organicStatus ?? ""}
                    disabled={!owner}
                    allowDeselect={false}
                    onChange={(v) => organic.mutate({ id: s.articleId, w: { organicStatus: (v || null) as ArticleOrganicWrite["organicStatus"], seedTreated: s.seedTreated } })}
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    aria-label={`Traitement de ${s.name}`}
                    size="xs"
                    data={TREATED}
                    value={s.seedTreated === null ? "" : s.seedTreated ? "yes" : "no"}
                    disabled={!owner}
                    allowDeselect={false}
                    onChange={(v) => organic.mutate({ id: s.articleId, w: { organicStatus: s.organicStatus, seedTreated: v === "" ? null : v === "yes" } })}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Paper withBorder p="md">
        <Title order={4} mb="xs">
          Dérogations
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Autorisation individuelle, pour une saison, obtenue avant le semis (base nationale des semences biologiques consultée).
        </Text>
        {derogations.data!.items.length > 0 && (
          <Table aria-label="Dérogations semences" mb="md">
            <Table.Tbody>
              {derogations.data!.items.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>
                    {d.species}
                    {d.variety ? ` (${d.variety})` : ""}
                  </Table.Td>
                  <Table.Td>saison {d.season}</Table.Td>
                  <Table.Td>obtenue le {formatDate(d.grantedOn)}</Table.Td>
                  <Table.Td>{d.reference ?? ""}</Table.Td>
                  <Table.Td ta="right">
                    {owner && (
                      <ActionIcon variant="subtle" color="brique" aria-label={`Supprimer la dérogation ${d.species}`} onClick={() => remove.mutate(d.id)}>
                        <Trash2 size={16} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {owner && <DerogationForm campaign={campaign} seeds={items} onSaved={refresh} />}
      </Paper>
    </Stack>
  );
}

function DerogationForm({ campaign, seeds, onSaved }: { campaign: number; seeds: AbSeedUse[]; onSaved: () => void }) {
  const farm = useFarm();
  const empty = { species: "", variety: "", articleId: "", grantedOn: "", season: campaign, reference: "" };
  const [w, setW] = useState(empty);
  const add = useMutation({
    mutationFn: (body: SeedDerogationWrite) => api.post(farmPath(farm.id, "/seed-derogations"), body),
    onSuccess: () => {
      setW(empty);
      onSaved();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  return (
    <Stack gap="xs">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput label="Espèce" required value={w.species} onChange={(e) => setW({ ...w, species: e.currentTarget.value })} />
        <TextInput label="Variété" value={w.variety} onChange={(e) => setW({ ...w, variety: e.currentTarget.value })} />
        <Select label="Semence concernée" clearable data={seeds.map((s) => ({ value: s.articleId, label: s.name }))} value={w.articleId || null} onChange={(v) => setW({ ...w, articleId: v ?? "" })} />
        <TextInput type="date" label="Obtenue le" required value={w.grantedOn} onChange={(e) => setW({ ...w, grantedOn: e.currentTarget.value })} />
        <NumberInput label="Saison" min={2000} max={2100} value={w.season} onChange={(v) => setW({ ...w, season: Number(v) || campaign })} />
        <TextInput label="N° d'autorisation" value={w.reference} onChange={(e) => setW({ ...w, reference: e.currentTarget.value })} />
      </SimpleGrid>
      <Group>
        <Button
          size="sm"
          disabled={!w.species.trim() || !w.grantedOn}
          loading={add.isPending}
          onClick={() =>
            add.mutate({
              species: w.species.trim(),
              variety: w.variety.trim() || null,
              articleId: w.articleId || null,
              grantedOn: w.grantedOn,
              season: w.season,
              quantity: null,
              unit: null,
              reference: w.reference.trim() || null,
              certifier: null,
            })
          }
        >
          Ajouter la dérogation
        </Button>
      </Group>
    </Stack>
  );
}
