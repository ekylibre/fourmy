import { useEffect, useState } from "react";
import { Alert, Anchor, Badge, Button, Divider, Drawer, Group, NumberInput, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  SEED_CATEGORY_LABELS,
  TGW_ORIGIN_LABELS,
  unitLabel,
  type ArticleOrganicWrite,
  type LotSeed,
  type SeedDetail,
  type SeedAttachProposal,
  type SeedLotView,
  type SeedSheetSave,
  type SeedSheetWrite,
  type TgwOrigin,
} from "@fourmy/contracts";
import { parseSeedUnit, tgwWarning } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatDate, formatNumber } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { ProposalBadge, proposalLabel } from "./AttachModal";
import { MixtureEditor } from "./MixtureEditor";
import { fmt, ORGANIC_LABELS, stockUnitLabel } from "./labels";
import { seedsKey, useSeed, useSeedSpecies } from "./queries";

const EMPTY: SeedSheetWrite = {
  species: null,
  varietyName: null,
  gnisCode: null,
  category: null,
  isMixture: false,
  grainsPerDose: null,
  bagKg: null,
  tgwG: null,
  tgwOrigin: null,
  tgwOn: null,
};

/** Unités de stock proposées : celle de l'article, puis les unités canoniques. */
const UNIT_CHOICES = ["kilogram", "thousand", "dose", "plant"];

const optNum = (v: string | number) => (v === "" ? null : Number(v));

/**
 * Fiche d'une semence (lot SE3, FR-SE-5 à 9) : identité, conditionnement,
 * PMG et repère de l'espèce, statut bio, lots et leur PMG, interventions.
 * Modifiable par le responsable ; consultation pour les autres membres.
 */
export function SeedSheet({ articleId, onClose, proposal = null }: { articleId: string | null; onClose: () => void; proposal?: SeedAttachProposal | null }) {
  const farm = useFarm();
  const { at } = useAt();
  const seed = useSeed(farm.id, articleId, at);
  return (
    <Drawer
      opened={!!articleId}
      onClose={onClose}
      position="right"
      size="xl"
      title={seed.data?.name ?? "Semence"}
      aria-label={seed.data ? `Fiche de ${seed.data.name}` : "Fiche de la semence"}
    >
      {seed.isLoading && <Loading />}
      {seed.error && <ErrorAlert error={seed.error} />}
      {seed.data && <SheetBody key={seed.data.articleId + seed.data.sheet?.updatedAt} detail={seed.data} proposal={proposal} />}
    </Drawer>
  );
}

