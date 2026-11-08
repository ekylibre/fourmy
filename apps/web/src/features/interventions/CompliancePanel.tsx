import { useEffect } from "react";
import { Alert, Badge, Group, Loader, Paper, Select, Stack, Text, ThemeIcon } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Info, OctagonX } from "lucide-react";
import type { ComplianceLevelName, ComplianceResult } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Feux du contrôle réglementaire : couleurs et icônes communes (formulaire, fiche). */
export const LEVELS: Record<ComplianceLevelName, { color: string; label: string; icon: typeof Info }> = {
  ok: { color: "lichen", label: "Conforme", icon: CircleCheck },
  info: { color: "ardoise", label: "À noter", icon: Info },
  warning: { color: "paille", label: "À vérifier", icon: CircleAlert },
  danger: { color: "brique", label: "Non conforme", icon: OctagonX },
};

export function ComplianceChecks({
  result,
  onUsage,
}: {
  result: ComplianceResult;
  /** Choix de la cible (usage E-Phy) d'un produit ; absent en lecture seule. */
  onUsage?: (articleId: string, usageId: string | null) => void;
}) {
  if (result.checks.length === 0) return null;
  return (
    <Stack gap="sm">
      {result.checks.map((check) => (
        <Stack key={check.articleId} gap={6}>
          <Group justify="space-between" gap="xs">
            <Text size="sm" fw={600}>
              {check.articleName}
            </Text>
            <Badge color={LEVELS[check.level].color} variant="light">
              {LEVELS[check.level].label}
            </Badge>
          </Group>
          {onUsage && check.usages.length > 1 && (
            <Select
              size="xs"
              aria-label={`Cible de ${check.articleName}`}
              placeholder="Cible du traitement (précise la dose, la ZNT et les délais)"
              clearable
              searchable
              data={check.usages.map((u) => ({ value: u.id, label: u.doseLabel ? `${u.label} · ${u.doseLabel}` : u.label }))}
              value={check.usageId}
              onChange={(v) => onUsage(check.articleId, v)}
            />
          )}
          <Stack gap={4} role="list" aria-label={`Contrôle de ${check.articleName}`}>
            {check.indicators.map((i, k) => {
              const level = LEVELS[i.level];
              return (
                <Group key={k} gap={6} wrap="nowrap" align="flex-start" role="listitem" data-level={i.level}>
                  <ThemeIcon size={18} variant="transparent" color={level.color} aria-label={level.label}>
                    <level.icon size={16} />
                  </ThemeIcon>
                  <Text size="sm" c={i.level === "danger" ? "brique" : undefined}>
                    {i.message}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

export interface ComplianceDraft {
  procedure: string;
  periods: { startedAt: string; stoppedAt: string }[];
  plannedAt?: string;
  targets: unknown[];
  inputs: { articleId: string; quantity: number; per: string }[];
  compliance: { usages: Record<string, string> };
}

/**
 * Contrôle en direct pendant la saisie d'un traitement (exigence PHY-3) :
 * appel debounced à POST /phyto/check à chaque changement de dose, de
 * parcelle, de date ou de cible.
 */
export function CompliancePanel({
  farmId,
  draft,
  interventionId,
  onUsage,
  onResult,
}: {
  farmId: string;
  draft: ComplianceDraft | null;
  interventionId?: string;
  onUsage: (articleId: string, usageId: string | null) => void;
  onResult?: (result: ComplianceResult | null) => void;
}) {
  const [debounced] = useDebouncedValue(draft, 400);
  const query = useQuery({
    queryKey: ["phyto-check", farmId, interventionId ?? null, JSON.stringify(debounced)],
    enabled: !!debounced && debounced.inputs.length > 0,
    queryFn: () => api.post<ComplianceResult>(farmPath(farmId, "/phyto/check"), { ...debounced, interventionId }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const hasInputs = !!draft && draft.inputs.length > 0;
  useEffect(() => {
    onResult?.(hasInputs ? (query.data ?? null) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, hasInputs]);
  if (!hasInputs) return null;
  return (
    <Paper withBorder p="sm" aria-label="Contrôle réglementaire">
      <Group justify="space-between" mb="xs">
        <Text size="sm" fw={700}>
          Contrôle réglementaire
        </Text>
        {query.isFetching && <Loader size="xs" />}
      </Group>
      {query.error && (
        <Alert color="paille" variant="light">
          Contrôle indisponible pour le moment.
        </Alert>
      )}
      {query.data && query.data.checks.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun produit phytosanitaire à contrôler.
        </Text>
      )}
      {query.data && <ComplianceChecks result={query.data} onUsage={onUsage} />}
      {query.data?.referential && (
        <Text size="xs" c="dimmed" mt="xs">
          Référentiel E-Phy (ANSES) via Lexicon, version {query.data.referential}.
        </Text>
      )}
    </Paper>
  );
}
