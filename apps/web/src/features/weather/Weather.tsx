import { useEffect, useRef } from "react";
import { Anchor, Badge, Box, Button, Group, NumberInput, Paper, ScrollArea, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { Link } from "react-router";
import { sprayingPeriod } from "@fourmy/domain";
import { TrafficLight } from "../../components/TrafficLight";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { CloudRain, CloudSun, Droplets, RefreshCw, Thermometer, Wind } from "lucide-react";
import { WeatherIcon, weatherLabel } from "./WeatherIcon";
import type { InterventionWeather, SprayingForecast } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/**
 * Météo (lot 3) : pré-remplissage de la météo d'une intervention (MET-2) et
 * conditions de pulvérisation des prochains jours (MET-3). Les clés des
 * fournisseurs restent sur le serveur.
 */

export const SOURCES: Record<string, string> = {
  open_meteo: "Open-Meteo",
  openweather: "OpenWeather",
  meteoblue: "meteoblue",
  weenat: "station Weenat",
  sencrop: "station Sencrop",
  manual: "saisie",
};

export function weatherSourceLabel(w: Pick<InterventionWeather, "source" | "kind"> & { station?: InterventionWeather["station"] }): string {
  if (w.source === "manual" || w.kind === "manual") return "saisie à la main";
  const station = w.station ? ` « ${w.station.name} » à ${(w.station.distanceM / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km` : "";
  return `${SOURCES[w.source] ?? w.source}${station}, ${w.kind === "forecast" ? "prévision" : "observée"}`;
}

const fmt = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : n.toLocaleString("fr-FR", { maximumFractionDigits: digits }));

export interface WeatherRequestDraft {
  periods: { startedAt: string; stoppedAt: string }[];
  plannedAt?: string;
  targets: unknown[];
}

/**
 * Champs météo du formulaire : pré-remplis pour le lieu et les dates de
 * l'intervention (observée pour le passé, prévue pour l'avenir) ; une valeur
 * modifiée à la main passe la météo en « saisie » et n'est plus écrasée.
 */
export function WeatherFields({
  farmId,
  request,
  value,
  onChange,
}: {
  farmId: string;
  request: WeatherRequestDraft | null;
  value: InterventionWeather | null;
  onChange: (w: InterventionWeather | null) => void;
}) {
  // Debounce sur le contenu : la demande est recréée à chaque rendu du formulaire.
  const [debouncedText] = useDebouncedValue(request ? JSON.stringify(request) : null, 600);
  const debounced = debouncedText ? (JSON.parse(debouncedText) as WeatherRequestDraft) : null;
  const manual = value?.kind === "manual";
  const q = useQuery({
    queryKey: ["weather-intervention", farmId, debouncedText],
    enabled: !!debounced && (debounced.periods.length > 0 || !!debounced.plannedAt),
    queryFn: () => api.post<{ weather: InterventionWeather | null }>(farmPath(farmId, "/weather/intervention"), debounced),
    staleTime: 10 * 60_000,
    retry: false,
  });
  // Pré-remplissage tant que l'utilisateur n'a rien modifié.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const w = q.data?.weather;
    if (!w || manual) return;
    const key = JSON.stringify(w);
    if (applied.current === key) return;
    applied.current = key;
    onChange(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, manual]);

  const set = (patch: Partial<InterventionWeather>) =>
    onChange({
      source: "manual",
      kind: "manual",
      temperatureC: value?.temperatureC ?? null,
      humidityPct: value?.humidityPct ?? null,
      windKmh: value?.windKmh ?? null,
      windMaxKmh: value?.windMaxKmh ?? null,
      precipitationMm: value?.precipitationMm ?? null,
      fetchedAt: null,
      icon: value?.icon ?? null,
      ...(value?.hours ? { hours: value.hours } : {}),
      ...patch,
    });
  const field = (label: string, key: "temperatureC" | "humidityPct" | "windKmh" | "precipitationMm", suffix: string, min = 0) => (
    <NumberInput
      label={label}
      aria-label={label}
      suffix={suffix}
      decimalScale={1}
      decimalSeparator=","
      min={min}
      value={value?.[key] ?? ""}
      onChange={(v) => set({ [key]: v === "" ? null : Number(v) })}
    />
  );

  return (
    <Stack gap={6} aria-label="Météo">
      <Group justify="space-between" gap="xs">
        <Group gap={6}>
          {value?.icon ? <WeatherIcon code={value.icon} size={18} /> : <CloudSun size={16} aria-hidden />}
          <Text size="sm" fw={600}>
            Météo
          </Text>
          {value?.icon && (
            <Text size="xs" c="dimmed">
              {weatherLabel(value.icon)}
            </Text>
          )}
          {value && (
            <Text size="xs" c="dimmed">
              {weatherSourceLabel(value)}
            </Text>
          )}
          {q.isFetching && (
            <Text size="xs" c="dimmed">
              recherche…
            </Text>
          )}
        </Group>
        {manual && (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<RefreshCw size={12} />}
            onClick={() => {
              applied.current = null;
              onChange(q.data?.weather ?? null);
            }}
            disabled={!q.data?.weather}
          >
            Reprendre la météo du fournisseur
          </Button>
        )}
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {field("Température", "temperatureC", " °C", -50)}
        {field("Hygrométrie", "humidityPct", " %")}
        {field("Vent moyen", "windKmh", " km/h")}
        {field("Pluie", "precipitationMm", " mm")}
      </SimpleGrid>
      {q.error && !value && (
        <Text size="xs" c="dimmed">
          Météo indisponible pour le moment : saisie possible à la main.
        </Text>
      )}
    </Stack>
  );
}

