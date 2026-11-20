import { Alert, Group, List, Paper, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import type { CertificationCheck, ControlAvailability, ControlFinding, ControlLevel, ControlReport } from "@fourmy/contracts";
import type { Light } from "@fourmy/domain";
import { api, farmPath } from "../../app/api";
import { TrafficLight } from "../../components/TrafficLight";

/**
 * Contrôles HVE et AB (lot CT1) : feux, requêtes, constats de saisie.
 * Données manquantes : feu gris « Données manquantes », jamais vert (NFR-3).
 */
export const CONTROL_LIGHTS: Record<ControlLevel, { light: Light; label: string }> = {
  ok: { light: "ok", label: "Conforme" },
  warning: { light: "warning", label: "À vérifier" },
  danger: { light: "danger", label: "Non conforme" },
  missing: { light: "unknown", label: "Données manquantes" },
  na: { light: "info", label: "Sans objet" },
};

export function ControlLight({ level, variant = "badge", detail }: { level: ControlLevel; variant?: "badge" | "inline"; detail?: string }) {
  const l = CONTROL_LIGHTS[level];
  return <TrafficLight level={l.light} label={l.label} variant={variant} {...(detail ? { detail } : {})} />;
}

/**
 * Contrôles disponibles pendant la campagne (menu Réglementaire, D2). La clé
 * commence par « certifications » : une certification ajoutée ou modifiée
 * recharge le menu.
 */
export function useControlAvailability(farmId: string, campaign: number) {
  return useQuery({
    queryKey: ["certifications", "availability", farmId, campaign],
    queryFn: () => api.get<ControlAvailability>(farmPath(farmId, `/control/availability?campaign=${campaign}`)),
    staleTime: 5 * 60_000,
  });
}

export function useControlReport(farmId: string, kind: "hve" | "ab", campaign: number) {
  return useQuery({
    queryKey: ["certifications", "report", farmId, kind, campaign],
    queryFn: () => api.get<ControlReport>(farmPath(farmId, `/control/${kind}?campaign=${campaign}`)),
  });
}

/** Constats de certification d'un brouillon (debounced), `null` hors parcelle certifiée. */
export function useCertificationCheck(farmId: string, draft: object | null) {
  const [debounced] = useDebouncedValue(draft ? JSON.stringify(draft) : null, 400);
  const query = useQuery({
    queryKey: ["certification-check", farmId, debounced],
    enabled: !!debounced,
    queryFn: () => api.post<{ check: CertificationCheck | null }>(farmPath(farmId, "/control/check"), JSON.parse(debounced!) as object),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  return draft ? (query.data?.check ?? null) : null;
}

export function FindingList({ findings }: { findings: ControlFinding[] }) {
  return (
    <List spacing={6} listStyleType="none" p={0}>
      {findings.map((f, i) => (
        <List.Item key={`${f.ruleId}-${i}`}>
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <ControlLight level={f.level} variant="inline" />
            <div>
              <Text size="sm">{f.message}</Text>
              {f.breach && (
                <Text size="xs" c="dimmed">
                  Manquement INAO n° {f.breach.inao} ({f.breach.class === "minor" ? "mineur" : f.breach.class === "major" ? "majeur" : "critique"}) : {f.breach.measure}
                  {f.breach.unconfirmed ? " — rattachement à confirmer" : ""}
                </Text>
              )}
              {f.missing?.length ? (
                <Text size="xs" c="dimmed">
                  À compléter : {f.missing.map((m) => m.what).join(", ")}
                </Text>
              ) : null}
              <Text size="xs" c="dimmed">
                {f.source}
              </Text>
            </div>
          </Group>
        </List.Item>
      ))}
    </List>
  );
}

/** Constats de certification : en saisie (brouillon) ou sur la fiche (enregistrés). */
export function CertificationCheckSection({ check, stored = false }: { check: CertificationCheck | null | undefined; stored?: boolean }) {
  if (!check) return null;
  return (
    <Paper withBorder p={stored ? "md" : "sm"} aria-label="Certification">
      <Group justify="space-between" mb="xs">
        <Text fw={700} size={stored ? undefined : "sm"}>
          Certification (HVE, AB)
        </Text>
        <ControlLight level={check.level} />
      </Group>
      <FindingList findings={check.findings} />
      {check.reason && (
        <Alert color="brique" variant="light" mt="sm" title="Enregistré malgré un point non conforme">
          Motif : « {check.reason} »
        </Alert>
      )}
      {stored && (
        <Text size="xs" c="dimmed" mt="xs">
          Contrôlé à la saisie le {new Date(check.checkedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}.
        </Text>
      )}
    </Paper>
  );
}
