import { Alert, Badge, Button, Group, Paper, Table, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComplianceResult, InterventionDetail } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDateTime, formatNumber } from "../../app/labels";
import { ComplianceChecks, LEVELS } from "./CompliancePanel";
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
        {result && <Badge color={LEVELS[result.level].color}>{LEVELS[result.level].label}</Badge>}
      </Group>
      {!result && <Text size="sm" c="dimmed">Contrôle en cours…</Text>}
      {result && <ComplianceChecks result={result} />}
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
  return (
    <Paper p="md" withBorder aria-label="IFT">
      <Group justify="space-between" mb="xs">
        <Title order={4}>IFT</Title>
        {ift?.status === "ok" && ift.total !== null && (
          <Text fw={700} className="lv-num" aria-label="IFT de l'intervention">
            {formatNumber(ift.total, 3)}
          </Text>
        )}
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
                  <Text size="sm">
                    {articleName(l.articleId)} · {parcelName(l.parcelId)}
                  </Text>
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