/**
 * Météo enregistrée (fiche), façon meteoblue : temps dominant, température,
 * hygrométrie, vent et pluie, puis la frise horaire de la période.
 */
/**
 * Météo d'une intervention en une ligne (fiche) : temps dominant, puis
 * température, hygrométrie, vent et pluie sur la période, et la source.
 */
export function WeatherLine({ weather }: { weather: InterventionWeather }) {
  const parts = [
    { icon: Thermometer, label: "Température", v: weather.temperatureC === null ? null : `${fmt(weather.temperatureC)} °C` },
    { icon: Droplets, label: "Hygrométrie", v: weather.humidityPct === null ? null : `${fmt(weather.humidityPct, 0)} %` },
    {
      icon: Wind,
      label: "Vent",
      v: weather.windKmh === null ? null : `${fmt(weather.windKmh, 0)} km/h${weather.windMaxKmh && Math.round(weather.windMaxKmh) > Math.round(weather.windKmh) ? `, rafales ${fmt(weather.windMaxKmh, 0)}` : ""}`,
    },
    { icon: CloudRain, label: "Pluie", v: weather.precipitationMm === null ? null : `${fmt(weather.precipitationMm)} mm` },
  ].filter((p) => p.v !== null);
  return (
    <Group justify="space-between" align="center" gap="sm" wrap="wrap">
      <Group gap="lg" wrap="wrap">
        {weather.icon && (
          <Group gap={6} wrap="nowrap">
            <WeatherIcon code={weather.icon} size={28} />
            <Text size="sm" fw={600}>
              {weatherLabel(weather.icon)}
            </Text>
          </Group>
        )}
        {parts.map(({ icon: Icon, label, v }) => (
          <Group key={label} gap={4} wrap="nowrap" aria-label={`${label} : ${v}`}>
            <Icon size={15} aria-hidden color="var(--mantine-color-dimmed)" />
            <Text size="sm" className="lv-num">
              {v}
            </Text>
          </Group>
        ))}
      </Group>
      <Text size="xs" c="dimmed">
        {weatherSourceLabel(weather)}
      </Text>
    </Group>
  );
}

