import { useEffect, useRef } from "react";
import { Badge, Box, Button, Group, NumberInput, Paper, ScrollArea, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { CloudSun, RefreshCw } from "lucide-react";
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
  manual: "saisie",
};

export function weatherSourceLabel(w: Pick<InterventionWeather, "source" | "kind">): string {
  if (w.source === "manual" || w.kind === "manual") return "saisie à la main";
  return `${SOURCES[w.source] ?? w.source}, ${w.kind === "forecast" ? "prévision" : "observée"}`;
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
          <CloudSun size={16} aria-hidden />
          <Text size="sm" fw={600}>
            Météo
          </Text>
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

/** Météo enregistrée (fiche). */
export function WeatherSummary({ weather }: { weather: InterventionWeather }) {
  if (weather.temperatureC === null && weather.humidityPct === null && weather.windKmh === null && weather.precipitationMm === null) {
    return (
      <Text size="sm" c="dimmed">
        Pas de données météo pour cette intervention.
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      <SimpleGrid cols={4} spacing="xs">
        {[
          ["Température", `${fmt(weather.temperatureC)} °C`],
          ["Hygrométrie", `${fmt(weather.humidityPct, 0)} %`],
          ["Vent", `${fmt(weather.windKmh)} km/h${weather.windMaxKmh ? ` (max ${fmt(weather.windMaxKmh)})` : ""}`],
          ["Pluie", `${fmt(weather.precipitationMm)} mm`],
        ].map(([label, v]) => (
          <Stack key={label} gap={0}>
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text size="sm" fw={600} className="lv-num">
              {v}
            </Text>
          </Stack>
        ))}
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        {weatherSourceLabel(weather)}
      </Text>
    </Stack>
  );
}

const SLOT_COLORS = { go: "lichen", caution: "paille", stop: "brique" } as const;
const SLOT_LABELS = { go: "favorable", caution: "à surveiller", stop: "défavorable" } as const;

/**
 * Conditions de pulvérisation des prochains jours (MET-3), seuils
 * d'Ekylibre : un créneau par heure (ou par 3 h), sa couleur et sa raison.
 */
export function SprayingConditions({ farmId, days = 3, from }: { farmId: string; days?: number; /** Début de la fenêtre (ISO) ; maintenant par défaut. */ from?: string }) {
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
  return (
    <Paper p="md" withBorder aria-label="Conditions de pulvérisation">
      <Group justify="space-between" mb="xs">
        <Text fw={700}>Conditions de pulvérisation</Text>
        <Text size="xs" c="dimmed">
          {SOURCES[q.data.source]}, {observed ? "observées" : "prévision"}
        </Text>
      </Group>
      <Text size="sm" mb="xs">
        {observed
          ? goHours
            ? `Ce jour-là : ${goHours} h favorable(s) à la pulvérisation.`
            : "Ce jour-là : aucune heure favorable à la pulvérisation."
          : next
          ? `Prochain créneau favorable : ${new Date(next.at).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`
          : `Aucun créneau favorable dans les ${days} prochains jours.`}
      </Text>
      <ScrollArea type="auto">
        <Stack gap={6}>
          {[...byDay].map(([label, slots]) => (
            <Group key={label} gap={6} wrap="nowrap" align="center">
              <Text size="xs" w={120} tt="capitalize">
                {label}
              </Text>
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
                      style={{ borderRadius: 2 }}
                    />
                  </Tooltip>
                ))}
              </Group>
            </Group>
          ))}
        </Stack>
      </ScrollArea>
      <Group gap="xs" mt="xs">
        {(["go", "caution", "stop"] as const).map((l) => (
          <Badge key={l} size="xs" color={SLOT_COLORS[l]} variant="light">
            {SLOT_LABELS[l]}
          </Badge>
        ))}
        <Text size="xs" c="dimmed">
          Seuils : vent, hygrométrie, température, pluie (repris d'Ekylibre).
        </Text>
      </Group>
    </Paper>
  );
}
