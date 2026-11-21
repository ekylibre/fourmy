import { useMemo, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, Popover, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Save } from "lucide-react";
import { PRICE_SCOPE_LABELS, PRICE_SOURCE_LABELS, priceKey, unitLabel, type Price, type PriceKind, type PriceSource, type PriceSuggestion, type PriceWrite } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { pricesKey, usePriceHistory } from "./queries";

/** Ligne de prix : ce dont c'est le prix, son unité par défaut, son prix en vigueur. */
export interface PriceRow {
  label: string;
  sub?: string;
  /** Champs de la clé du prix (article, matériel, activité + produit, procédure). */
  ref: Pick<PriceWrite, "articleId" | "equipmentId" | "activityId" | "product" | "procedure">;
  unit: string;
  units: string[];
  current: Price | null;
  /** Information à côté du prix (coût du barème, prix proposé). */
  hint?: React.ReactNode;
  /** Ce qui s'applique sans prix saisi (« barème BCMA ») ; sinon « à saisir ». */
  fallback?: string;
  /** Prix proposés par une référence (Lexicon), à reprendre. */
  suggestions?: PriceSuggestion[];
}

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" });
type Edit = { amount: number | string; unit: string; source?: PriceSource; sourceRef?: string; sourceDate?: string };
const fmtMonth = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", month: "short", year: "numeric" });

/** Saisie d'un montant (« 22,5 », 22.5) → nombre ; null si vide ou invalide. */
const toAmount = (v: number | string): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const n = Number(v.replace(",", ".").trim());
  return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};
/** Unité d'un prix : celles du stock, plus l'heure et l'hectare. */
export const priceUnitLabel = (u: string) => (u === "hour" ? "heure" : u === "hectare" ? "hectare" : unitLabel(u) || u);
export const fmtEuro = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: n < 10 ? 3 : 2 });

/**
 * Tableau de prix d'une nature (module Économique, lot E1) : saisie ligne à
 * ligne, sélection et modification en masse (« prix à… », « + x % »), date
 * d'effet commune ; l'enregistrement ajoute une ligne datée par prix modifié
 * (l'ancien prix reste dans l'historique).
 */
