import { Alert, Badge, Group, List, Loader, Paper, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import type { FertilizationCheck, FertilizationCheckRequest } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

const LEVELS: Record<FertilizationCheck["level"], { label: string; color: string }> = {
  ok: { label: "Conforme", color: "lichen" },
  info: { label: "À noter", color: "ardoise" },
  warning: { label: "À vérifier", color: "paille" },
  danger: { label: "Interdit", color: "brique" },
};

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
  const shown = (result?.indicators ?? []).filter((i) => i.level !== "ok" || i.code === "fert_plan");
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
      {result?.nitrogen && (
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
      {result && result.level === "danger" && (
        <Text size="xs" c="dimmed" mt={4}>
          Un épandage en période d'interdiction est une infraction au programme d'actions nitrates : vérifiez la date et le produit.
        </Text>
      )}
    </Paper>
  );
}
