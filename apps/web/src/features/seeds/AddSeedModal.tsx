import { useState } from "react";
import { Alert, Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, UnstyledButton } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import type { SeedCatalogItem, SeedCreate, SeedDetail } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert } from "../../components/states";
import { fmt } from "./labels";
import { seedsKey, useSeedCatalog, useSeedSpecies } from "./queries";

const UNITS = [
  { value: "kilogram", label: "kg" },
  { value: "thousand", label: "Milliers de grains" },
  { value: "dose", label: "Doses" },
];

/**
 * Ajouter une semence (lot SE4, FR-SE-10, 11) : depuis le catalogue officiel
 * des variétés (espèce, variété et code GNIS remplis ; unité et repère de PMG
 * proposés), ou en saisie libre (semence de ferme, mélange, espèce hors
 * catalogue).
 */
export function AddSeedModal({ onClose, onCreated }: { onClose: () => void; onCreated: (articleId: string) => void }) {
  const farm = useFarm();
  const { at } = useAt();
  const client = useQueryClient();
  const [tab, setTab] = useState<string | null>("catalog");
  const [q, setQ] = useState("");
  const [debounced] = useDebouncedValue(q, 400);
  const catalog = useSeedCatalog(farm.id, debounced);
  const species = useSeedSpecies(farm.id, tab === "free");
  const [picked, setPicked] = useState<SeedCatalogItem | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kilogram");
  const [grainsPerDose, setGrainsPerDose] = useState<number | null>(null);
  const [tgwG, setTgwG] = useState<number | null>(null);
  const [freeSpecies, setFreeSpecies] = useState<string | null>(null);
  const [isMixture, setIsMixture] = useState(false);

  const create = useMutation({
    mutationFn: (body: SeedCreate) => api.post<SeedDetail>(farmPath(farm.id, `/seeds?at=${encodeURIComponent(at)}`), body),
    onSuccess: (d) => {
      void client.invalidateQueries({ queryKey: seedsKey(farm.id) });
      notifications.show({ color: "lichen", message: `${d.name} ajoutée.` });
      onCreated(d.articleId);
    },
  });

  const choose = (c: SeedCatalogItem) => {
    setPicked(c);
    setName(c.varietyName);
    setUnit(c.proposedUnit);
    setGrainsPerDose(c.proposedGrainsPerDose);
    setTgwG(null);
  };
  const tgw = tgwG === null ? {} : { tgwG, tgwOrigin: "label" as const };
  const submit = () =>
    picked && tab === "catalog"
      ? create.mutate({
          name: name.trim(),
          unit,
          sheet: { species: picked.species, varietyName: picked.varietyName, gnisCode: picked.gnisCode, category: "certified", isMixture: false, grainsPerDose, bagKg: null, tgwG: null, tgwOrigin: null, tgwOn: null, ...tgw },
        })
      : create.mutate({
          name: name.trim(),
          unit,
          sheet: { species: isMixture ? null : freeSpecies, varietyName: null, gnisCode: null, category: null, isMixture, grainsPerDose, bagKg: null, tgwG: null, tgwOrigin: null, tgwOn: null, ...(isMixture ? {} : tgw) },
        });

  const common = (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <TextInput label="Nom" required value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} />
      <Select label="Unité de stock" data={UNITS} value={unit} onChange={(v) => v && setUnit(v)} allowDeselect={false} />
      {unit === "dose" && (
        <NumberInput label="Grains par dose" thousandSeparator=" " min={1} allowDecimal={false} value={grainsPerDose ?? ""} onChange={(v) => setGrainsPerDose(v === "" ? null : Number(v))} />
      )}
      {!isMixture && (
        <NumberInput
          label="PMG de l'étiquette"
          description="Poids de mille grains, en grammes (facultatif)"
          suffix=" g"
          decimalSeparator=","
          min={0}
          max={1999}
          value={tgwG ?? ""}
          onChange={(v) => setTgwG(v === "" ? null : Number(v))}
        />
      )}
    </SimpleGrid>
  );

  return (
    <Modal opened onClose={onClose} title="Ajouter une semence" size="lg">
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="catalog">Catalogue officiel</Tabs.Tab>
          <Tabs.Tab value="free">Saisie libre</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="catalog" pt="md">
          <Stack>
            {!picked ? (
              <>
                <TextInput
                  data-autofocus
                  label="Variété ou espèce"
                  placeholder="Thermidor, maïs, féverole…"
                  leftSection={<Search size={16} />}
                  value={q}
                  onChange={(e) => setQ(e.currentTarget.value)}
                />
                {catalog.error && <ErrorAlert error={catalog.error} />}
                {debounced.trim().length >= 2 && catalog.isSuccess && !catalog.data.items.length && (
                  <Text size="sm" c="dimmed">
                    Aucune variété trouvée : vérifiez l'orthographe, ou passez par la saisie libre (semence de ferme, mélange).
                  </Text>
                )}
                {!!catalog.data?.items.length && (
                  <Table fz="sm" highlightOnHover aria-label="Variétés du catalogue">
                    <Table.Tbody>
                      {catalog.data.items.map((c) => (
                        <Table.Tr key={c.gnisCode}>
                          <Table.Td>
                            <UnstyledButton onClick={() => choose(c)} aria-label={`Choisir ${c.varietyName} (${c.speciesLabel})`}>
                              <Text size="sm" fw={500}>
                                {c.varietyName}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {c.speciesLabel}
                                {c.legume ? " (légumineuse)" : ""} · {c.gnisCode}
                                {c.registeredOn ? ` · inscrite le ${formatDate(c.registeredOn)}` : ""}
                              </Text>
                            </UnstyledButton>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                <Text size="xs" c="dimmed">
                  Catalogue officiel des variétés : SEMAE (base variétés GNIS), via Lexicon.
                </Text>
              </>
            ) : (
              <>
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>
                      {picked.varietyName} · {picked.speciesLabel}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Code GNIS {picked.gnisCode}
                    </Text>
                  </div>
                  <Button variant="subtle" size="compact-sm" onClick={() => setPicked(null)}>
                    Changer
                  </Button>
                </Group>
                {common}
                {picked.reference && (
                  <Text size="sm">
                    Repère {picked.reference.org} : {fmt(picked.reference.typicalG)} g
                    {picked.reference.minG !== null && picked.reference.maxG !== null ? ` (de ${fmt(picked.reference.minG)} à ${fmt(picked.reference.maxG)} g)` : ""}. Le PMG de l'étiquette est
                    plus juste.
                  </Text>
                )}
              </>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="free" pt="md">
          <Stack>
            <Switch label="Mélange de plusieurs espèces" checked={isMixture} onChange={(e) => setIsMixture(e.currentTarget.checked)} />
            {!isMixture && (
              <Select
                label="Espèce"
                placeholder={species.isLoading ? "Chargement…" : "Choisir l'espèce"}
                data={(species.data?.items ?? []).map((s) => ({ value: s.species, label: s.legume ? `${s.label} (légumineuse)` : s.label }))}
                value={freeSpecies}
                onChange={setFreeSpecies}
                searchable
                clearable
                limit={50}
              />
            )}
            {common}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      {create.error && <ErrorAlert error={create.error} />}
      {(tab === "free" || picked) && (
        <Group mt="md">
          <Button onClick={submit} loading={create.isPending} disabled={!name.trim() || (unit === "dose" && !grainsPerDose)}>
            Ajouter la semence
          </Button>
          {unit === "dose" && !grainsPerDose && (
            <Alert color="paille" p="xs">
              Indiquez le nombre de grains d'une dose.
            </Alert>
          )}
        </Group>
      )}
    </Modal>
  );
}