export function PriceTable({ farmId, kind, rows, owner, label }: { farmId: string; kind: PriceKind; rows: PriceRow[]; owner: boolean; label: string }) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [validFrom, setValidFrom] = useState(today());
  const [bulk, setBulk] = useState<number | "">("");
  const [percent, setPercent] = useState<number | "">("");
  const [filter, setFilter] = useState("");
  const keyOf = (r: PriceRow) => priceKey({ kind, articleId: r.ref.articleId ?? null, equipmentId: r.ref.equipmentId ?? null, activityId: r.ref.activityId ?? null, product: r.ref.product ?? null, procedure: r.ref.procedure ?? null });
  const visible = useMemo(() => rows.filter((r) => !filter.trim() || `${r.label} ${r.sub ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())), [rows, filter]);
  const changed = rows.filter((r) => {
    const e = edits[keyOf(r)];
    const n = e ? toAmount(e.amount) : null;
    return e && n !== null && (n !== r.current?.amount || e.unit !== (r.current?.unit ?? r.unit));
  });

  const save = useMutation({
    mutationFn: () =>
      api.post(farmPath(farmId, "/prices"), {
        items: changed.map((r) => {
          const e = edits[keyOf(r)]!;
          return { kind, ...r.ref, unit: e.unit, amount: toAmount(e.amount)!, validFrom, source: e.source ?? "farm", sourceRef: e.sourceRef ?? null, sourceDate: e.sourceDate ?? null };
        }),
      }),
    onSuccess: async () => {
      notifications.show({ color: "lichen", message: `${changed.length} prix enregistré(s), en vigueur au ${fmtDate(validFrom)}.` });
      setEdits({});
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: pricesKey(farmId) });
    },
    onError: (e) => notifications.show({ color: "red", message: e instanceof Error ? e.message : String(e) }),
  });

  // Une saisie à la main rend le prix « saisi » ; « Reprendre » garde la source proposée.
  const edit = (r: PriceRow, patch: Partial<Edit>) =>
    setEdits((cur) => {
      const k = keyOf(r);
      const base: Edit = cur[k] ?? { amount: r.current?.amount ?? "", unit: r.current?.unit ?? r.unit };
      return { ...cur, [k]: { ...base, source: undefined, sourceRef: undefined, sourceDate: undefined, ...patch } };
    });
  const applyBulk = (fn: (r: PriceRow) => number | null) => {
    for (const r of rows.filter((x) => selected.has(keyOf(x)))) {
      const v = fn(r);
      if (v !== null) edit(r, { amount: Math.round(v * 1000) / 1000 });
    }
  };
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(keyOf(r)));

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <TextInput placeholder="Filtrer" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} w={240} aria-label={`Filtrer ${label}`} />
        {owner && (
          <Group gap="xs" wrap="wrap">
            <TextInput type="date" label="Date d'effet" value={validFrom} onChange={(e) => setValidFrom(e.currentTarget.value || today())} size="xs" />
            <Button leftSection={<Save size={16} />} onClick={() => save.mutate()} loading={save.isPending} disabled={!changed.length} mt="lg">
              Enregistrer ({changed.length})
            </Button>
          </Group>
        )}
      </Group>
      {owner && selected.size > 0 && (
        <Paper withBorder p="xs">
          <Group gap="xs" wrap="wrap" align="flex-end">
            <Text size="sm">{selected.size} ligne(s) :</Text>
            <NumberInput size="xs" label="Prix à" value={bulk} onChange={(v) => setBulk(typeof v === "number" ? v : "")} min={0} decimalSeparator="," w={110} />
            <Button size="xs" variant="light" disabled={bulk === ""} onClick={() => applyBulk(() => bulk as number)}>
              Appliquer
            </Button>
            <NumberInput size="xs" label="Variation (%)" value={percent} onChange={(v) => setPercent(typeof v === "number" ? v : "")} decimalSeparator="," w={110} />
            <Button size="xs" variant="light" disabled={percent === ""} onClick={() => applyBulk((r) => (r.current ? r.current.amount * (1 + (percent as number) / 100) : null))}>
              Appliquer
            </Button>
          </Group>
        </Paper>
      )}
      <Paper withBorder>
        <Table verticalSpacing={4} highlightOnHover aria-label={label}>
          <Table.Thead>
            <Table.Tr>
              {owner && (
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="Tout choisir"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.currentTarget.checked ? new Set(visible.map(keyOf)) : new Set())}
                  />
                </Table.Th>
              )}
              <Table.Th>{label}</Table.Th>
              <Table.Th>Prix HT</Table.Th>
              <Table.Th>En vigueur</Table.Th>
              <Table.Th>Repère</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map((r) => {
              const k = keyOf(r);
              const e = edits[k];
              const amount = e ? e.amount : (r.current?.amount ?? "");
              const unit = e?.unit ?? r.current?.unit ?? r.unit;
              const units = [...new Set([unit, ...r.units])];
              return (
                <Table.Tr key={k} bg={e && changed.includes(r) ? "var(--mantine-color-paille-light)" : undefined}>
                  {owner && (
                    <Table.Td>
                      <Checkbox
                        aria-label={`Choisir ${r.label}`}
                        checked={selected.has(k)}
                        onChange={(ev) => {
                          const on = ev.currentTarget.checked;
                          setSelected((cur) => {
                            const n = new Set(cur);
                            if (on) n.add(k);
                            else n.delete(k);
                            return n;
                          });
                        }}
                      />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm">{r.label}</Text>
                    {r.sub && (
                      <Text size="xs" c="dimmed">
                        {r.sub}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {owner ? (
                      <Group gap={4} wrap="nowrap">
                        <NumberInput
                          size="xs"
                          w={110}
                          value={amount}
                          onChange={(v) => edit(r, { amount: v })}
                          min={0}
                          decimalScale={3}
                          decimalSeparator=","
                          rightSection={<Text size="xs">€</Text>}
                          aria-label={`Prix de ${r.label}`}
                        />
                        <Select
                          size="xs"
                          w={130}
                          data={units.map((u) => ({ value: u, label: `/ ${priceUnitLabel(u)}` }))}
                          value={unit}
                          onChange={(v) => v && edit(r, { unit: v })}
                          allowDeselect={false}
                          aria-label={`Unité du prix de ${r.label}`}
                        />
                      </Group>
                    ) : (
                      <Text size="sm">{r.current ? `${fmtEuro(r.current.amount)} / ${priceUnitLabel(r.current.unit)}` : "—"}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.current ? (
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          depuis le {fmtDate(r.current.validFrom)} · {PRICE_SOURCE_LABELS[r.current.source]}
                        </Text>
                        <HistoryButton farmId={farmId} kind={kind} rowKey={k} />
                      </Group>
                    ) : r.fallback ? (
                      <Badge size="xs" color="gray" variant="light">
                        {r.fallback}
                      </Badge>
                    ) : (
                      <Badge size="xs" color="orange" variant="light">
                        à saisir
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      {r.hint}
                      {r.suggestions?.map((sg) => (
                        <Group key={sg.ref} gap={4} wrap="nowrap">
                          <Text size="xs" c="dimmed">
                            {PRICE_SCOPE_LABELS[sg.scope]}
                            {sg.scope === "market" || sg.scope === "reference" ? ` (${sg.label})` : ""} : {fmtEuro(sg.amount)} / {priceUnitLabel(sg.unit)}, {fmtMonth(sg.date)}
                          </Text>
                          {owner && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              onClick={() => edit(r, { amount: sg.amount, unit: sg.unit, source: sg.source, sourceRef: sg.ref, sourceDate: sg.date })}
                              aria-label={`Reprendre ${PRICE_SCOPE_LABELS[sg.scope]} pour ${r.label}`}
                            >
                              Reprendre
                            </Button>
                          )}
                        </Group>
                      ))}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {visible.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={owner ? 5 : 4}>
                  <Text size="sm" c="dimmed" ta="center" py="md">
                    Rien à afficher.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
      {!owner && <Alert color="gray">Seul le responsable de la ferme modifie les prix.</Alert>}
    </Stack>
  );
}

/** Historique des prix d'une ligne (chargé à l'ouverture). */
function HistoryButton({ farmId, kind, rowKey }: { farmId: string; kind: PriceKind; rowKey: string }) {
  const [opened, setOpened] = useState(false);
  const history = usePriceHistory(farmId, kind, opened);
  const list = (history.data?.items ?? []).filter((p) => priceKey(p) === rowKey);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow>
      <Popover.Target>
        <Button size="compact-xs" variant="subtle" onClick={() => setOpened((o) => !o)} aria-label="Historique du prix">
          <History size={14} />
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={2}>
          {list.map((p) => (
            <Text key={p.id} size="xs">
              {fmtDate(p.validFrom)} : {fmtEuro(p.amount)} / {priceUnitLabel(p.unit)} · {PRICE_SOURCE_LABELS[p.source]}
            </Text>
          ))}
          {!list.length && <Text size="xs">…</Text>}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
