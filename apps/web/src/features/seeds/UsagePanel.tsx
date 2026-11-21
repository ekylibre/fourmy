import { useState } from "react";
import { Anchor, Badge, Button, Group, SegmentedControl, Select, Stack, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Download } from "lucide-react";
import { type SeedDensityRange, type SeedUsageBy, type SeedUsageFigures, type SeedUsageGroup } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { fmt, stockUnitLabel } from "./labels";
import { useSeedUsage } from "./queries";

/** « 170 (150 à 180) », ou la seule valeur quand toutes les parcelles ont la même. */
export function rangeLabel(r: SeedDensityRange | null, digits = 1): string {
  if (!r) return "—";
  return r.min === r.max ? fmt(r.mean, digits) : `${fmt(r.mean, digits)} (${fmt(r.min, digits)} à ${fmt(r.max, digits)})`;
}

function Figures({ f, unit, label }: { f: SeedUsageFigures; unit: string | null; label: string }) {
  if (!f.interventions) return <Table.Td colSpan={4} c="dimmed">—</Table.Td>;
  return (
    <>
      <Table.Td ta="right" className="lv-num">
        {fmt(f.areaHa, 2)} ha
        <Text size="xs" c="dimmed">
          {f.interventions} intervention{f.interventions > 1 ? "s" : ""}
        </Text>
      </Table.Td>
      <Table.Td ta="right" className="lv-num">
        {f.stockQuantity !== null && unit ? `${fmt(f.stockQuantity, 3)} ${stockUnitLabel({ unit, unitDim: null, sheet: null })}` : f.kg !== null ? `${fmt(f.kg, 0)} kg` : "—"}
        {f.stockQuantity !== null && unit && f.kg !== null && stockUnitLabel({ unit, unitDim: null, sheet: null }) !== "kg" && (
          <Text size="xs" c="dimmed">
            {fmt(f.kg, 0)} kg
          </Text>
        )}
      </Table.Td>
      <Table.Td ta="right" className="lv-num" aria-label={`Dose ${label}`}>
        {rangeLabel(f.kgPerHa)}
      </Table.Td>
      <Table.Td ta="right" className="lv-num">
        {rangeLabel(f.grainsPerM2)}
        {(f.estimated || f.unconvertible > 0) && (
          <Group gap={4} justify="flex-end" mt={2}>
            {f.estimated && (
              <Badge size="xs" variant="light" color="gray" title="PMG repère de l'espèce : valeurs estimées">
                estimé
              </Badge>
            )}
            {f.unconvertible > 0 && (
              <Badge size="xs" variant="light" color="paille" title="PMG inconnu ou unité illisible">
                {f.unconvertible} non convertible{f.unconvertible > 1 ? "s" : ""}
              </Badge>
            )}
          </Group>
        )}
      </Table.Td>
    </>
  );
}

/**
 * Utilisation des semences d'une campagne (lot SE7, FR-SE-24 à 27) : par
 * semence ou par espèce (variétés comparées), réalisé et prévu ; dose
 * moyenne pondérée par la surface et écart entre parcelles ; export CSV.
 */
export function UsagePanel({ years, year, onYear, onOpen }: { years: number[]; year: number; onYear: (y: number) => void; onOpen: (articleId: string) => void }) {
  const farm = useFarm();
  const [by, setBy] = useState<SeedUsageBy>("article");
  const usage = useSeedUsage(farm.id, year, by);
  const exportCsv = async () => {
    try {
      const blob = await api.download(farmPath(farm.id, `/seeds/usage?campaign=${year}&by=${by}&format=csv`));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `semences-${year}${by === "species" ? "-par-espece" : ""}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifications.show({ color: "brique", title: "Export impossible", message: String(e) });
    }
  };
  const groups = usage.data?.groups ?? [];
  const name = (g: SeedUsageGroup) =>
    by === "article" ? (
      <Anchor component="button" size="sm" fw={500} onClick={() => onOpen(g.key)}>
        {g.label}
      </Anchor>
    ) : (
      <>
        <Text size="sm" fw={500}>
          {g.label}
        </Text>
        <Text size="xs" c="dimmed">
          {g.articles.map((a) => a.name).join(", ")}
        </Text>
      </>
    );
  return (
    <Stack>
      <Group gap="sm" align="flex-end">
        <Select
          aria-label="Campagne de l'utilisation"
          data={years.map((y) => ({ value: String(y), label: `Campagne ${y}` }))}
          value={String(year)}
          onChange={(v) => v && onYear(Number(v))}
          allowDeselect={false}
          w={170}
        />
        <SegmentedControl
          aria-label="Regrouper"
          value={by}
          onChange={(v) => setBy(v as SeedUsageBy)}
          data={[
            { value: "article", label: "Par semence" },
            { value: "species", label: "Par espèce" },
          ]}
        />
        <Button variant="light" leftSection={<Download size={16} />} onClick={exportCsv} disabled={!groups.length}>
          Exporter en CSV
        </Button>
      </Group>
      {usage.isLoading && <Loading />}
      {usage.error && <ErrorAlert error={usage.error} />}
      {usage.isSuccess && !groups.length && (
        <Text size="sm" c="dimmed">
          Aucun semis réalisé ou prévu pour la campagne {year}.
        </Text>
      )}
      {groups.length > 0 && (
        <Table.ScrollContainer minWidth={900}>
          <Table fz="sm" striped aria-label={`Utilisation des semences, campagne ${year}`}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th rowSpan={2}>{by === "article" ? "Semence" : "Espèce"}</Table.Th>
                <Table.Th colSpan={4} ta="center">
                  Réalisé
                </Table.Th>
                <Table.Th colSpan={4} ta="center">
                  Prévu
                </Table.Th>
                <Table.Th rowSpan={2}>Activités</Table.Th>
              </Table.Tr>
              <Table.Tr>
                {["réalisé", "prévu"].flatMap((s) => [
                  <Table.Th key={`${s}-a`} ta="right">
                    Surface
                  </Table.Th>,
                  <Table.Th key={`${s}-q`} ta="right">
                    Quantité
                  </Table.Th>,
                  <Table.Th key={`${s}-k`} ta="right">
                    kg/ha
                  </Table.Th>,
                  <Table.Th key={`${s}-g`} ta="right">
                    grains/m²
                  </Table.Th>,
                ])}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((g) => (
                <Table.Tr key={g.key}>
                  <Table.Td>{name(g)}</Table.Td>
                  <Figures f={g.done} unit={g.unit} label={`réalisée de ${g.label}`} />
                  <Figures f={g.planned} unit={g.unit} label={`prévue de ${g.label}`} />
                  <Table.Td>
                    <Text size="xs">{g.activities.join(", ") || "—"}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="xs" c="dimmed">
        Dose et densité : moyenne pondérée par la surface, entre parenthèses l'écart entre parcelles. Les interventions prévues préparent les commandes ; « estimé » :
        calculé avec le PMG repère de l'espèce.
      </Text>
    </Stack>
  );
}