/** Temps dominant de quelques heures (même règle que le serveur : le plus marquant). */
const SEVERITY = ["01", "02", "03", "04", "50", "09", "10", "13", "11"];
function dominantIcon(icons: (string | null | undefined)[]): string | null {
  const known = icons.filter((i): i is string => !!i && /^\d\d[dn]$/.test(i));
  if (known.length === 0) return null;
  return known.reduce((w, i) => (SEVERITY.indexOf(i.slice(0, 2)) > SEVERITY.indexOf(w.slice(0, 2)) ? i : w));
}

const SLOT_COLORS = { go: "lichen", caution: "paille", stop: "brique" } as const;
const SLOT_LABELS = { go: "favorable", caution: "à surveiller", stop: "défavorable" } as const;

/**
 * Conditions de pulvérisation des prochains jours (MET-3), seuils
 * d'Ekylibre : un créneau par heure (ou par 3 h), sa couleur et sa raison.
 */
export function SprayingConditions({
  farmId,
  days = 3,
  from,
  highlight,
  bare = false,
}: {
  farmId: string;
  days?: number;
  /** Début de la fenêtre (ISO) ; maintenant par défaut. */
  from?: string;
  /** Période d'une intervention : ses heures sont mises en avant et le bilan porte sur elles. */
  highlight?: { from: string; to: string };
  /** Sans cadre ni titre (dans un pavé qui a déjà le sien). */
  bare?: boolean;
}) {
  const q = useQuery({
    queryKey: ["weather-spraying", farmId, days, from ?? null],
    queryFn: () => api.get<SprayingForecast | null>(farmPath(farmId, `/weather/spraying?days=${days}${from ? `&from=${encodeURIComponent(from)}` : ""}`)),
    staleTime: 15 * 60_000,
    retry: false,
  });
  if (q.isLoading) return null;
  if (q.error || !q.data) {
    return (
      <Paper p="md" withBorder aria-label="Conditions de pulvérisation">
        <Text size="sm" c="dimmed">
          Conditions de pulvérisation indisponibles pour le moment.
        </Text>
      </Paper>
    );
  }
  const byDay = new Map<string, SprayingForecast["slots"]>();
  for (const s of q.data.slots) {
    const d = new Date(s.at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const observed = q.data.kind === "observed";
  const next = q.data.slots.find((s) => s.level === "go");
  const goHours = q.data.slots.filter((s) => s.level === "go").reduce((n, s) => n + s.stepHours, 0);
  // Bilan de l'intervention : le pire créneau de sa période (même règle et mêmes seuils que la frise).
  const period = highlight ? sprayingPeriod(q.data.slots.map((x) => ({ ...x, level: DOMAIN_LEVEL[x.level] })), highlight.from, highlight.to) : null;
  const inPeriod = (x: { at: string; stepHours: number }) => !highlight || (Date.parse(x.at) < Date.parse(highlight.to) && Date.parse(x.at) + x.stepHours * 3_600_000 > Date.parse(highlight.from));
  const hm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const Frame = bare ? Box : Paper;
  return (
    <Frame {...(bare ? {} : { p: "md", withBorder: true })} aria-label="Conditions de pulvérisation" role="group">
      <Group justify="space-between" mb="xs" gap="xs">
        <Text fw={700} size={bare ? "sm" : undefined}>
          Conditions de pulvérisation
        </Text>
        {period ? (
          <TrafficLight level={period.level} variant="badge" label={period.level === "unknown" ? "Inconnues" : SLOT_LABELS[SLOT_OF[period.level]]} />
        ) : (
          <Text size="xs" c="dimmed">
            {SOURCES[q.data.source]}, {observed ? "observées" : "prévision"}
          </Text>
        )}
      </Group>
      <Text size="sm" mb="xs">
        {period && highlight
          ? `Pendant l'intervention (${hm(highlight.from)}–${hm(highlight.to)}) : ${
              period.level === "unknown" ? "pas de météo horaire." : period.level === "ok" ? "conditions favorables." : `${SLOT_LABELS[SLOT_OF[period.level]]} — ${period.reasons.join(", ")}.`
            }`
          : observed
          ? goHours
            ? `Ce jour-là : ${goHours} h favorable(s) à la pulvérisation.`
            : "Ce jour-là : aucune heure favorable à la pulvérisation."
          : next
          ? `Prochain créneau favorable : ${new Date(next.at).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`
          : `Aucun créneau favorable dans les ${days} prochains jours.`}
      </Text>
      <ScrollArea type="auto">
        <Stack gap={6}>
          {[...byDay].map(([label, slots]) => {
            const temps = slots.map((x) => x.temperatureC).filter((t): t is number => t !== null);
            const rain = slots.reduce((n, x) => n + (x.precipitationMm ?? 0), 0);
            // Temps du jour : dominant des heures de jour (8 h – 20 h).
            const icon = dominantIcon(slots.filter((x) => (x.icon ?? "").endsWith("d")).map((x) => x.icon));
            return (
              <Group key={label} gap={6} align="center">
                <Group gap={6} w={210} wrap="nowrap" style={{ flex: "none" }}>
                  <WeatherIcon code={icon} size={22} />
                  <Stack gap={0}>
                    <Text size="xs" fw={600} tt="capitalize">
                      {label}
                    </Text>
                    <Text size="xs" c="dimmed" className="lv-num">
                      {temps.length ? `${Math.round(Math.min(...temps))}° / ${Math.round(Math.max(...temps))}°` : ""}
                      {rain > 0 ? ` · ${fmt(rain)} mm` : ""}
                    </Text>
                  </Stack>
                </Group>
                <Group gap={2} wrap="nowrap">
                  {slots.map((s) => (
                    <Tooltip
                      key={s.at}
                      withArrow
                      label={`${new Date(s.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} — ${SLOT_LABELS[s.level]}${s.reasons.length ? ` : ${s.reasons.join(", ")}` : ""}`}
                    >
                      <Box
                        role="img"
                        aria-label={`${new Date(s.at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })} ${SLOT_LABELS[s.level]}${s.reasons.length ? ` : ${s.reasons.join(", ")}` : ""}`}
                        w={s.stepHours * 8}
                        h={18}
                        bg={`var(--mantine-color-${SLOT_COLORS[s.level]}-${s.level === "go" ? 5 : 4})`}
                        data-period={highlight && inPeriod(s) ? "" : undefined}
                        style={{
                          borderRadius: 2,
                          // Heures de l'intervention : pleines et soulignées ; les autres, estompées.
                          opacity: highlight && !inPeriod(s) ? 0.35 : 1,
                          boxShadow: highlight && inPeriod(s) ? "inset 0 -3px 0 var(--mantine-color-text)" : undefined,
                        }}
                      />
                    </Tooltip>
                  ))}
                </Group>
              </Group>
            );
          })}
        </Stack>
      </ScrollArea>
      <Group gap="xs" mt="xs">
        {(["go", "caution", "stop"] as const).map((l) => (
          <Badge key={l} size="xs" color={SLOT_COLORS[l]} variant="light">
            {SLOT_LABELS[l]}
          </Badge>
        ))}
        <Text size="xs" c="dimmed">
          {highlight ? "Heures de l'intervention soulignées. " : ""}Seuils de la ferme : vent, hygrométrie, température, pluie (
          <Anchor component={Link} to={`/f/${farmId}/farm?tab=spraying`} size="xs">
            régler
          </Anchor>
          ).
        </Text>
      </Group>
    </Frame>
  );
}

/** Niveau d'un créneau ↔ feu du domaine (sprayingPeriod). */
const DOMAIN_LEVEL = { go: "ok", caution: "warning", stop: "danger" } as const;
const SLOT_OF = { ok: "go", warning: "caution", danger: "stop" } as const;
