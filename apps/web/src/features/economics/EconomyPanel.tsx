import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Accordion, Alert, Anchor, Badge, Group, Loader, Paper, SegmentedControl, Stack, Table, Text, Tooltip } from "@mantine/core";
import { MARGIN_POST_LABELS, type CropPlanContext, type CropPlanMargins, type MarginFigures, type MarginPost } from "@fourmy/contracts";
import { cropPlanMargins, realizedMargins, type MarginItem } from "@fourmy/domain";
import { useFarm } from "../../app/farm";
import type { CropPlanEditor } from "../crop-plan/useCropPlanEditor";
import { useItkInputsContext, useItkWorkContext } from "../itk/work";
import { useEcoContext, useEcoPrevious, usePriceHistoryAll } from "./queries";

const today = () => new Date().toISOString().slice(0, 10);
const euro = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const signed = (n: number) => `${n > 0 ? "+" : ""}${euro(n)}`;
type View = "total" | "perHa";
const COLUMNS: { key: keyof MarginFigures; label: string; post?: MarginPost; strong?: boolean }[] = [
  { key: "product", label: "Produit", post: "product" },
  { key: "operational", label: "Charges opérationnelles", post: "operational" },
  { key: "grossMargin", label: "Marge brute", strong: true },
  { key: "mechanisation", label: "Mécanisation", post: "mechanisation" },
  { key: "labour", label: "Main-d'œuvre", post: "labour" },
  { key: "directMargin", label: "Marge directe", strong: true },
];
const incompleteOf = (key: keyof MarginFigures, post: MarginPost | undefined, posts: readonly MarginPost[]) =>
  post ? posts.includes(post) : key === "grossMargin" ? posts.some((p) => p === "product" || p === "operational") : posts.length > 0;

/**
 * Onglet « Économie » de l'assolement (temps 3, lots E4 et E5, FR-AS-33) :
 * marges prévues par activité et pour l'assolement, en total ou à l'hectare,
 * à partir du brouillon (calcul dans le navigateur, principe E2), comparées à
 * la campagne précédente réalisée (récoltes, intrants, heures, aux prix du
 * jour de chaque intervention) ; postes incomplets signalés.
 */
