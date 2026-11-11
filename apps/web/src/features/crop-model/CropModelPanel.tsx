import "@mantine/charts/styles.css";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Badge, Button, Group, NumberInput, Paper, SimpleGrid, Stack, Switch, Text, Title } from "@mantine/core";
import { LineChart } from "@mantine/charts";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TAW_RANGE, type CropModelDay, type ParcelCropState } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";
import { BASIS_LABELS, irrigationLink, stageWhen, useParcelCropModel } from "./crop-model";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Lignes du graphique : réserve observée et réserve prévue (prévision puis normales) en deux séries, raccordées. */
export function reserveRows(days: CropModelDay[]) {
  const firstAhead = days.findIndex((d) => d.basis !== "observed");
  return days.map((d, i) => ({
    date: d.date,
    observee: d.basis === "observed" || i === firstAhead - 1 ? Math.round(d.reserve * 100) : undefined,
    prevue: d.basis !== "observed" || i === firstAhead - 1 ? Math.round(d.reserve * 100) : undefined,
  }));
}

/**
 * Modèle de croissance de la parcelle (lot AB, FR-TWIN-8) : stade du jour,
 * dates des stades (observées, prévues ou d'après les normales), réserve en
 * eau du sol et stress hydrique (ou besoin d'irrigation), réserve utile
 * modifiable par le responsable.
 */
export function CropModelPanel({ farmId, parcelId, owner }: { farmId: string; parcelId: string; owner: boolean }) {
  const { day } = useAt();
  const q = useParcelCropModel(farmId, parcelId, day);
  const rows = useMemo(() => reserveRows(q.data?.days ?? []), [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const data = q.data!;
  if (!data.state) {
    const text =
      data.reason === "no_model"
        ? "Pas encore de modèle pour cette culture : le maïs et les céréales à paille sont modélisés pour l'instant."
        : data.reason === "weather_missing"
          ? "Météo indisponible : Open-Meteo ne répond pas et rien n'est en cache."
          : "Aucun semis réalisé saisi dans les 400 jours qui précèdent : le modèle part de la date de semis.";
    return (
      <Paper withBorder p="md" aria-label="Modèle de croissance">
        <Title order={4} mb={4}>
          Modèle de croissance
        </Title>
        <Text size="sm" c="dimmed">
          {text}
        </Text>
      </Paper>
    );
  }
  const s = data.state;
  const ticks = rows.filter((r) => r.date.endsWith("-01")).map((r) => r.date);
  return (
    <Paper withBorder p="md" aria-label="Modèle de croissance">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={4}>
            Modèle de croissance · {s.modelLabel}, semé le {formatDate(s.sownOn)}
          </Title>
          <Text size="sm" c="dimmed">
            Stades par degrés-jours depuis le semis, bilan hydrique FAO-56. Météo Open-Meteo (observée, prévue à 16 jours, puis normales des 5 années
            précédentes).
          </Text>
        </div>
        <Badge size="lg" variant="light" tt="none" color={s.stage?.code === "ended" ? "gray" : "lichen"}>
          {s.stage ? s.stage.label : "Semé, pas encore levé"}
          {s.gdd !== null && s.stage?.code !== "ended" ? ` · ${s.gdd} °Cj` : ""}
        </Badge>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, md: s.stages.length }} spacing="xs" mb="sm" aria-label="Stades">
        {s.stages.map((st) => {
          const reached = st.on !== null && st.on <= day;
          return (
            <Paper key={st.code} withBorder p="xs" bg={reached ? "var(--mantine-color-lichen-0)" : undefined}>
              <Text size="xs" fw={600}>
                {st.label}
              </Text>
              <Text size="sm">{stageWhen(st, day)}</Text>
              <Text size="xs" c="dimmed">
                {st.gdd} °Cj{st.on && st.basis !== "observed" ? ` · ${BASIS_LABELS[st.basis!]}` : ""}
              </Text>
            </Paper>
          );
        })}
      </SimpleGrid>

      {s.water && <WaterSummary state={s} />}
      {s.water && <IrrigateButton farmId={farmId} parcelId={parcelId} day={day} />}

      {rows.length > 1 && (
        <LineChart
          h={220}
          mt="sm"
          data={rows}
          dataKey="date"
          withDots={false}
          connectNulls={false}
          withLegend
          legendProps={{ verticalAlign: "bottom" }}
          yAxisProps={{ domain: [0, 100], ticks: [0, 25, 50, 75, 100] }}
          xAxisProps={{ ticks, tickFormatter: (d: string) => MONTH.format(new Date(`${d}T00:00:00Z`)) }}
          valueFormatter={(v) => `${v} %`}
          tooltipProps={{ labelFormatter: (d) => (typeof d === "string" ? DAY.format(new Date(`${d}T00:00:00Z`)) : d) }}
          referenceLines={[
            // Irrigations saisies : un trait par apport.
            ...(data.days.filter((d) => d.appliedMm > 0).map((d) => ({ x: d.date, color: "ardoise.3", strokeDasharray: "2 3" }))),
            ...(s.water ? [{ y: Math.round(s.water.stressBelow * 100), label: "Seuil de stress", color: "brique.5", labelPosition: "insideTopRight" as const }] : []),
            { x: day, label: "Date de la frise", color: "ardoise.5" },
          ]}
          series={[
            { name: "observee", label: "Eau disponible (météo observée)", color: "ardoise.7" },
            { name: "prevue", label: "Eau disponible (prévue)", color: "ardoise.4", strokeDasharray: "5 4" },
          ]}
          lineProps={{ isAnimationActive: false }}
        />
      )}
      <SoilEditor farmId={farmId} parcelId={parcelId} owner={owner} state={s} />
    </Paper>
  );
}

