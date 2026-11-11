import "@mantine/charts/styles.css";
import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { Alert, Anchor, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { CompositeChart } from "@mantine/charts";
import { ReferenceArea } from "recharts";
import { INDEX_SCALES, MIN_PARCEL_PIXELS, type ParcelIndexSeries } from "@fourmy/contracts";
import { useAt } from "../../app/at";
import { formatDate, procedureLabel } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { formatIndex, useParcelSeries, useRemoteSensingStatus, useVegetationIndex } from "./remote-sensing";
import { IndexLegend, IndexPicker } from "./SatelliteControl";
import { CoverLossBanner, useCoverLossAnomalies } from "./CoverLossAlerts";

const DAY_MS = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });

type Row = {
  date: string;
  mesure?: number;
  nuageux?: number;
  lisse?: number;
  reference?: number;
  bande?: [number, number];
};

/** Lignes du graphique : une par date présente dans l'une des séries (et par intervention, pour ses repères). */
export function chartRows(s: ParcelIndexSeries): Row[] {
  const rows = new Map<string, Row>();
  const row = (date: string) => {
    let r = rows.get(date);
    if (!r) rows.set(date, (r = { date }));
    return r;
  };
  for (const p of s.points) {
    if (p.mean === null) continue;
    const r = row(p.date);
    if (p.usable) {
      r.mesure = p.mean;
      if (p.p10 !== null && p.p90 !== null) r.bande = [p.p10, p.p90];
    } else r.nuageux = p.mean;
  }
  for (const p of s.smoothed) row(p.date).lisse = p.value;
  for (const p of s.reference) row(p.date).reference = p.median;
  for (const i of s.interventions) row(i.at);
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Onglet « Végétation » de la fiche parcelle (FR-TWIN-1 et 2) : indice choisi
 * (NDVI par défaut, NDRE ou NDMI) des 12 mois précédant la date de la frise,
 * lissé, comparé aux années précédentes, avec les interventions de la
 * parcelle en repères. Les récoltes probables (règle sur le NDVI) ne sont
 * tracées que sur la courbe du NDVI.
 */
export function VegetationTab({ farmId, parcelId }: { farmId: string; parcelId: string }) {
  const location = useLocation();
  const { day } = useAt();
  const from = shift(day, -364);
  const status = useRemoteSensingStatus(farmId);
  const [index, setIndex] = useVegetationIndex();
  const series = useParcelSeries(farmId, parcelId, from, day, index);
  const data = useMemo(() => (series.data ? chartRows(series.data) : []), [series.data]);
  const anomalies = useCoverLossAnomalies(farmId, from, day, status.data?.enabled ?? false);
  const mine = (anomalies.data?.items ?? []).filter((a) => a.parcelId === parcelId);

  if (status.isLoading || series.isLoading) return <Loading />;
  if (series.error) return <ErrorAlert error={series.error} />;
  const s = series.data!;
  const scale = INDEX_SCALES[s.index];
  const usable = s.points.filter((p) => p.usable);
  const last = usable[usable.length - 1];

  if (!status.data?.enabled && s.points.length === 0) {
    return (
      <Alert color="gray" title="Télédétection non configurée">
        Les indices de végétation de vos parcelles viennent des images Sentinel-2 (Copernicus, gratuit).{" "}
        <Anchor component={Link} to={`/f/${farmId}/integrations${location.search}`}>
          Configurer Copernicus
        </Anchor>
        .
      </Alert>
    );
  }
  if (s.tooSmall) {
    return (
      <Alert color="gray" title="Parcelle trop petite pour Sentinel-2">
        Une fois ses bords retirés (10 m, pixels mélangés avec les voisins), elle ne compte que {s.parcelPixels} pixel
        {s.parcelPixels > 1 ? "s" : ""} de 10 m ; il en faut au moins {MIN_PARCEL_PIXELS} pour une mesure fiable.
      </Alert>
    );
  }
  if (s.points.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Pas encore de mesure sur les 12 derniers mois.
      </Text>
    );
  }
  const areas = s.index === "ndvi" ? mine : [];
  // Axe au pas de 0,2 couvrant le domaine de l'indice (NDVI 0 à 1, NDRE 0 à 0,8, NDMI −0,4 à 0,6).
  const yLo = Math.floor(scale.domain[0] / 0.2 + 1e-9);
  const yHi = Math.ceil(scale.domain[1] / 0.2 - 1e-9);
  const yTicks = Array.from({ length: yHi - yLo + 1 }, (_, k) => Math.round((yLo + k) * 0.2 * 10) / 10);

  const ticks = data.filter((r) => r.date.endsWith("-01")).map((r) => r.date);
  return (
    <Stack>
      <CoverLossBanner farmId={farmId} items={mine} />
      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start" mb="sm">
          <div>
            <Title order={4}>
              {scale.label} du {formatDate(from)} au {formatDate(day)}
            </Title>
            <Text size="sm" c="dimmed">
              {usable.length} mesure{usable.length > 1 ? "s" : ""} exploitable{usable.length > 1 ? "s" : ""} sur {s.points.length} passages
              {last ? ` · dernière : ${formatIndex(last.mean)} le ${formatDate(last.date)}` : ""}
              {s.referenceYears.length ? ` · référence : ${s.referenceYears.join(", ")}` : ""}
            </Text>
          </div>
          <Stack gap="xs" style={{ width: 260 }}>
            <IndexPicker value={index} onChange={setIndex} />
            <IndexLegend index={s.index} />
          </Stack>
        </Group>
        <CompositeChart
          h={320}
          data={data}
          dataKey="date"
          curveType="monotone"
          connectNulls
          withDots={false}
          withLegend
          legendProps={{ verticalAlign: "bottom" }}
          yAxisProps={{ domain: [yTicks[0]!, yTicks[yTicks.length - 1]!], ticks: yTicks, tickFormatter: (v: number) => formatIndex(v).replace(/0$/, "") }}
          xAxisProps={{ ticks, tickFormatter: (d: string) => MONTH.format(new Date(`${d}T00:00:00Z`)) }}
          valueFormatter={(v) => (Array.isArray(v) ? v.map((x) => formatIndex(x)).join(" à ") : formatIndex(v))}
          tooltipProps={{ labelFormatter: (d) => (typeof d === "string" ? DAY.format(new Date(`${d}T00:00:00Z`)) : d) }}
          series={[
            { name: "bande", label: "p10–p90", color: "lichen.2", type: "area" },
            { name: "reference", label: "Années précédentes", color: "gray.5", type: "line", strokeDasharray: "5 4" },
            { name: "lisse", label: `${scale.label} lissé`, color: "lichen.7", type: "line" },
            { name: "mesure", label: "Mesure", color: "lichen.9", type: "line" },
            { name: "nuageux", label: "Nuageux (écarté)", color: "gray.4", type: "line" },
          ]}
          lineProps={(serie) =>
            serie.name === "mesure" || serie.name === "nuageux"
              ? { strokeWidth: 0, dot: { r: serie.name === "mesure" ? 3 : 2 }, activeDot: { r: 4 }, connectNulls: false, isAnimationActive: false }
              : { isAnimationActive: false }
          }
          areaProps={{ fillOpacity: 0.35, strokeWidth: 0, isAnimationActive: false }}
          referenceLines={s.interventions.map((i) => ({ x: i.at, label: procedureLabel(i.procedure), color: "ardoise.4", labelPosition: "insideTopLeft" }))}
        >
          {areas.map((a) => (
            <ReferenceArea key={a.to} x1={a.from} x2={a.to} fill="var(--mantine-color-paille-3)" fillOpacity={0.35} ifOverflow="extendDomain" label={{ value: "Récolte probable", position: "insideTop", fontSize: 11 }} />
          ))}
        </CompositeChart>
        <Text size="xs" c="dimmed" mt="xs">
          Une mesure est écartée quand moins de 80 % des pixels de la parcelle sont visibles (nuages, ombres). Les bords de la parcelle
          (10 m) ne sont pas mesurés. {s.attribution}.
        </Text>
      </Paper>
    </Stack>
  );
}
