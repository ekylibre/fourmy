import { useMemo } from "react";
import { Link } from "react-router";
import { Alert, Badge, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { WORK_RATE_SOURCE_LABELS, getProcedure, type CropPlanContext, type WorkRateSource } from "@fourmy/contracts";
import { workload, type WorkloadItem, type WorkloadLine } from "@fourmy/domain";
import { useFarm } from "../../app/farm";
import type { CropPlanEditor } from "../crop-plan/useCropPlanEditor";
import { fmtH, useItkWorkContext } from "./work";

/**
 * Récapitulatif de l'assolement, section « Travaux » (lot IT4, FR-AS-23 et
 * FR-AS-25) : heures au champ et sur la route, kilomètres, cumuls par
 * personne et par matériel, pointes par semaine, inconnus. Calculé sur le
 * brouillon, d'après l'itinéraire technique de chaque culture.
 */
export function WorkPanel({ editor, context }: { editor: CropPlanEditor; context: CropPlanContext }) {
  const farm = useFarm();
  const q = useItkWorkContext(farm.id, context.year);
  const items = useMemo<WorkloadItem[]>(() => {
    const out: WorkloadItem[] = [];
    for (const a of editor.draft.assignments) {
      if (!a.itineraryId) continue;
      const parcel = editor.plan.byKey.get(a.key);
      if (!parcel) continue;
      const activity = context.activities.find((x) => x.id === a.activityId);
      // Un morceau de découpe part du trajet de sa parcelle d'origine principale.
      const origin = [...parcel.origins].sort((x, y) => y.share - x.share)[0];
      out.push({
        id: a.id,
        parcelKey: a.key,
        routeKey: a.key.startsWith("p:") ? a.key : origin ? `p:${origin.parcelId}` : null,
        areaM2: parcel.areaM2,
        activityId: a.activityId,
        itineraryId: a.itineraryId,
        sowingOn: a.startedOn ?? activity?.defaultStartedOn ?? null,
        harvestOn: a.stoppedOn ?? activity?.defaultStoppedOn ?? null,
        year: context.year,
      });
    }
    return out;
  }, [editor.draft.assignments, editor.plan, context]);
  const result = useMemo(
    () =>
      q.data
        ? workload(items, q.data, {
            activities: new Map(context.activities.map((a) => [a.id, a.name])),
            procedures: (p) => getProcedure(p).label,
          })
        : null,
    [items, q.data, context.activities],
  );

  if (q.isLoading) return <Loader size="sm" />;
  if (q.error) return <Alert color="red">{(q.error as Error).message}</Alert>;
  const without = editor.draft.assignments.filter((a) => a.role === "main" && !a.itineraryId).length;
  if (!items.length || !result)
    return (
      <Alert color="gray">
        Aucune culture n'a d'itinéraire technique : choisissez-en un à l'affectation pour estimer les temps de travaux.{" "}
        <Text component={Link} to={`/f/${farm.id}/itineraries`} c="lichen" inherit>
          Itinéraires techniques
        </Text>
      </Alert>
    );
  const over = result.weeks.filter((w) => w.over);
  const sources = Object.entries(result.rateSources) as [WorkRateSource, number][];
  return (
    <Stack gap="sm" aria-label="Temps de travaux">
      <Group gap="xl">
        <Text size="sm">
          Au champ : <b className="lv-num">{fmtH(result.fieldH)}</b>
        </Text>
        <Text size="sm">
          Sur la route : <b className="lv-num">{fmtH(result.routeH)}</b> ({result.km.toLocaleString("fr-FR")} km)
        </Text>
        {without > 0 && (
          <Text size="sm" c="dimmed">
            {without} culture(s) sans itinéraire, non comptée(s)
          </Text>
        )}
      </Group>
      <Group gap="xs">
        {sources.map(([s, n]) => (
          <Badge key={s} variant="light" color={s === "input" ? "gray" : s === "observed" ? "lichen" : "ardoise"}>
            {n} débit(s) {WORK_RATE_SOURCE_LABELS[s]}
          </Badge>
        ))}
        {result.unknown.rates > 0 && (
          <Badge variant="light" color="orange">
            {result.unknown.rates} débit(s) inconnu(s)
          </Badge>
        )}
        {result.unknown.dates > 0 && (
          <Badge variant="light" color="orange">
            {result.unknown.dates} passage(s) sans date
          </Badge>
        )}
        {result.unknown.routes > 0 && (
          <Badge variant="light" color="orange">
            {result.unknown.routes} trajet(s) inconnu(s)
          </Badge>
        )}
      </Group>
      {!q.data!.site && <Alert color="orange">Siège non localisé (Ma ferme) : les trajets ne sont pas comptés.</Alert>}
      {Object.values(q.data!.routes).some((r) => r.method === "estimate") && (
        <Text size="xs" c="dimmed">
          Trajets estimés à vol d'oiseau (× 1,3, 25 km/h) quand le calcul d'itinéraire routier n'est pas disponible.
        </Text>
      )}

      <Paper withBorder p="sm">
        <Title order={5} mb="xs">
          Main-d'œuvre par semaine
        </Title>
        <BarChart
          h={200}
          data={result.weeks.map((w) => ({ semaine: w.week.slice(5), heures: w.hours }))}
          dataKey="semaine"
          series={[{ name: "heures", label: "Heures", color: "lichen.6" }]}
          referenceLines={[{ y: result.weeks[0]?.capacity ?? 0, label: "Capacité", color: "brique.6" }]}
          valueFormatter={(v) => fmtH(v)}
          gridAxis="y"
          tickLine="none"
          aria-label="Heures de main-d'œuvre prévues par semaine"
        />
        <Text size="xs" c={over.length ? "brique" : "dimmed"} mt="xs">
          {over.length
            ? `Pointes au-dessus de la capacité (${q.data!.people.length || 1} personne(s) × ${q.data!.settings.weeklyHoursPerPerson} h) : ${over.map((w) => `${w.week.slice(5)} (${fmtH(w.hours)})`).join(", ")}.`
            : `Capacité : ${q.data!.people.length || 1} personne(s) × ${q.data!.settings.weeklyHoursPerPerson} h par semaine.`}
        </Text>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Lines title="Par personne" lines={result.byPerson} />
        <Lines title="Par matériel" lines={result.byEquipment} />
        <ByActivity lines={result.byActivity} previous={q.data!.previousHoursByActivity ?? {}} year={context.year} />
        <Lines title="Par intervention" lines={result.byProcedure} />
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        Débits : saisi dans l'étape, sinon observé sur vos chantiers, sinon {q.data!.rateSource}. Un aller-retour par journée de {q.data!.settings.workdayHours} h de chantier.
      </Text>
    </Stack>
  );
}

function Lines({ title, lines }: { title: string; lines: WorkloadLine[] }) {
  return (
    <Paper withBorder p="sm">
      <Title order={5} mb={4}>
        {title}
      </Title>
      {lines.length === 0 ? (
        <Text size="sm" c="dimmed">
          —
        </Text>
      ) : (
        <Table verticalSpacing={2} aria-label={title}>
          <Table.Tbody>
            {lines.map((l) => (
              <Table.Tr key={`${l.id ?? l.name}`}>
                <Table.Td>
                  <Text size="sm" c={l.id ? undefined : "dimmed"}>
                    {l.name}
                  </Text>
                </Table.Td>
                <Table.Td ta="right" className="lv-num" style={{ whiteSpace: "nowrap" }}>
                  {fmtH(l.hours)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Paper>
  );
}

/** Par activité : heures prévues, et heures réalisées de la campagne précédente quand il y en a (lot IT6). */
function ByActivity({ lines, previous, year }: { lines: WorkloadLine[]; previous: Record<string, number>; year: number }) {
  const any = lines.some((l) => l.id && previous[l.id]);
  return (
    <Paper withBorder p="sm">
      <Title order={5} mb={4}>
        Par activité
      </Title>
      <Table verticalSpacing={2} aria-label="Par activité">
        {any && (
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th ta="right">{year} prévu</Table.Th>
              <Table.Th ta="right">{year - 1} réalisé</Table.Th>
            </Table.Tr>
          </Table.Thead>
        )}
        <Table.Tbody>
          {lines.map((l) => (
            <Table.Tr key={l.id ?? l.name}>
              <Table.Td>
                <Text size="sm">{l.name}</Text>
              </Table.Td>
              <Table.Td ta="right" className="lv-num" style={{ whiteSpace: "nowrap" }}>
                {fmtH(l.hours)}
              </Table.Td>
              {any && (
                <Table.Td ta="right" className="lv-num" style={{ whiteSpace: "nowrap" }}>
                  {l.id && previous[l.id] ? fmtH(previous[l.id]!) : "—"}
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
