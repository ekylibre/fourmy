import { useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import {
  COMPOSITION_ORIGIN_LABELS,
  FERTILIZER_BASIS_LABELS,
  NITRATE_TYPE_LABELS,
  type CompositionOrigin,
  type FertilizerArticle,
  type FertilizerComposition,
  type FertilizerWrite,
  type NitrateType,
  type ProductAnalysisWrite,
} from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { compositionLabel } from "./fertilization";

const ORIGIN_COLOR: Record<CompositionOrigin, string> = { proposed: "paille", migrated: "ardoise", confirmed: "lichen", analysis: "lichen" };

/**
 * Fertilisants de la ferme (lot AE, FR-FERT-5 à 7) : composition (N, P2O5,
 * K2O, densité, type nitrates), son origine, et analyses des produits
 * organiques. L'azote apporté par une intervention en découle.
 */
export function FertilizersPage() {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const list = useQuery({ queryKey: ["fertilizers", farm.id], queryFn: () => api.get<{ items: FertilizerArticle[] }>(farmPath(farm.id, "/fertilizers")) });
  const [editing, setEditing] = useState<FertilizerArticle | null>(null);
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;
  const items = list.data!.items;
  const toComplete = items.filter((f) => !f.composition && f.usage > 0).length;

  return (
    <Stack>
      <div>
        <Title order={1}>Fertilisants</Title>
        <Text size="sm" c="dimmed">
          Composition des engrais et amendements : elle donne l'azote apporté par chaque intervention, pour le plan de fumure et le cahier d'enregistrement.
          Une teneur proposée par Fourmy (d'après le nom ou le code Lexicon) est à confirmer.
        </Text>
      </div>
      {toComplete > 0 && (
        <Alert color="paille">
          {toComplete} fertilisant{toComplete > 1 ? "s" : ""} déjà utilisé{toComplete > 1 ? "s" : ""} sans composition enregistrée : l'azote de leurs apports est
          estimé ou inconnu.
        </Alert>
      )}
      <Paper withBorder>
        <Table aria-label="Fertilisants" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Produit</Table.Th>
              <Table.Th>Composition</Table.Th>
              <Table.Th>Origine</Table.Th>
              <Table.Th>Utilisé</Table.Th>
              {owner && <Table.Th />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((f) => {
              const c = f.composition ?? f.proposal;
              return (
                <Table.Tr key={f.id}>
                  <Table.Td>{f.name}</Table.Td>
                  <Table.Td className="lv-num">
                    {c ? (
                      <>
                        {compositionLabel(c)}
                        {c.density ? ` · d ${c.density.toLocaleString("fr-FR")}` : ""}
                        {c.nitrateType ? (
                          <Text span size="xs" c="dimmed">
                            {" "}
                            · type {c.nitrateType}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <Text span size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {f.composition && f.origin ? (
                      <Badge variant="light" color={ORIGIN_COLOR[f.origin]} title={f.source ?? undefined}>
                        {COMPOSITION_ORIGIN_LABELS[f.origin]}
                      </Badge>
                    ) : f.proposal ? (
                      <Badge variant="light" color="paille" title={f.proposal.source}>
                        Proposée
                      </Badge>
                    ) : (
                      <Badge variant="light" color="brique">
                        À compléter
                      </Badge>
                    )}
                    {f.analyses.length > 0 && (
                      <Text span size="xs" c="dimmed">
                        {" "}
                        · analyse du {formatDate(f.analyses[0]!.sampledOn)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td className="lv-num">{f.usage ? `${f.usage} intervention${f.usage > 1 ? "s" : ""}` : "—"}</Table.Td>
                  {owner && (
                    <Table.Td>
                      <Button size="compact-sm" variant="light" onClick={() => setEditing(f)}>
                        {f.composition ? "Modifier" : f.proposal ? "Vérifier" : "Compléter"}
                      </Button>
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Paper>
      {editing && <FertilizerModal farmId={farm.id} article={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

const EMPTY: FertilizerComposition = { basis: "mass_percent", nTotal: 0, nMineralShare: 1, p2o5: null, k2o: null, so3: null, density: null, nitrateType: "III", foliar: false };
const optNum = (v: string | number) => (v === "" ? null : Number(v));

function FertilizerModal({ farmId, article, onClose }: { farmId: string; article: FertilizerArticle; onClose: () => void }) {
  const client = useQueryClient();
  const start = article.composition ?? article.proposal ?? EMPTY;
  const [c, setC] = useState<FertilizerComposition>(start);
  const [source, setSource] = useState<string>(article.composition ? (article.source ?? "") : (article.proposal?.source ?? ""));
  const refresh = () => client.invalidateQueries({ queryKey: ["fertilizers", farmId] });
  const save = useMutation({
    mutationFn: (w: FertilizerWrite) => api.put(farmPath(farmId, `/articles/${article.id}/fertilizer`), w),
    onSuccess: () => {
      void refresh();
      notifications.show({ color: "lichen", message: `Composition de ${article.name} enregistrée.` });
      onClose();
    },
  });
  const clear = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/articles/${article.id}/fertilizer`)),
    onSuccess: () => {
      void refresh();
      onClose();
    },
  });
  const organic = c.basis !== "mass_percent";
  const contentUnit = c.basis === "mass_percent" ? " %" : c.basis === "kg_per_t" ? " kg/t" : " kg/m³";

  return (
    <Modal opened onClose={onClose} title={`Composition : ${article.name}`} size="lg">
      <Stack>
        {!article.composition && article.proposal && (
          <Alert color="paille">Proposition de Fourmy d'après {article.proposal.source} : vérifiez-la sur l'étiquette avant de l'enregistrer.</Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Teneurs exprimées en"
            data={Object.entries(FERTILIZER_BASIS_LABELS).map(([value, label]) => ({ value, label }))}
            value={c.basis}
            allowDeselect={false}
            onChange={(v) => setC({ ...c, basis: (v ?? "mass_percent") as FertilizerComposition["basis"] })}
          />
          <Select
            label="Type (programme nitrates)"
            data={Object.entries(NITRATE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            value={c.nitrateType}
            clearable
            onChange={(v) => setC({ ...c, nitrateType: (v as NitrateType | null) ?? null, nMineralShare: v === "III" ? 1 : c.nMineralShare })}
          />
          <NumberInput label="Azote total (N)" suffix={contentUnit} decimalSeparator="," min={0} decimalScale={2} value={c.nTotal} onChange={(v) => setC({ ...c, nTotal: Number(v) || 0 })} required />
          {organic && (
            <NumberInput
              label="Part minérale de l'azote (NH4 + NO3)"
              suffix=" %"
              min={0}
              max={100}
              value={c.nMineralShare === null ? "" : Math.round(c.nMineralShare * 100)}
              onChange={(v) => setC({ ...c, nMineralShare: v === "" ? null : Number(v) / 100 })}
            />
          )}
          <NumberInput label="Phosphore (P2O5)" suffix={contentUnit} decimalSeparator="," min={0} value={c.p2o5 ?? ""} onChange={(v) => setC({ ...c, p2o5: optNum(v) })} />
          <NumberInput label="Potasse (K2O)" suffix={contentUnit} decimalSeparator="," min={0} value={c.k2o ?? ""} onChange={(v) => setC({ ...c, k2o: optNum(v) })} />
          <NumberInput label="Soufre (SO3)" suffix={contentUnit} decimalSeparator="," min={0} value={c.so3 ?? ""} onChange={(v) => setC({ ...c, so3: optNum(v) })} />
          <NumberInput
            label="Densité"
            description="kg par litre, pour les doses en litres"
            decimalSeparator=","
            min={0}
            max={3}
            decimalScale={3}
            value={c.density ?? ""}
            onChange={(v) => setC({ ...c, density: optNum(v) })}
          />
        </SimpleGrid>
        <Switch label="Apport foliaire (hors calendrier d'épandage)" checked={c.foliar} onChange={(e) => setC({ ...c, foliar: e.currentTarget.checked })} />
        <TextInput label="Source" placeholder="Étiquette, fiche du fournisseur…" value={source} onChange={(e) => setSource(e.currentTarget.value)} maxLength={200} />
        {(save.error || clear.error) && <ErrorAlert error={save.error ?? clear.error} />}
        <Group>
          <Button onClick={() => save.mutate({ ...c, source: source.trim() || null })} loading={save.isPending}>
            Enregistrer
          </Button>
          {article.composition && (
            <Button variant="subtle" color="gray" onClick={() => clear.mutate()} loading={clear.isPending}>
              Revenir à la proposition
            </Button>
          )}
        </Group>
        {(organic || article.analyses.length > 0) && <Analyses farmId={farmId} article={article} />}
      </Stack>
    </Modal>
  );
}

/** Analyses d'un produit organique (FR-FERT-7) : la plus récente de moins de 5 ans remplace la composition. */
function Analyses({ farmId, article }: { farmId: string; article: FertilizerArticle }) {
  const client = useQueryClient();
  const [a, setA] = useState<ProductAnalysisWrite>({ sampledOn: new Date().toISOString().slice(0, 10), basis: "kg_per_t", dryMatter: null, nTotal: 0, nNh4: null, cN: null, lab: null });
  const [list, setList] = useState(article.analyses);
  const done = (f: FertilizerArticle) => {
    setList(f.analyses);
    void client.invalidateQueries({ queryKey: ["fertilizers", farmId] });
  };
  const add = useMutation({ mutationFn: () => api.post<FertilizerArticle>(farmPath(farmId, `/articles/${article.id}/analyses`), a), onSuccess: done });
  const remove = useMutation({ mutationFn: (id: string) => api.delete<FertilizerArticle>(farmPath(farmId, `/articles/${article.id}/analyses/${id}`)), onSuccess: (f) => f && done(f) });
  return (
    <Stack gap="xs" aria-label="Analyses du produit">
      <Title order={5}>Analyses</Title>
      <Text size="xs" c="dimmed">
        La plus récente de moins de 5 ans remplace la composition pour le calcul de l'azote apporté (référentiel régional, art. 8).
      </Text>
      {list.length > 0 && (
        <Table fz="sm">
          <Table.Tbody>
            {list.map((x) => (
              <Table.Tr key={x.id}>
                <Table.Td>{formatDate(x.sampledOn)}</Table.Td>
                <Table.Td className="lv-num">
                  N {x.nTotal.toLocaleString("fr-FR")} {x.basis === "kg_per_t" ? "kg/t" : "kg/m³"}
                  {x.nNh4 !== null ? ` · NH4 ${x.nNh4.toLocaleString("fr-FR")}` : ""}
                  {x.cN !== null ? ` · C/N ${x.cN.toLocaleString("fr-FR")}` : ""}
                </Table.Td>
                <Table.Td>{x.lab ?? ""}</Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="brique" aria-label="Retirer l'analyse" onClick={() => remove.mutate(x.id)}>
                    <Trash2 size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <TextInput label="Prélevé le" type="date" value={a.sampledOn} onChange={(e) => setA({ ...a, sampledOn: e.currentTarget.value })} />
        <Select
          label="Base"
          data={[
            { value: "kg_per_t", label: "kg/t" },
            { value: "kg_per_m3", label: "kg/m³" },
          ]}
          value={a.basis}
          allowDeselect={false}
          onChange={(v) => setA({ ...a, basis: (v ?? "kg_per_t") as ProductAnalysisWrite["basis"] })}
        />
        <NumberInput label="N total" decimalSeparator="," min={0} value={a.nTotal} onChange={(v) => setA({ ...a, nTotal: Number(v) || 0 })} />
        <NumberInput label="N-NH4" decimalSeparator="," min={0} value={a.nNh4 ?? ""} onChange={(v) => setA({ ...a, nNh4: optNum(v) })} />
        <NumberInput label="Matière sèche (%)" decimalSeparator="," min={0} max={100} value={a.dryMatter ?? ""} onChange={(v) => setA({ ...a, dryMatter: optNum(v) })} />
        <NumberInput label="C/N" decimalSeparator="," min={0} value={a.cN ?? ""} onChange={(v) => setA({ ...a, cN: optNum(v) })} />
        <TextInput label="Laboratoire" value={a.lab ?? ""} onChange={(e) => setA({ ...a, lab: e.currentTarget.value || null })} />
      </SimpleGrid>
      {(add.error || remove.error) && <ErrorAlert error={add.error ?? remove.error} />}
      <Group>
        <Button size="xs" variant="light" onClick={() => add.mutate()} loading={add.isPending} disabled={!(a.nTotal > 0)}>
          Ajouter l'analyse
        </Button>
      </Group>
    </Stack>
  );
}
