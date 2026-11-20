import { useMemo, useState } from "react";
import { Alert, Badge, Button, Chip, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { Search } from "lucide-react";
import { SEED_FLAG_LABELS, type SeedFlag, type SeedListItem } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { useFarm } from "../../app/farm";
import { formatNumber } from "../../app/labels";
import { useColumns, type ColumnDef } from "../../app/columns";
import { ColumnPicker, pickColumns } from "../../components/ColumnPicker";
import { ErrorAlert, Loading } from "../../components/states";
import { AddSeedModal } from "./AddSeedModal";
import { AttachModal } from "./AttachModal";
import { SeedSheet } from "./SeedSheet";
import { ORGANIC_LABELS, stockUnitLabel, tgwLabel } from "./labels";
import { useSeedAttach, useSeeds } from "./queries";

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Semence", required: true },
  { key: "species", label: "Espèce" },
  { key: "unit", label: "Unité de stock" },
  { key: "tgw", label: "PMG" },
  { key: "organic", label: "Bio" },
  { key: "stock", label: "Stock" },
  { key: "usage", label: "Interventions" },
  { key: "flags", label: "À compléter", required: true },
];

const FLAG_COLOR: Record<SeedFlag, string> = {
  tgw_missing: "paille",
  unit_unknown: "brique",
  mixture_empty: "paille",
  species_unknown: "paille",
  tgw_far_from_reference: "brique",
};

type Filter = "tgw" | "mixture" | "nonbio" | "used";

/**
 * Stocks → Semences (lot SE3, FR-SE-1 à 4) : les semences de la ferme, leur
 * espèce, leur PMG et ce qui manque pour convertir les doses de semis.
 */