function SheetBody({ detail, proposal }: { detail: SeedDetail; proposal: SeedAttachProposal | null }) {
  const farm = useFarm();
  const { at } = useAt();
  const owner = farm.role === "owner";
  const client = useQueryClient();
  const species = useSeedSpecies(farm.id, true);
  const [w, setW] = useState<SeedSheetWrite>(detail.sheet ? { ...EMPTY, ...detail.sheet } : { ...EMPTY, isMixture: detail.looksLikeMixture });
  const [unit, setUnit] = useState(detail.unit);
  const refresh = () => client.invalidateQueries({ queryKey: seedsKey(farm.id) });
  const save = useMutation({
    mutationFn: (body: SeedSheetSave) => api.put<SeedDetail>(farmPath(farm.id, `/articles/${detail.articleId}/seed?at=${encodeURIComponent(at)}`), body),
    onSuccess: () => {
      void refresh();
      notifications.show({ color: "lichen", message: `Fiche de ${detail.name} enregistrée.` });
    },
  });
  const organic = useMutation({
    mutationFn: (body: ArticleOrganicWrite) => api.put(farmPath(farm.id, `/articles/${detail.articleId}/organic`), body),
    onSuccess: () => void refresh(),
  });

  // Repère de l'espèce enregistrée (l'API le donne avec sa source) ; une autre espèce choisie : après enregistrement.
  const ref = !w.isMixture && detail.sheet?.species === w.species ? detail.reference : null;
  const far = !w.isMixture && tgwWarning(w.tgwG, ref);
  const unitDim = parseSeedUnit(unit, w.grainsPerDose)?.dim ?? null;
  // Plants comptés à la pièce (issue #130) : ni grains par dose, ni PMG.
  const plant = unitDim === "plant";
  const unitOptions = [...new Set([detail.unit, ...UNIT_CHOICES])].map((u) => ({
    value: u,
    label:
      u === "dose"
        ? "Doses (nombre de grains ci-dessous)"
        : u === "thousand"
          ? "Milliers de grains"
          : u === "plant"
            ? "Plants (à la pièce)"
            : u === detail.unit
              ? `${unitLabel(u)} (actuelle)`
              : unitLabel(u),
  }));
  const speciesOptions = (species.data?.items ?? []).map((s) => ({ value: s.species, label: s.legume ? `${s.label} (légumineuse)` : s.label }));
  const pick = (v: Partial<SeedSheetWrite>) => setW((x) => ({ ...x, ...v }));

  return (
    <Stack>
      {proposal && owner && !w.species && !w.isMixture && (
        <Alert color="lichen" title="Rattachement proposé">
          <Group justify="space-between" gap="xs">
            <Group gap={6}>
              <Text size="sm">
                {proposalLabel(proposal)}, d'après {proposal.reason}.
              </Text>
              <ProposalBadge p={proposal} />
            </Group>
            <Button
              size="compact-sm"
              variant="light"
              onClick={() =>
                pick(
                  proposal.isMixture
                    ? { isMixture: true, species: null, tgwG: null, tgwOrigin: null, tgwOn: null }
                    : { species: proposal.species, varietyName: w.varietyName ?? proposal.varietyName, gnisCode: w.gnisCode ?? proposal.gnisCode },
                )
              }
            >
              Reprendre
            </Button>
          </Group>
        </Alert>
      )}
      {!proposal && detail.importedSpecies && !detail.sheet?.species && !w.isMixture && (
        <Alert color="paille">
          Espèce lue dans le fichier importé : « {detail.importedSpecies} »{detail.importedGnis ? `, code GNIS ${detail.importedGnis}` : ""}. Choisissez-la dans la liste
          pour la rattacher.
        </Alert>
      )}
      <Title order={4}>Identité</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Switch
          label="Mélange de plusieurs espèces"
          description="Couverts, prairies : la dose de chaque espèce se saisit au semis"
          checked={w.isMixture}
          disabled={!owner}
          onChange={(e) => pick(e.currentTarget.checked ? { isMixture: true, species: null, tgwG: null, tgwOrigin: null, tgwOn: null } : { isMixture: false })}
        />
        <Select
          label="Catégorie"
          data={Object.entries(SEED_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          value={w.category}
          onChange={(v) => pick({ category: v as SeedSheetWrite["category"] })}
          clearable
          disabled={!owner}
        />
        {!w.isMixture && (
          <Select
            label="Espèce"
            placeholder={species.isLoading ? "Chargement…" : "Choisir l'espèce"}
            data={speciesOptions}
            value={w.species}
            onChange={(v) => pick({ species: v })}
            searchable
            clearable
            limit={50}
            nothingFoundMessage="Espèce inconnue du référentiel"
            disabled={!owner}
          />
        )}
        <TextInput label="Variété" value={w.varietyName ?? ""} onChange={(e) => pick({ varietyName: e.currentTarget.value || null })} maxLength={120} disabled={!owner} />
        <TextInput
          label="Code GNIS"
          description="Code de la variété au catalogue officiel"
          value={w.gnisCode ?? ""}
          onChange={(e) => pick({ gnisCode: e.currentTarget.value.trim().toUpperCase() || null })}
          maxLength={20}
          disabled={!owner}
        />
      </SimpleGrid>
      {w.isMixture && (
        <>
          <Divider />
          <Title order={4}>Espèces du mélange</Title>
          <MixtureEditor key={detail.components.map((c) => c.id).join()} detail={detail} owner={owner} />
        </>
      )}

      <Divider />
      <Title order={4}>Conditionnement</Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select
          label="Unité de stock"
          description="Changer d'unité ne change pas les stocks : seulement vers une unité équivalente"
          data={unitOptions}
          value={unit}
          onChange={(v) => v && setUnit(v)}
          allowDeselect={false}
          disabled={!owner}
        />
        {!plant && (
          <NumberInput
            label="Grains par dose"
            description="Sac de maïs : 50 000 ; tournesol : 150 000"
            thousandSeparator=" "
            min={1}
            allowDecimal={false}
            value={w.grainsPerDose ?? ""}
            onChange={(v) => pick({ grainsPerDose: optNum(v) })}
            disabled={!owner}
          />
        )}
        {!plant && (
          <NumberInput label="Poids d'un sac" suffix=" kg" decimalSeparator="," min={0} value={w.bagKg ?? ""} onChange={(v) => pick({ bagKg: optNum(v) })} disabled={!owner} />
        )}
      </SimpleGrid>
      {!unitDim && (
        <Alert color="brique">Unité « {unit} » non reconnue : choisissez kg, milliers de grains, doses ou plants pour que les doses de semis se convertissent.</Alert>
      )}
      {plant && (
        <Text size="sm" c="dimmed">
          Plants comptés à la pièce : le stock et les plantations se comptent en plants, ou en plants par hectare.
        </Text>
      )}

      {!w.isMixture && !plant && (
        <>
          <Divider />
          <Title order={4}>PMG (poids de mille grains)</Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NumberInput
              label="PMG"
              suffix=" g"
              decimalSeparator=","
              min={0}
              max={1999}
              decimalScale={1}
              value={w.tgwG ?? ""}
              onChange={(v) => {
                const tgwG = optNum(v);
                pick({ tgwG, tgwOrigin: tgwG === null ? null : (w.tgwOrigin ?? "label") });
              }}
              disabled={!owner}
            />
            <Select
              label="Origine"
              data={Object.entries(TGW_ORIGIN_LABELS).map(([value, label]) => ({ value, label }))}
              value={w.tgwOrigin}
              onChange={(v) => pick({ tgwOrigin: v as TgwOrigin | null })}
              disabled={!owner || w.tgwG === null}
            />
            <TextInput label="Date" type="date" value={w.tgwOn ?? ""} onChange={(e) => pick({ tgwOn: e.currentTarget.value || null })} disabled={!owner || w.tgwG === null} />
          </SimpleGrid>
          {ref ? (
            <Group gap="xs">
              <Text size="sm">
                Repère {ref.org} pour {ref.label.toLowerCase()} : {fmt(ref.typicalG)} g
                {ref.minG !== null && ref.maxG !== null ? ` (de ${fmt(ref.minG)} à ${fmt(ref.maxG)} g)` : ""}
                {ref.typicalStated ? "" : ", milieu de la plage publiée"}.{" "}
                <Anchor href={ref.url} target="_blank" rel="noreferrer" size="sm">
                  Source
                </Anchor>
              </Text>
              {owner && w.tgwG === null && (
                <Button size="compact-xs" variant="light" onClick={() => pick({ tgwG: ref.typicalG, tgwOrigin: "reference", tgwOn: null })}>
                  Reprendre le repère
                </Button>
              )}
            </Group>
          ) : w.species && !species.isLoading ? (
            <Text size="sm" c="dimmed">
              {detail.sheet?.species === w.species ? "Pas de repère publié par Arvalis ou Terres Inovia pour cette espèce : saisissez le PMG de l'étiquette." : "Le repère de l'espèce s'affichera une fois la fiche enregistrée."}
            </Text>
          ) : null}
          {ref?.note && (
            <Text size="xs" c="dimmed">
              {ref.note}
            </Text>
          )}
          {far && (
            <Alert color="brique">
              PMG de {fmt(w.tgwG!)} g, loin du repère de {fmt(ref!.typicalG)} g : vérifiez l'étiquette (grammes pour mille grains).
            </Alert>
          )}
          {w.tgwOrigin === "reference" && <Text size="xs" c="dimmed">PMG repère : les quantités converties avec lui sont estimées.</Text>}
        </>
      )}

      {save.error && <ErrorAlert error={save.error} />}
      {owner && (
        <Group>
          <Button onClick={() => save.mutate({ ...w, ...(unit !== detail.unit ? { unit } : {}) })} loading={save.isPending}>
            Enregistrer la fiche
          </Button>
        </Group>
      )}

      <Divider />
      <Title order={4}>Agriculture biologique</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Statut"
          data={Object.entries(ORGANIC_LABELS).map(([value, label]) => ({ value, label }))}
          value={detail.organicStatus}
          onChange={(v) => organic.mutate({ organicStatus: v as ArticleOrganicWrite["organicStatus"], seedTreated: detail.seedTreated })}
          clearable
          placeholder="Non renseigné"
          disabled={!owner || organic.isPending}
        />
        <Select
          label="Semence traitée"
          data={[
            { value: "yes", label: "Oui" },
            { value: "no", label: "Non" },
          ]}
          value={detail.seedTreated === null ? null : detail.seedTreated ? "yes" : "no"}
          onChange={(v) => organic.mutate({ organicStatus: detail.organicStatus, seedTreated: v === null ? null : v === "yes" })}
          clearable
          placeholder="Non renseigné"
          disabled={!owner || organic.isPending}
        />
      </SimpleGrid>
      <Anchor component={Link} to={`/f/${farm.id}/control/ab`} size="sm">
        Dérogations et semences du contrôle AB
      </Anchor>
      {organic.error && <ErrorAlert error={organic.error} />}

      {detail.lots.length > 0 && (
        <>
          <Divider />
          <Title order={4}>Lots</Title>
          {!plant && (
            <Text size="xs" c="dimmed">
              Le PMG d'un lot (étiquette du sac) l'emporte sur celui de la fiche pour les semis de ce lot.
            </Text>
          )}
          <Table fz="sm" aria-label="Lots de la semence">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Lot</Table.Th>
                <Table.Th ta="right">Stock</Table.Th>
                {!plant && <Table.Th>PMG du lot</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {detail.lots.map((l) => (
                <LotRow key={l.id + (l.seed?.tgwG ?? "")} lot={l} detail={detail} owner={owner && !w.isMixture} withTgw={!plant} />
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      <Divider />
      <Title order={4}>Semis</Title>
      <Uses detail={detail} />
    </Stack>
  );
}

function LotRow({ lot, detail, owner, withTgw = true }: { lot: SeedLotView; detail: SeedDetail; owner: boolean; withTgw?: boolean }) {
  const farm = useFarm();
  const { at } = useAt();
  const client = useQueryClient();
  const [tgw, setTgw] = useState<number | "">(lot.seed?.tgwG ?? "");
  useEffect(() => setTgw(lot.seed?.tgwG ?? ""), [lot.seed?.tgwG]);
  const path = farmPath(farm.id, `/lots/${lot.id}/seed?at=${encodeURIComponent(at)}`);
  const save = useMutation({
    mutationFn: (seed: LotSeed | null) => (seed ? api.put<SeedDetail>(path, seed) : api.delete<SeedDetail>(path)),
    onSuccess: () => void client.invalidateQueries({ queryKey: seedsKey(farm.id) }),
  });
  return (
    <Table.Tr>
      <Table.Td>{lot.code}</Table.Td>
      <Table.Td ta="right" className="lv-num">
        {formatNumber(lot.stock, 3)} {stockUnitLabel(detail)}
      </Table.Td>
      {withTgw && (
        <Table.Td>
          {owner ? (
            <Group gap={6} wrap="nowrap">
              <NumberInput
                aria-label={`PMG du lot ${lot.code}`}
                size="xs"
                w={110}
                suffix=" g"
                decimalSeparator=","
                min={0}
                max={1999}
                value={tgw}
                placeholder="fiche"
                onChange={(v) => setTgw(v === "" ? "" : Number(v))}
              />
              <Button
                size="compact-xs"
                variant="light"
                disabled={tgw === (lot.seed?.tgwG ?? "")}
                loading={save.isPending}
                onClick={() => save.mutate(tgw === "" ? null : { tgwG: tgw, origin: "label", on: null })}
              >
                Enregistrer
              </Button>
            </Group>
          ) : lot.seed ? (
            `${fmt(lot.seed.tgwG)} g`
          ) : (
            <Text size="sm" c="dimmed">
              celui de la fiche
            </Text>
          )}
          {save.error && <ErrorAlert error={save.error} />}
        </Table.Td>
      )}
    </Table.Tr>
  );
}

/** Interventions qui utilisent la semence, par campagne : dose saisie, densité, dose en kg/ha (FR-SE-8). */
function Uses({ detail }: { detail: SeedDetail }) {
  const farm = useFarm();
  const plant = detail.unitDim === "plant";
  if (!detail.interventions.length) return <Text size="sm" c="dimmed">Aucune intervention n'utilise cette semence.</Text>;
  const campaigns = [...new Set(detail.interventions.map((u) => u.campaign ?? 0))].sort((a, b) => b - a);
  return (
    <Stack gap="sm">
      {campaigns.map((c) => (
        <div key={c}>
          <Text fw={600} size="sm">
            {c ? `Campagne ${c}` : "Sans campagne"}
          </Text>
          <Table fz="sm" aria-label={`Semis de la campagne ${c}`}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Parcelles</Table.Th>
                <Table.Th ta="right">Dose saisie</Table.Th>
                {plant ? (
                  <Table.Th ta="right">Plants/ha</Table.Th>
                ) : (
                  <>
                    <Table.Th ta="right">Grains/m²</Table.Th>
                    <Table.Th ta="right">kg/ha</Table.Th>
                  </>
                )}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {detail.interventions
                .filter((u) => (u.campaign ?? 0) === c)
                .map((u) => (
                  <Table.Tr key={u.interventionId + (u.unit ?? "")}>
                    <Table.Td>
                      <Anchor component={Link} to={`/f/${farm.id}/interventions/${u.interventionId}`} size="sm">
                        {formatDate(u.startedAt)}
                      </Anchor>
                      {u.status === "planned" && (
                        <Badge size="xs" variant="light" color="gray" ml={6}>
                          prévue
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{u.parcels.join(", ") || "—"}</Table.Td>
                    <Table.Td ta="right" className="lv-num">
                      {u.quantity === null ? "—" : `${fmt(u.quantity, 3)} ${unitLabel(u.unit)}`}
                    </Table.Td>
                    {plant ? (
                      <Table.Td ta="right" className="lv-num">
                        {u.plantsPerHa === null || u.plantsPerHa === undefined ? "—" : fmt(u.plantsPerHa, 0)}
                      </Table.Td>
                    ) : (
                      <>
                        <Table.Td ta="right" className="lv-num">
                          {u.grainsPerM2 === null ? "—" : fmt(u.grainsPerM2, 0)}
                        </Table.Td>
                        <Table.Td ta="right" className="lv-num" title={u.estimated ? "PMG repère : estimée" : undefined}>
                          {u.kgPerHa === null ? "—" : `${fmt(u.kgPerHa, 1)}${u.estimated ? " (estimée)" : ""}`}
                        </Table.Td>
                      </>
                    )}
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </div>
      ))}
      {!plant && (
        <Text size="xs" c="dimmed">
          Densité et dose calculées avec le PMG du lot semé, sinon celui de la fiche ; « — » quand il manque le PMG, le nombre de grains par dose ou la surface.
        </Text>
      )}
    </Stack>
  );
}
