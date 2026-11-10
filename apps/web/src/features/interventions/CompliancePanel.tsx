import { Alert, Badge, Group, Loader, Paper, Select, Stack, Text, ThemeIcon } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Info, OctagonX } from "lucide-react";
import type { ComplianceLevelName, ComplianceResult, InterventionCrew, TreatmentCheckDto } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";

/** Feux du contrôle réglementaire : couleurs et icônes communes (formulaire, fiche). */
export const LEVELS: Record<ComplianceLevelName, { color: string; label: string; icon: typeof Info }> = {
  ok: { color: "lichen", label: "Conforme", icon: CircleCheck },
  info: { color: "ardoise", label: "À noter", icon: Info },
  warning: { color: "paille", label: "À vérifier", icon: CircleAlert },
  danger: { color: "brique", label: "Non conforme", icon: OctagonX },
};

/** Contrôle d'un produit : feu, choix de la cible (usage E-Phy), indicateurs. */
export function TreatmentCheckView({
  check,
  onUsage,
  withName = true,
}: {
  check: TreatmentCheckDto;
  /** Choix de la cible (usage E-Phy) d'un produit ; absent en lecture seule. */
  onUsage?: (articleId: string, usageId: string | null) => void;
  withName?: boolean;
}) {
  return (
    <Stack gap={6}>
      <Group justify="space-between" gap="xs">
        {withName ? (
          <Text size="sm" fw={600}>
            {check.articleName}
          </Text>
        ) : (
          <Text size="xs" fw={600} c="dimmed">
            Contrôle réglementaire
          </Text>
        )}
        <Badge color={LEVELS[check.level].color} variant="light">
          {LEVELS[check.level].label}
        </Badge>
      </Group>
      {check.usages.length === 1 && (
        <Text size="sm" aria-label={`Usage de ${check.articleName}`}>
          <Text span size="xs" c="dimmed">
            Usage :{" "}
          </Text>
          {check.usages[0]!.label}
          {check.usages[0]!.doseLabel ? ` · dose max ${check.usages[0]!.doseLabel}` : ""}
        </Text>
      )}
      {!onUsage && check.usages.length > 1 && check.usageId && (
        <Text size="sm" aria-label={`Usage de ${check.articleName}`}>
          <Text span size="xs" c="dimmed">
            Usage :{" "}
          </Text>
          {check.usages.find((u) => u.id === check.usageId)?.label ?? check.usageId}
        </Text>
      )}
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
  );
}

export function ComplianceChecks({ result, onUsage }: { result: ComplianceResult; onUsage?: (articleId: string, usageId: string | null) => void }) {
  if (result.checks.length === 0) return null;
  return (
    <Stack gap="sm">
      {result.checks.map((check) => (
        <TreatmentCheckView key={check.articleId} check={check} onUsage={onUsage} />
      ))}
    </Stack>
  );
}

export interface ComplianceDraft {
  procedure: string;
  periods: { startedAt: string; stoppedAt: string }[];
  plannedAt?: string;
  targets: unknown[];
  inputs: { articleId: string; quantity: number; per: string; equipmentId?: string }[];
  compliance: { usages: Record<string, string> };
  /** Attelages complets (matériel et période) : contrôle de l'applicateur (FR-ATT-12). */
  staffing?: "crews";
  crews?: InterventionCrew[];
}

/**
 * Contrôle en direct pendant la saisie d'un traitement (exigence PHY-3) :
 * appel debounced à POST /phyto/check à chaque changement de dose, de
 * parcelle, de date ou de cible.
 */
export function useComplianceCheck(farmId: string, draft: ComplianceDraft | null, interventionId?: string) {
  // Debounce sur le contenu (texte), pas sur l'objet recréé à chaque rendu du
  // formulaire : sinon le délai relance un rendu du formulaire toutes les 400 ms.
  const [debounced] = useDebouncedValue(draft ? JSON.stringify(draft) : null, 400);
  const hasInputs = !!draft && draft.inputs.length > 0;
  const query = useQuery({
    queryKey: ["phyto-check", farmId, interventionId ?? null, debounced],
    enabled: hasInputs && !!debounced,
    queryFn: () => api.post<ComplianceResult>(farmPath(farmId, "/phyto/check"), { ...(JSON.parse(debounced!) as ComplianceDraft), interventionId }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  return { query, result: hasInputs ? (query.data ?? null) : null, hasInputs };
}

/**
 * Synthèse du contrôle de l'intervention : feu global, nombre de produits
 * contrôlés et de points bloquants ; le détail est sous chaque intrant.
 */
export function ComplianceSummary({ check }: { check: ReturnType<typeof useComplianceCheck> }) {
  const { query, result, hasInputs } = check;
  if (!hasInputs) return null;
  const dangers = (result?.checks ?? []).reduce((n, c) => n + c.indicators.filter((i) => i.level === "danger").length, 0) + (result?.mixture?.issues.length ?? 0);
  const warnings = (result?.checks ?? []).reduce((n, c) => n + c.indicators.filter((i) => i.level === "warning").length, 0);
  return (
    <Paper withBorder p="sm" aria-label="Contrôle réglementaire">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={700}>
          Contrôle réglementaire
        </Text>
        <Group gap={6}>
          {query.isFetching && <Loader size="xs" />}
          {result && result.checks.length > 0 && <Badge color={LEVELS[result.level].color}>{LEVELS[result.level].label}</Badge>}
        </Group>
      </Group>
      {query.error && (
        <Alert color="paille" variant="light">
          Contrôle indisponible pour le moment.
        </Alert>
      )}
      {result && result.checks.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun produit phytosanitaire à contrôler.
        </Text>
      )}
      {result && result.checks.length > 0 && (
        <Text size="sm">
          {result.checks.length} produit(s) contrôlé(s)
          {dangers ? `, ${dangers} point(s) non conforme(s)` : ""}
          {warnings ? `, ${warnings} à vérifier` : ""}
          {!dangers && !warnings ? ", rien de bloquant" : ""} — détail sous chaque intrant.
        </Text>
      )}
      {result?.referential && (
        <Text size="xs" c="dimmed" mt="xs">
          Référentiel E-Phy (ANSES) via Lexicon, version {result.referential}.
        </Text>
      )}
    </Paper>
  );
}