function IrrigateButton({ farmId, parcelId, day }: { farmId: string; parcelId: string; day: string }) {
  const location = useLocation();
  return (
    <Button component={Link} to={irrigationLink(farmId, parcelId, day, location.search)} size="compact-sm" variant="light" mt="xs">
      Saisir une irrigation
    </Button>
  );
}

function WaterSummary({ state: s }: { state: ParcelCropState }) {
  const w = s.water!;
  if (s.waterSupply === "ideal") {
    return (
      <Stack gap={4}>
        <Text size="sm">
          Parcelle irriguée : besoin d'irrigation simulé depuis le semis <b>{w.irrigationMm} mm</b> (apport dès que la réserve facilement utilisable est
          épuisée). Eau disponible : {pct(w.reserve)} de {w.tawMm} mm.
        </Text>
        <Text size="xs" c="dimmed">
          Aucune irrigation saisie cette saison : le modèle suppose un pilotage idéal. Saisissez vos irrigations pour qu'il suive les apports réels.
        </Text>
      </Stack>
    );
  }
  const stressed = w.ks < 1;
  return (
    <Stack gap={4}>
      {s.waterSupply === "recorded" && (
        <Text size="sm">
          Irrigations saisies : <b>{w.appliedMm} mm</b> en {w.appliedDays} apport{w.appliedDays > 1 ? "s" : ""}
          {w.lastAppliedOn ? `, le dernier le ${formatDate(w.lastAppliedOn)}` : ""}.
        </Text>
      )}
      <Text size="sm">
        Eau disponible : <b>{pct(w.reserve)}</b> de la réserve accessible aux racines ({w.tawMm} mm){stressed ? " : la culture est en stress hydrique" : ""}.{" "}
        {w.stressDays > 0 && (
          <>
            {w.stressDays} jour{w.stressDays > 1 ? "s" : ""} de stress depuis la levée
            {w.floweringStressDays > 0 ? `, dont ${w.floweringStressDays} autour de la floraison (période la plus sensible)` : ""}.
          </>
        )}
      </Text>
      {w.stressDays > 0 && s.waterSupply === "rainfed" && (
        <Text size="xs" c="dimmed">
          Calcul en sec, sans irrigation saisie. Si la parcelle est irriguée, saisissez vos irrigations, ou déclarez-la irriguée : le modèle estimera alors le
          besoin d'irrigation au lieu d'un stress.
        </Text>
      )}
      {w.stressDays > 0 && s.waterSupply === "recorded" && (
        <Text size="xs" c="dimmed">
          Le stress tient compte de la pluie et des seules irrigations saisies : un apport oublié le fait apparaître à tort.
          {s.soil.irrigated ? " Au-delà d'aujourd'hui, le modèle prévoit les apports d'un pilotage idéal." : ""}
        </Text>
      )}
    </Stack>
  );
}

function SoilEditor({ farmId, parcelId, owner, state }: { farmId: string; parcelId: string; owner: boolean; state: ParcelCropState }) {
  const client = useQueryClient();
  const [edit, setEdit] = useState<{ tawMm: number; irrigated: boolean } | null>(null);
  const done = (message: string) => {
    setEdit(null);
    void client.invalidateQueries({ queryKey: ["crop-model", farmId] });
    void client.invalidateQueries({ queryKey: ["vegetation3d", farmId] });
    notifications.show({ color: "lichen", message });
  };
  const save = useMutation({
    mutationFn: (v: { tawMm: number; irrigated: boolean }) => api.put(farmPath(farmId, `/land-parcels/${parcelId}/soil`), v),
    onSuccess: () => done("Sol de la parcelle enregistré."),
  });
  const reset = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/land-parcels/${parcelId}/soil`)),
    onSuccess: () => done("Sol : retour aux valeurs par défaut."),
  });
  const soil = state.soil;
  return (
    <Group justify="space-between" mt="sm" aria-label="Sol de la parcelle">
      {edit ? (
        <Group align="flex-end">
          <NumberInput
            label="Réserve utile (mm)"
            min={TAW_RANGE.min}
            max={TAW_RANGE.max}
            step={10}
            value={edit.tawMm}
            onChange={(v) => setEdit({ ...edit, tawMm: Number(v) })}
            w={160}
          />
          <Switch label="Parcelle irriguée" checked={edit.irrigated} onChange={(e) => setEdit({ ...edit, irrigated: e.currentTarget.checked })} mb={8} />
          <Button onClick={() => save.mutate(edit)} loading={save.isPending}>
            Enregistrer
          </Button>
          <Button variant="subtle" onClick={() => setEdit(null)}>
            Annuler
          </Button>
        </Group>
      ) : (
        <>
          <Text size="sm">
            Réserve utile {soil.tawMm} mm · {soil.irrigated ? "irriguée" : "en sec"}{" "}
            <Text span size="xs" c="dimmed">
              ({soil.auto ? "par défaut" : "saisie"})
            </Text>
          </Text>
          {owner && (
            <Group gap="xs">
              <Button size="compact-sm" variant="light" onClick={() => setEdit({ tawMm: soil.tawMm, irrigated: soil.irrigated })}>
                Modifier le sol
              </Button>
              {!soil.auto && (
                <Button size="compact-sm" variant="subtle" color="gray" onClick={() => reset.mutate()} loading={reset.isPending}>
                  Revenir aux valeurs par défaut
                </Button>
              )}
            </Group>
          )}
        </>
      )}
    </Group>
  );
}
