import { useMemo } from "react";
import { Alert, Badge, Group, Loader, Stack, Table, Text } from "@mantine/core";
import { unitLabel, type CropPlanContext, type InputNeedLine } from "@fourmy/contracts";
import { inputNeeds, type NeedsItem } from "@fourmy/domain";
import { useFarm } from "../../app/farm";
import { ARTICLE_KIND_LABELS } from "../../app/labels";
import type { CropPlanEditor } from "../crop-plan/useCropPlanEditor";
import { useItkInputsContext, useItkWorkContext } from "./work";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: n < 10 ? 2 : 0 });
const qty = (n: number, unit: string) => `${fmt(n)} ${unitLabel(unit)}`;
const SOURCE: Record<string, string> = { itk: "itinéraire", plan: "plan de fumure" };

/**
 * Récapitulatif de l'assolement, section « Intrants » (lot IT5, FR-AS-24) :
 * besoins par article d'après les itinéraires et les plans de fumure
 * établis, comparés au stock disponible moins ce que réservent les
 * interventions prévues saisies à la main.
 */
export function InputsPanel({ editor, context }: { editor: CropPlanEditor; context: CropPlanContext }) {
  const farm = useFarm();
  const work = useItkWorkContext(farm.id, context.year, { routes: false });
  const inputs = useItkInputsContext(farm.id, context.year);
  const items = useMemo<NeedsItem[]>(
    () =>
      editor.draft.assignments
        .filter((a) => editor.plan.byKey.has(a.key))
        .map((a) => {
          const activity = context.activities.find((x) => x.id === a.activityId);
          return {
            parcelKey: a.key,
            areaM2: editor.plan.byKey.get(a.key)!.areaM2,
            itineraryId: a.itineraryId ?? null,
            sowingOn: a.startedOn ?? activity?.defaultStartedOn ?? null,
            harvestOn: a.stoppedOn ?? activity?.defaultStoppedOn ?? null,
            year: context.year,
          };
        }),
    [editor.draft.assignments, editor.plan, context],
  );
  const lines = useMemo(() => (work.data && inputs.data ? inputNeeds(items, work.data.itineraries, inputs.data) : null), [items, work.data, inputs.data]);

  if (work.isLoading || inputs.isLoading) return <Loader size="sm" />;
  if (work.error || inputs.error) return <Alert color="red">{((work.error ?? inputs.error) as Error).message}</Alert>;
  if (!lines?.length)
    return <Alert color="gray">Aucun besoin : choisissez un itinéraire technique (avec ses intrants) pour les cultures, ou établissez leur plan de fumure.</Alert>;
  const toBuy = lines.filter((l) => (l.toBuy ?? 0) > 0).length;
  const plans = Object.keys(inputs.data!.plans).length;
  const kinds = [...new Set(lines.map((l) => l.kind))];
  return (
    <Stack gap="sm" aria-label="Besoins en intrants">
      <Group gap="xs">
        <Badge variant="light" color={toBuy ? "paille" : "lichen"}>
          {toBuy ? `${toBuy} article(s) à acheter` : "Stock suffisant"}
        </Badge>
        {plans > 0 && (
          <Badge variant="light" color="ardoise">
            {plans} plan(s) de fumure établi(s) : prioritaires sur l'azote minéral des itinéraires
          </Badge>
        )}
        {lines.some((l) => l.unconvertible) && (
          <Badge variant="light" color="orange">
            doses non converties (PMG, densité ou unité à compléter)
          </Badge>
        )}
      </Group>
      {lines.some((l) => (l.stock ?? 0) < 0) && (
        <Alert color="orange" p="xs">
          Des stocks sont négatifs (sorties sans entrées, souvent une reprise d'historique) : ils comptent pour zéro dans « à acheter ». Corrigez-les dans Stocks.
        </Alert>
      )}
      <Table.ScrollContainer minWidth={380} type="native">
      <Table verticalSpacing={4} aria-label="Intrants à prévoir">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Intrant</Table.Th>
            <Table.Th ta="right">Besoin</Table.Th>
            <Table.Th ta="right">Disponible</Table.Th>
            <Table.Th ta="right">À acheter</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {kinds.map((k) => (
            <KindRows key={k} label={ARTICLE_KIND_LABELS[k] ?? k} lines={lines.filter((l) => l.kind === k)} />
          ))}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>
      <Text size="xs" c="dimmed">
        Stock au {new Date(`${inputs.data!.at}T12:00:00Z`).toLocaleDateString("fr-FR")}, dans l'unité de chaque article ; « réservé » : interventions prévues saisies à la main sur la
        campagne. Un intrant générique ou un apport du plan sans engrais choisi n'est pas comparé au stock.
      </Text>
    </Stack>
  );
}

function KindRows({ label, lines }: { label: string; lines: InputNeedLine[] }) {
  return (
    <>
      <Table.Tr>
        <Table.Td colSpan={4} bg="var(--mantine-color-default-hover)">
          <Text size="sm" fw={600}>
            {label}
          </Text>
        </Table.Td>
      </Table.Tr>
      {lines.map((l) => {
        const negative = (l.stock ?? 0) < 0;
        const available = l.stock === null ? null : Math.max(0, l.stock) - (l.reserved ?? 0);
        return (
          <Table.Tr key={`${l.articleId ?? l.label}|${l.unit}`}>
            <Table.Td>
              <Group gap={6} wrap="wrap">
                <Text size="sm" c={l.articleId ? undefined : "dimmed"}>
                  {l.label}
                </Text>
                {l.unconvertible && (
                  <Badge size="xs" color="orange" variant="light">
                    non converti
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {l.sources.map((s) => SOURCE[s]).join(", ")}
              </Text>
            </Table.Td>
            <Table.Td ta="right" className="lv-num">
              {l.needed ? qty(l.needed, l.unit) : "—"}
              {l.optional > 0 && (
                <Text size="xs" c="dimmed">
                  + {qty(l.optional, l.unit)} si besoin
                </Text>
              )}
            </Table.Td>
            <Table.Td ta="right" className="lv-num">
              {available === null ? (
                ""
              ) : (
                <Text size="sm" inherit c={negative ? "orange" : undefined} title={`Stock ${qty(l.stock!, l.unit)}${l.reserved ? `, réservé ${qty(l.reserved, l.unit)}` : ""}`}>
                  {qty(Math.max(0, available), l.unit)}
                  {(negative || l.reserved) && (
                    <Text size="xs" c={negative ? "orange" : "dimmed"}>
                      {negative ? `stock ${qty(l.stock!, l.unit)}` : `réservé ${qty(l.reserved!, l.unit)}`}
                    </Text>
                  )}
                </Text>
              )}
            </Table.Td>
            <Table.Td ta="right" className="lv-num">
              {l.toBuy === null ? "" : l.toBuy > 0 ? (
                <Text span c="brique" fw={600} inherit>
                  {qty(l.toBuy, l.unit)}
                </Text>
              ) : (
                "couvert"
              )}
            </Table.Td>
          </Table.Tr>
        );
      })}
    </>
  );
}
