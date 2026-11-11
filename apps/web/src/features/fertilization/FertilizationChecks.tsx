import { Alert, Badge, Group, List, Loader, Paper, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import type { FertilizationCheck, FertilizationCheckRequest, InterventionWeather, NitrateCheckRecord } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

const LEVELS: Record<FertilizationCheck["level"], { label: string; color: string }> = {
  ok: { label: "Conforme", color: "lichen" },
  info: { label: "À noter", color: "ardoise" },
  warning: { label: "À vérifier", color: "paille" },
  danger: { label: "Interdit", color: "brique" },
};

/** Température la plus basse et pluie de la météo saisie (conditions d'épandage, lot AJ). */
export function weatherExtremes(w: InterventionWeather): { minTemperatureC: number | null; precipitationMm: number | null } {
  const temps = [w.temperatureC, ...(w.hours ?? []).map((h) => h.temperatureC)].filter((t): t is number => typeof t === "number");
  return { minTemperatureC: temps.length ? Math.min(...temps) : null, precipitationMm: w.precipitationMm };
}

/** Contrôles d'un apport d'azote pendant la saisie (lot AH) : appel debounced à POST /fertilization/check. */
export function useFertilizationCheck(farmId: string, draft: FertilizationCheckRequest | null) {
  const [debounced] = useDebouncedValue(draft ? JSON.stringify(draft) : null, 400);
  const query = useQuery({
    queryKey: ["fertilization-check", farmId, debounced],
    enabled: !!debounced,
    queryFn: () => api.post<FertilizationCheck>(farmPath(farmId, "/fertilization/check"), JSON.parse(debounced!)),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  return { query, result: draft ? (query.data ?? null) : null, active: !!draft };
}

/**
 * Directive nitrates : calendrier d'épandage par parcelle, plan de fumure
 * établi et dose restante, plafond du premier apport, teneur connue.
 */
export function FertilizationSummary({ check }: { check: ReturnType<typeof useFertilizationCheck> }) {
  const { query, result, active } = check;
  if (!active) return null;
  return (
    <Paper withBorder p="sm" aria-label="Contrôle nitrates">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={700}>
          Directive nitrates
        </Text>
        <Group gap={6}>
          {query.isFetching && <Loader size="xs" />}
          {result && <Badge color={LEVELS[result.level].color}>{LEVELS[result.level].label}</Badge>}
        </Group>
      </Group>
      {query.error && (
        <Alert color="paille" variant="light">
          Contrôle indisponible pour le moment.
        </Alert>
      )}
      {result && <CheckDetails result={result} />}
    </Paper>
  );
}

/** Azote apporté et indicateurs d'un contrôle (saisie ou fiche de l'intervention). */
export function CheckDetails({ result }: { result: FertilizationCheck }) {
  // Plan, APLSH et efficacité s'affichent même conformes : ce sont des repères pour décider de l'apport.
  const shown = result.indicators.filter((i) => i.level !== "ok" || i.code === "fert_plan" || i.code === "fert_aplsh" || i.code === "fert_efficiency");
  return (
    <>
      {result.nitrogen && (
        <Text size="sm" className="lv-num">
          Azote apporté : {result.nitrogen.totalKgHa.toLocaleString("fr-FR")} kg N/ha
          {result.nitrogen.efficientKgHa !== null && result.nitrogen.efficientKgHa !== result.nitrogen.totalKgHa ? ` (${result.nitrogen.efficientKgHa.toLocaleString("fr-FR")} efficaces)` : ""}.
        </Text>
      )}
      {shown.length > 0 && (
        <List size="sm" spacing={2} mt={4}>
          {shown.map((i, k) => (
            <List.Item key={k}>
              <Text span size="sm" c={i.level === "danger" ? "brique.7" : i.level === "warning" ? "paille.8" : undefined}>
                {i.parcelName ? `${i.parcelName} : ` : ""}
                {i.message}
              </Text>
            </List.Item>
          ))}
        </List>
      )}
      {result.level === "danger" && (
        <Text size="xs" c="dimmed" mt={4}>
          Un épandage en période d'interdiction est une infraction au programme d'actions nitrates : vérifiez la date et le produit.
        </Text>
      )}
    </>
  );
}

/**
 * Fiche d'une intervention (lot AI) : contrôle nitrates enregistré à la
 * saisie, et le motif quand l'épandage a eu lieu en période d'interdiction.
 */
export function NitrateCheckSection({ check }: { check: NitrateCheckRecord | null | undefined }) {
  if (!check) return null;
  return (
    <Paper p="md" withBorder aria-label="Directive nitrates">
      <Group justify="space-between" mb="xs">
        <Text fw={700}>Directive nitrates</Text>
        <Badge color={LEVELS[check.level].color}>{LEVELS[check.level].label}</Badge>
      </Group>
      <CheckDetails result={check} />
      {check.reason && (
        <Alert color="brique" variant="light" mt="sm" title="Enregistré en période d'interdiction">
          Motif : « {check.reason} »
        </Alert>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Contrôlé à la saisie le {new Date(check.checkedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.
      </Text>
    </Paper>
  );
}