export function EconomyPanel({ editor, context }: { editor: CropPlanEditor; context: CropPlanContext }) {
  const farm = useFarm();
  const [view, setView] = useState<View>("perHa");
  const day = today();
  const work = useItkWorkContext(farm.id, context.year);
  const inputs = useItkInputsContext(farm.id, context.year);
  const eco = useEcoContext(farm.id, context.year);
  const prices = usePriceHistoryAll(farm.id);
  const previous = useEcoPrevious(farm.id, context.year);

  const items = useMemo<MarginItem[]>(() => {
    const out: MarginItem[] = [];
    for (const a of editor.draft.assignments) {
      const parcel = editor.plan.byKey.get(a.key);
      if (!parcel) continue;
      const activity = context.activities.find((x) => x.id === a.activityId);
      const origin = [...parcel.origins].sort((x, y) => y.share - x.share)[0];
      out.push({
        id: a.id,
        parcelKey: a.key,
        routeKey: a.key.startsWith("p:") ? a.key : origin ? `p:${origin.parcelId}` : null,
        areaM2: parcel.areaM2,
        activityId: a.activityId,
        itineraryId: a.itineraryId ?? null,
        sowingOn: a.startedOn ?? activity?.defaultStartedOn ?? null,
        harvestOn: a.stoppedOn ?? activity?.defaultStoppedOn ?? null,
        year: context.year,
        ...(a.forecasts ? { forecasts: a.forecasts } : {}),
      });
    }
    return out;
  }, [editor.draft.assignments, editor.plan, context]);
  const result = useMemo(
    () => (work.data && inputs.data && eco.data && prices.data ? cropPlanMargins(items, { work: work.data, inputs: inputs.data, eco: eco.data, prices: prices.data.items, day }) : null),
    [items, work.data, inputs.data, eco.data, prices.data, day],
  );
  const realized = useMemo(
    () => (previous.data?.productions.length && work.data && eco.data && prices.data ? realizedMargins(previous.data, { work: work.data, eco: eco.data, prices: prices.data.items }) : null),
    [previous.data, work.data, eco.data, prices.data],
  );

  const error = work.error ?? inputs.error ?? eco.error ?? prices.error;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!result) return <Loader size="sm" />;
  if (!items.length) return <Alert color="gray">Affectez des cultures pour estimer les marges de l'assolement.</Alert>;
  const names = new Map(context.activities.map((a) => [a.id, a.name]));
  const without = result.activities.reduce((s, a) => s + a.withoutItinerary, 0);
  const prevYear = context.year - 1;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" c="dimmed">
          Marges prévues, hors taxes, aux prix en vigueur ; rendements et prix de vente saisis à l'affectation ou par défaut (voir le module Économique).
        </Text>
        <SegmentedControl
          size="xs"
          value={view}
          onChange={(v) => setView(v as View)}
          data={[
            { value: "perHa", label: "€/ha" },
            { value: "total", label: "Total" },
          ]}
          aria-label="Affichage des marges"
        />
      </Group>
      {without > 0 && (
        <Alert color="gray" p="xs">
          {without} culture(s) sans itinéraire technique : seul leur produit est compté (ni intrants, ni mécanisation, ni main-d'œuvre).
        </Alert>
      )}
      <MarginTable label="Marges par activité" result={result} names={names} view={view} previous={realized} previousYear={prevYear} />
      <MissingList farmId={farm.id} result={result} title="À compléter" />
      {realized ? (
        <Accordion variant="contained">
          <Accordion.Item value="previous">
            <Accordion.Control>
              Réalisé {prevYear} : marge directe {euro(view === "perHa" ? realized.total.perHa.directMargin : realized.total.directMargin)}
              {view === "perHa" ? "/ha" : ""}
              {realized.missing.length ? ` · ${realized.missing.length} manque(s)` : ""}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  Réalisé simplifié : récoltes enregistrées, intrants des interventions réalisées et heures (périodes de plus de 24 h écartées), aux prix en vigueur le jour de
                  chaque intervention ; prix de vente de la ferme à la fin de la campagne, sinon le prix par défaut.
                </Text>
                <MarginTable label={`Marges réalisées ${prevYear}`} result={realized} names={names} view={view} />
                <MissingList farmId={farm.id} result={realized} title={`Manques du réalisé ${prevYear}`} />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : previous.isLoading ? (
        <Text size="xs" c="dimmed">
          Chargement du réalisé {prevYear}…
        </Text>
      ) : previous.error ? (
        <Alert color="red" p="xs">
          Réalisé {prevYear} indisponible : {(previous.error as Error).message}
        </Alert>
      ) : (
        previous.data && (
          <Text size="xs" c="dimmed">
            Pas de culture en {prevYear} : pas de comparaison.
          </Text>
        )
      )}
    </Stack>
  );
}