export function SeedsPage() {
  const farm = useFarm();
  const { at, day } = useAt();
  const list = useSeeds(farm.id, at);
  const columns = useColumns("seeds", COLUMNS);
  const [selected, setSelected] = useState<string | null>(null);
  const owner = farm.role === "owner";
  const proposals = useSeedAttach(farm.id, owner);
  const [adding, setAdding] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [query, setQuery] = useState("");
  const [species, setSpecies] = useState<string | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const years = useMemo(() => {
    const set = new Set<number>([Number(day.slice(0, 4))]);
    for (const s of items) for (const u of s.usage) set.add(u.campaign);
    return [...set].sort((a, b) => b - a);
  }, [items, day]);
  const [campaign, setCampaign] = useState<number | null>(null);
  const year = campaign ?? years[0] ?? Number(day.slice(0, 4));
  const usedIn = (s: SeedListItem) => s.usage.find((u) => u.campaign === year)?.interventions ?? 0;

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorAlert error={list.error} />;

  const speciesOptions = [...new Set(items.map((s) => s.speciesLabel ?? s.importedSpecies).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, "fr"));
  const q = query.trim().toLowerCase();
  const has = (f: Filter) => filters.includes(f);
  const rows = items.filter(
    (s) =>
      (!q || `${s.name} ${s.sheet?.varietyName ?? ""} ${s.sheet?.gnisCode ?? ""}`.toLowerCase().includes(q)) &&
      (!species || (s.speciesLabel ?? s.importedSpecies) === species) &&
      (!has("tgw") || s.flags.includes("tgw_missing")) &&
      (!has("mixture") || s.sheet?.isMixture || s.looksLikeMixture) &&
      (!has("nonbio") || s.organicStatus !== "organic") &&
      (!has("used") || usedIn(s) > 0),
  );
  const toComplete = items.filter((s) => s.flags.length > 0 && usedIn(s) > 0).length;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={1}>Semences</Title>
          <Text size="sm" c="dimmed" maw={760}>
            Espèce, variété et PMG (poids de mille grains) de vos semences : le PMG permet de passer d'une densité en grains/m² à une dose en kg/ha ou en
            doses. Il se lit sur l'étiquette du sac ; à défaut, Fourmy propose un repère par espèce d'après Arvalis ou Terres Inovia, à confirmer.
          </Text>
        </div>
        <Group gap="xs">
          {owner && <Button onClick={() => setAdding(true)}>Ajouter une semence</Button>}
          <ColumnPicker columns={columns} />
        </Group>
      </Group>
      {owner && !!proposals.data?.items.length && (
        <Alert color="lichen" title="Rattacher au référentiel">
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              {proposals.data.items.length} semence{proposals.data.items.length > 1 ? "s" : ""} peu{proposals.data.items.length > 1 ? "vent" : "t"} être rattachée
              {proposals.data.items.length > 1 ? "s" : ""} à leur espèce et à leur variété, dont {proposals.data.items.filter((p) => p.sure).length} par leur code GNIS.
            </Text>
            <Button size="compact-sm" variant="light" onClick={() => setAttaching(true)}>
              Voir et rattacher
            </Button>
          </Group>
        </Alert>
      )}
      {toComplete > 0 && (
        <Alert color="paille">
          {toComplete} semence{toComplete > 1 ? "s" : ""} utilisée{toComplete > 1 ? "s" : ""} en {year} {toComplete > 1 ? "ont" : "a"} une fiche à compléter : les
          densités de semis ne peuvent pas toutes être calculées.
        </Alert>
      )}
      <Group gap="sm" align="flex-end">
        <TextInput
          aria-label="Rechercher une semence"
          placeholder="Nom, variété, code GNIS"
          leftSection={<Search size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Select aria-label="Espèce" placeholder="Toutes les espèces" data={speciesOptions} value={species} onChange={setSpecies} clearable searchable />
        <Select
          aria-label="Campagne"
          data={years.map((y) => ({ value: String(y), label: `Campagne ${y}` }))}
          value={String(year)}
          onChange={(v) => setCampaign(v ? Number(v) : null)}
          allowDeselect={false}
          w={170}
        />
        <Chip.Group multiple value={filters} onChange={setFilters}>
          <Group gap={6}>
            <Chip value="used" size="sm">
              Semées en {year}
            </Chip>
            <Chip value="tgw" size="sm">
              Sans PMG
            </Chip>
            <Chip value="mixture" size="sm">
              Mélanges
            </Chip>
            <Chip value="nonbio" size="sm">
              Non bio
            </Chip>
          </Group>
        </Chip.Group>
      </Group>
      <DataTable
        withTableBorder
        striped
        highlightOnHover
        minHeight={150}
        aria-label="Semences"
        noRecordsText={items.length ? "Aucune semence ne correspond aux filtres" : "Aucune semence : elles arrivent avec les achats, les imports ou la saisie d'un semis."}
        records={rows}
        idAccessor="articleId"
        onRowClick={({ record }) => setSelected(record.articleId)}
        columns={pickColumns<SeedListItem>(
          [
            {
              accessor: "name",
              title: "Semence",
              render: (s) => (
                <div>
                  <Text size="sm" fw={500}>
                    {s.name}
                  </Text>
                  {(s.sheet?.varietyName || s.sheet?.gnisCode) && (
                    <Text size="xs" c="dimmed">
                      {[s.sheet.varietyName, s.sheet.gnisCode].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </div>
              ),
            },
            {
              accessor: "species",
              title: "Espèce",
              render: (s) =>
                s.sheet?.isMixture ? (
                  <Text size="sm">Mélange{s.componentCount ? ` de ${s.componentCount} espèces` : ""}</Text>
                ) : s.speciesLabel ? (
                  <Text size="sm">{s.speciesLabel}</Text>
                ) : s.importedSpecies ? (
                  <Text size="sm" c="dimmed" title="Lue dans un fichier importé, à rattacher">
                    {s.importedSpecies}
                  </Text>
                ) : (
                  "—"
                ),
            },
            { accessor: "unit", title: "Unité de stock", render: (s) => (s.unitDim ? stockUnitLabel(s) : <Text c="brique" size="sm">{s.unit}</Text>) },
            {
              accessor: "tgw",
              title: "PMG",
              render: (s) => {
                const label = tgwLabel(s);
                if (!label) return s.sheet?.isMixture ? "—" : <Text size="sm" c="dimmed">inconnu</Text>;
                return (
                  <Text size="sm" className="lv-num" c={s.tgw?.estimated ? "dimmed" : undefined} title={s.tgw?.estimated ? "Repère de l'espèce : quantités estimées" : undefined}>
                    {label}
                  </Text>
                );
              },
            },
            { accessor: "organic", title: "Bio", render: (s) => (s.organicStatus ? ORGANIC_LABELS[s.organicStatus] : "—") + (s.seedTreated ? " · traitée" : "") },
            {
              accessor: "stock",
              title: "Stock",
              textAlign: "right",
              render: (s) => (
                <Text span size="sm" className="lv-num" c={s.stock < 0 ? "brique" : undefined}>
                  {s.stock ? formatNumber(s.stock, 3) : "—"}
                </Text>
              ),
            },
            { accessor: "usage", title: `Interventions ${year}`, textAlign: "right", render: (s) => usedIn(s) || "—" },
            {
              accessor: "flags",
              title: "À compléter",
              render: (s) => (
                <Group gap={4} wrap="nowrap">
                  {s.flags.map((f) => (
                    <Badge key={f} variant="light" color={FLAG_COLOR[f]} size="sm">
                      {SEED_FLAG_LABELS[f]}
                    </Badge>
                  ))}
                  {s.looksLikeMixture && (
                    <Badge variant="outline" color="gray" size="sm" title="Le nom ou l'espèce importée évoque un mélange">
                      Mélange ?
                    </Badge>
                  )}
                  {(s.flags.length > 0 || s.looksLikeMixture) && owner && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(s.articleId);
                      }}
                    >
                      Compléter
                    </Button>
                  )}
                </Group>
              ),
            },
          ],
          columns,
        )}
      />
      <SeedSheet articleId={selected} onClose={() => setSelected(null)} proposal={proposals.data?.items.find((p) => p.articleId === selected) ?? null} />
      {adding && (
        <AddSeedModal
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            setSelected(id);
          }}
        />
      )}
      {attaching && proposals.data && <AttachModal proposals={proposals.data.items} onClose={() => setAttaching(false)} />}
    </Stack>
  );
}
