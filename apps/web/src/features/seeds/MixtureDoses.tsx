import { useEffect } from "react";
import { Anchor, Badge, Group, NumberInput, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { Link, useLocation } from "react-router";
import { tgwReference } from "@fourmy/certification-refs";
import type { MixtureComponent, MixtureDose } from "@fourmy/contracts";
import { grainsPerM2, mixtureTotal } from "@fourmy/domain";
import { formatDate } from "../../app/labels";
import { fmt } from "./labels";
import { legumeShare } from "./MixtureEditor";
import { useSeedMixture } from "./queries";

/** Doses proposées : celles du dernier semis, rapportées aux espèces actuelles du mélange. */
function proposed(components: MixtureComponent[], last: MixtureDose[] | undefined): MixtureDose[] {
  return components.map((c) => {
    const prev = last?.find((d) => d.componentId === c.id) ?? last?.find((d) => d.label.toLowerCase() === c.label.toLowerCase());
    return { componentId: c.id, label: c.label, species: c.species, kgHa: prev?.kgHa ?? 0 };
  });
}

/** Densité d'après le PMG repère de l'espèce (FR-SE-15) : « ≈ 40 grains/m² ». */
const densityOf = (d: MixtureDose) => {
  const ref = tgwReference(d.species);
  const g = ref ? grainsPerM2(d.kgHa, ref.typicalG) : null;
  return g === null || !d.kgHa ? null : `≈ ${fmt(g, 0)} grains/m² (PMG repère ${ref!.source.org})`;
};

/**
 * Doses d'un mélange au semis (lot SE6, FR-SE-13b, S7) : une dose en kg/ha
 * par espèce, la dose du mélange en est la somme. Les doses du dernier semis
 * du même mélange sont proposées.
 */
export function MixtureDoses({
  farmId,
  articleId,
  value,
  onChange,
}: {
  farmId: string;
  articleId: string;
  value: MixtureDose[] | undefined;
  onChange: (doses: MixtureDose[]) => void;
}) {
  const location = useLocation();
  const mixture = useSeedMixture(farmId, articleId);
  const components = mixture.data?.components ?? [];
  useEffect(() => {
    if (value === undefined && mixture.data?.components.length) onChange(proposed(mixture.data.components, mixture.data.last?.doses));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixture.data, value === undefined]);

  if (mixture.isLoading) return null;
  if (!components.length) {
    return (
      <Text size="xs" c="dimmed">
        Espèces du mélange non décrites : la dose se saisit pour le mélange entier.{" "}
        <Anchor component={Link} to={`/f/${farmId}/seeds${location.search}`} size="xs">
          Décrire le mélange
        </Anchor>
      </Text>
    );
  }
  const doses = value ?? [];
  const legume = (d: MixtureDose) => !!components.find((c) => c.id === d.componentId)?.legume;
  const dosed = doses.filter((d) => d.kgHa > 0);
  const set = (i: number, kgHa: number) => onChange(doses.map((d, j) => (j === i ? { ...d, kgHa } : d)));
  return (
    <Paper withBorder p="xs" aria-label="Doses du mélange">
      <Stack gap={6}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing={4}>
          {doses.map((d, i) => (
            <Stack key={d.componentId ?? d.label} gap={0}>
              <NumberInput
                size="xs"
                label={
                  <Group gap={4} component="span">
                    {d.label}
                    {legume(d) && (
                      <Badge size="xs" variant="light" color="lichen" component="span">
                        Légumineuse
                      </Badge>
                    )}
                  </Group>
                }
                aria-label={`Dose de ${d.label}`}
                suffix=" kg/ha"
                decimalSeparator=","
                decimalScale={2}
                min={0}
                max={1000}
                value={d.kgHa || ""}
                onChange={(v) => set(i, v === "" ? 0 : Number(v))}
              />
              {densityOf(d) && (
                <Text size="xs" c="dimmed" className="lv-num">
                  {densityOf(d)}
                </Text>
              )}
            </Stack>
          ))}
        </SimpleGrid>
        <Text size="xs" c="dimmed" className="lv-num">
          Dose du mélange : {fmt(mixtureTotal(dosed), 2)} kg/ha
          {dosed.length ? ` · ${legumeShare(dosed.filter(legume).length, dosed.length)} (${fmt(mixtureTotal(dosed.filter(legume)), 2)} kg/ha)` : ""}
          {mixture.data?.last ? ` · doses du semis du ${formatDate(mixture.data.last.startedAt)} proposées` : ""}
        </Text>
      </Stack>
    </Paper>
  );
}

/** Doses d'un mélange semé, sous l'intrant de la fiche d'intervention. */
export function MixtureLine({ doses }: { doses: MixtureDose[] }) {
  return (
    <Text size="xs" c="dimmed" className="lv-num" aria-label="Doses du mélange">
      {doses.map((d) => `${d.label} ${fmt(d.kgHa, 2)} kg/ha`).join(" · ")}
    </Text>
  );
}
