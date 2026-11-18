import { Alert, Button, Group, Paper, Table, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComplianceResult, InterventionDetail } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDateTime, formatNumber } from "../../app/labels";
import { ComplianceChecks } from "./CompliancePanel";
import { TrafficLight } from "../../components/TrafficLight";
import { iftLight, type Light } from "@fourmy/domain";
import type { Names } from "./presenters";

/**
 * Fiche d'une intervention : contrôle réglementaire (enregistré à la saisie,
 * sinon calculé à la date de l'intervention, reprises d'Ekylibre comprises)
 * et IFT (exigences PHY-4, IFT-1).
 */
export function ComplianceSection({ farmId, intervention: i }: { farmId: string; intervention: InterventionDetail }) {
  const hasPhyto = i.inputs.length > 0;
  const live = useQuery({
    queryKey: ["intervention-compliance", farmId, i.id, i.updatedAt],
    enabled: hasPhyto && !i.compliance,
    queryFn: () => api.get<ComplianceResult>(farmPath(farmId, `/interventions/${i.id}/compliance`)),
  });
  const result = i.compliance ?? live.data ?? null;
  if (!hasPhyto || (result && result.checks.length === 0)) return null;
  return (
    <Paper p="md" withBorder aria-label="Contrôle réglementaire">
      <Group justify="space-between" mb="xs">
        <Title order={4}>Contrôle réglementaire</Title>
        {result && <TrafficLight level={result.level} variant="badge" />}
      </Group>
      {!result && <Text size="sm" c="dimmed">Contrôle en cours…</Text>}
      {result && <ComplianceChecks result={result} />}
      {result?.mixture && result.mixture.issues.length > 0 && (
        <Alert color="brique" variant="light" mt="sm" title="Mélange interdit">
          {result.mixture.issues.map((i) => (
            <Text key={i.message} size="sm">
              {i.message}
            </Text>
          ))}
        </Alert>
      )}
      {result?.reason && (
        <Alert color="brique" variant="light" mt="sm" title="Enregistrée malgré un feu rouge">
          Motif : « {result.reason} »
        </Alert>
      )}
      {result && (
        <Text size="xs" c="dimmed" mt="xs">
          {i.compliance ? `Contrôlée à la saisie le ${formatDateTime(result.checkedAt)}` : "Contrôlée à la date de l'intervention"}
          {result.referential ? ` — référentiel E-Phy ${result.referential}.` : "."}
        </Text>
      )}
    </Paper>
  );
}

export function IftSection({ farmId, intervention: i, names }: { farmId: string; intervention: InterventionDetail; names: Names }) {
  const queryClient = useQueryClient();
  const compute = useMutation({
    mutationFn: () => api.post(farmPath(farmId, `/interventions/${i.id}/ift`), {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["intervention", farmId, i.id] }),
  });
  if (i.status !== "done" || i.inputs.length === 0) return null;
  const ift = i.ift ?? null;
  const parcelName = (id: string) => names.parcel.get(id) ?? "parcelle";
  // Avertissement de l'API commun à toutes les lignes : affiché une seule fois.
  const warnings = new Set((ift?.lines ?? []).map((l) => l.warning));
  const common = warnings.size === 1 ? [...warnings][0] : null;
  const articleName = (id: string) => names.article.get(id)?.name ?? "produit";
  const level = iftLevel(ift);
  return (
    <Paper p="md" withBorder aria-label="IFT">
      <Group justify="space-between" mb="xs">
        <Title order={4}>IFT</Title>
        <Group gap="xs">
          {ift?.status === "ok" && ift.total !== null && (
            <Text fw={700} className="lv-num" aria-label="IFT de l'intervention">
              {formatNumber(ift.total, 3)}
            </Text>
          )}
          <TrafficLight level={level} variant="led" label={IFT_LABELS[level]} detail="Chaque ligne face à la dose de référence : vert ≤ 1, orange jusqu'à 1,2, rouge au-delà." />
        </Group>
      </Group>
      {!ift && <Text size="sm" c="dimmed">Pas encore calculé (calcul automatique en arrière-plan).</Text>}
      {ift?.status === "pending" && <Text size="sm" c="paille">En attente : {ift.error}</Text>}
      {ift?.status === "unavailable" && <Text size="sm" c="dimmed">Non calculable : {ift.error}</Text>}
      {ift && ift.lines.length > 0 && (
        <Table aria-label="IFT par produit et parcelle">
          <Table.Tbody>
            {ift.lines.map((l, k) => (
              <Table.Tr key={k}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <TrafficLight level={iftLight(l.ift)} variant="led" compact size="xs" label={IFT_LABELS[iftLight(l.ift)]} />
                    <Text size="sm">
                      {articleName(l.articleId)} · {parcelName(l.parcelId)}
                    </Text>
                  </Group>
                  {l.warning && l.warning !== common && (
                    <Text size="xs" c="dimmed">
                      {l.warning}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right" className="lv-num">
                  {l.ift === null ? "—" : formatNumber(l.ift, 3)}
                  {l.segment && (
                    <Text size="xs" c="dimmed">
                      {l.segment}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {common && (
        <Text size="xs" c="dimmed" mt={4}>
          {common}
        </Text>
      )}
      <Group justify="space-between" mt="xs">
        <Text size="xs" c="dimmed">
          API IFT du ministère de l'Agriculture{ift?.computedAt ? `, calculé le ${formatDateTime(ift.computedAt)}` : ""}.
        </Text>
        <Button size="xs" variant="subtle" loading={compute.isPending} onClick={() => compute.mutate()}>
          {ift ? "Recalculer" : "Calculer maintenant"}
        </Button>
      </Group>
    </Paper>
  );
}

/** Mots des feux de l'IFT (dose face à la dose de référence). */
const IFT_LABELS: Record<Light, string> = {
  ok: "Dose de référence respectée",
  info: "À noter",
  warning: "Au-dessus de la dose de référence",
  danger: "Bien au-dessus de la dose de référence",
  unknown: "Non calculé",
};

/** Feu global de l'IFT : la ligne la plus défavorable ; gris si non calculé. */
export function iftLevel(ift: { status: string; lines: { ift: number | null }[] } | null | undefined): Light {
  if (!ift || ift.status !== "ok" || !ift.lines.length) return "unknown";
  const order: Light[] = ["unknown", "ok", "warning", "danger"];
  return ift.lines.map((l) => iftLight(l.ift)).reduce<Light>((w, x) => (order.indexOf(x) > order.indexOf(w) ? x : w), "ok");
}
