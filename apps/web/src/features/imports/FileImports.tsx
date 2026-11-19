import { useEffect, useState } from "react";
import { Badge, Group, Paper, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportRunView } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { formatDate } from "../../app/labels";
import { FileImport } from "./FileImport";
import { ImportPreview } from "./ImportPreview";
import { ImportReport } from "./ImportReport";
import { RUN_STATUS_LABELS, sourceLabel } from "./fileImport";

/** Un import et son déroulé : aperçu à valider, écriture en cours, rapport. */
export function ImportRun({ farmId, id, onChange }: { farmId: string; id: string; onChange?: (run: ImportRunView) => void }) {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["file-imports", farmId, id],
    queryFn: () => api.get<ImportRunView>(farmPath(farmId, `/imports/${id}`)),
    refetchInterval: (s) => (s.state.data?.status === "running" || s.state.data?.status === "reverting" ? 1500 : false),
  });
  const run = q.data;
  const status = run?.status;
  // Fin de l'écriture : les vues de la ferme se rafraîchissent.
  useEffect(() => {
    if (status === "completed") {
      for (const key of ["file-imports", "snapshot", "interventions", "activities", "articles", "parcels"]) void client.invalidateQueries({ queryKey: [key] });
    }
  }, [status, client]);
  if (!run) return null;
  const set = (next: ImportRunView) => {
    client.setQueryData(["file-imports", farmId, id], next);
    onChange?.(next);
  };
  const s = RUN_STATUS_LABELS[run.status];
  return (
    <Paper p="md">
      <Group justify="space-between" mb="sm">
        <Title order={3}>{sourceLabel(run)}</Title>
        <Badge color={s.color}>{s.label}</Badge>
      </Group>
      {run.status === "running" && (
        <Text size="sm" c="dimmed">
          Écriture en cours…
        </Text>
      )}
      {run.preview && run.status === "analyzed" && <ImportPreview farmId={farmId} run={run} onChange={set} />}
      {["completed", "failed", "reverted"].includes(run.status) && <ImportReport farmId={farmId} run={run} onChange={set} />}
    </Paper>
  );
}

/**
 * Imports de fichiers (lot IM5) : dépôt hors assistant (FR-IMP-7), liste des
 * imports de la ferme (toutes sources), aperçu, rapport et annulation.
 */
export function FileImports({ farmId }: { farmId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["file-imports", farmId],
    queryFn: () => api.get<{ items: ImportRunView[] }>(farmPath(farmId, "/imports")),
  });
  const items = list.data?.items ?? [];
  return (
    <Stack>
      <FileImport farmId={farmId} onAnalyzed={(run) => setSelected(run.id)} />
      {selected && <ImportRun key={selected} farmId={farmId} id={selected} />}
      {items.length > 0 && (
        <Paper p="md">
          <Title order={3} mb="xs">
            Imports de la ferme
          </Title>
          <Table fz="sm" highlightOnHover aria-label="Imports de la ferme">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Fichier</Table.Th>
                <Table.Th>État</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((r) => (
                <Table.Tr key={r.id} bg={r.id === selected ? "var(--mantine-color-default-hover)" : undefined}>
                  <Table.Td>
                    <UnstyledButton onClick={() => setSelected(r.id)} aria-label={`Ouvrir l'import du ${formatDate(r.startedAt)}`}>
                      {formatDate(r.startedAt)}
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>{sourceLabel(r)}</Table.Td>
                  <Table.Td>{r.file?.name ?? r.preview?.fileName ?? "—"}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={RUN_STATUS_LABELS[r.status].color} variant="light">
                      {RUN_STATUS_LABELS[r.status].label}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