function MarginTable({
  label,
  result,
  names,
  view,
  previous,
  previousYear,
}: {
  label: string;
  result: CropPlanMargins;
  names: Map<string, string>;
  view: View;
  previous?: CropPlanMargins | null;
  previousYear?: number;
}) {
  const pick = (f: MarginFigures & { perHa: MarginFigures }) => (view === "perHa" ? f.perHa : f);
  const prevOf = new Map((previous?.activities ?? []).map((a) => [a.activityId, a]));
  const compare = !!previous;
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={compare ? 960 : 760}>
        <Table verticalSpacing={4} aria-label={label}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Activité</Table.Th>
              <Table.Th ta="right">Surface</Table.Th>
              {COLUMNS.map((c) => (
                <Table.Th key={c.key} ta="right">
                  {c.label}
                </Table.Th>
              ))}
              {compare && (
                <>
                  <Table.Th ta="right">Marge directe {previousYear}</Table.Th>
                  <Table.Th ta="right">Écart</Table.Th>
                </>
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.activities.map((a) => {
              const p = prevOf.get(a.activityId);
              return (
                <Table.Tr key={a.activityId}>
                  <Table.Td>{names.get(a.activityId) ?? "Activité"}</Table.Td>
                  <Table.Td ta="right">{a.areaHa.toLocaleString("fr-FR")} ha</Table.Td>
                  {COLUMNS.map((c) => (
                    <Cell key={c.key} value={pick(a)[c.key]} strong={c.strong} incomplete={incompleteOf(c.key, c.post, a.incomplete)} />
                  ))}
                  {compare && <Compare current={pick(a).directMargin} previous={p ? pick(p).directMargin : null} incomplete={!!p?.incomplete.length || a.incomplete.length > 0} />}
                </Table.Tr>
              );
            })}
            <Table.Tr fw={700}>
              <Table.Td>Assolement</Table.Td>
              <Table.Td ta="right">{result.total.areaHa.toLocaleString("fr-FR")} ha</Table.Td>
              {COLUMNS.map((c) => (
                <Cell key={c.key} value={pick(result.total)[c.key]} strong incomplete={result.missing.some((m) => !c.post || m.post === c.post)} />
              ))}
              {compare && previous && (
                <Compare current={pick(result.total).directMargin} previous={pick(previous.total).directMargin} incomplete={result.missing.length > 0 || previous.missing.length > 0} />
              )}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

function Compare({ current, previous, incomplete }: { current: number; previous: number | null; incomplete: boolean }) {
  if (previous === null)
    return (
      <>
        <Table.Td ta="right">
          <Text size="sm" c="dimmed">
            —
          </Text>
        </Table.Td>
        <Table.Td />
      </>
    );
  const diff = current - previous;
  return (
    <>
      <Cell value={previous} incomplete={incomplete} />
      <Table.Td ta="right">
        <Text size="sm" c={incomplete ? "orange" : diff < 0 ? "brique" : "lichen"}>
          {signed(diff)}
          {incomplete ? " *" : ""}
        </Text>
      </Table.Td>
    </>
  );
}

function MissingList({ farmId, result, title }: { farmId: string; result: CropPlanMargins; title: string }) {
  if (!result.missing.length) return null;
  return (
    <Paper withBorder p="sm" aria-label={title}>
      <Text size="sm" fw={600} mb={4}>
        {title} ({result.missing.length}) : ces montants ne sont pas comptés
      </Text>
      <Stack gap={2}>
        {result.missing.map((m) => (
          <Group key={`${m.post}|${m.label}`} gap="xs" wrap="nowrap">
            <Badge size="xs" variant="light" color="orange">
              {MARGIN_POST_LABELS[m.post]}
            </Badge>
            <Text size="sm">
              {m.label} · {m.areaHa.toLocaleString("fr-FR")} ha
            </Text>
            {m.tab && (
              <Anchor size="sm" component={Link} to={`/f/${farmId}/economics?tab=${m.tab}`} target="_blank">
                Compléter
              </Anchor>
            )}
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

function Cell({ value, strong, incomplete }: { value: number; strong?: boolean; incomplete: boolean }) {
  const text = (
    <Text size="sm" fw={strong ? 600 : undefined} c={incomplete ? "orange" : value < 0 ? "brique" : undefined}>
      {euro(value)}
      {incomplete ? " *" : ""}
    </Text>
  );
  return (
    <Table.Td ta="right">
      {incomplete ? (
        <Tooltip label="Incomplet : un prix ou un rendement manque (voir « À compléter »)" withArrow>
          {text}
        </Tooltip>
      ) : (
        text
      )}
    </Table.Td>
  );
}
