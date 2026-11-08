import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, List, Paper, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { EquipmentBundleImport } from "./EquipmentBundleImport";

type Run = {
  id: string;
  source: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  report: {
    counts?: Record<string, number>;
    rejected?: { entity: string; reason: string }[];
    warnings?: { message: string }[];
    phyto?: { year: number; ekylibre: number; fourmy: number }[];
    error?: string;
  } | null;
};

/** Import Ekylibre (owner) : lancement, suivi, rapport (FR-MIG-1/3). */
export function ImportsPage() {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => api.post<Run>(farmPath(farm.id, "/imports/ekylibre"), { sourceDatabase: source.trim() }),
    onSuccess: (run) => setRunId(run.id),
  });
  const run = useQuery({
    queryKey: ["import", farm.id, runId],
    enabled: !!runId,
    queryFn: () => api.get<Run>(farmPath(farm.id, `/imports/${runId}`)),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
  });
  const done = run.data && run.data.status !== "running";
  const status = run.data?.status;
  // Une seule fois, au passage à « terminé » : les vues de la ferme se rafraîchissent.
  useEffect(() => {
    if (status === "completed") {
      for (const key of ["snapshot", "interventions", "stock", "register", "articles"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
  }, [status, queryClient]);

  if (farm.role !== "owner") return <Alert color="ardoise">Réservé au responsable de la ferme.</Alert>;

  const r = run.data?.report;
  const reasons = new Map<string, number>();
  for (const x of r?.rejected ?? []) reasons.set(`${x.entity} — ${x.reason}`, (reasons.get(`${x.entity} — ${x.reason}`) ?? 0) + 1);

  return (
    <Stack maw={900}>
      <Title order={1}>Import depuis Ekylibre</Title>
      <Text c="dimmed">
        L'export Ekylibre est d'abord restauré, en lecture seule, dans une base source (<code>restore-source.sh</code>). Indiquez ici le nom de
        cette base : l'instance Ekylibre n'est jamais touchée, et l'import peut être rejoué sans doublon.
      </Text>
      <Paper p="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <Group align="flex-end">
            <TextInput
              label="Base source"
              placeholder="ekylibre_src_<tenant>"
              value={source}
              onChange={(e) => setSource(e.currentTarget.value)}
              ff="monospace"
              style={{ flex: 1 }}
              required
            />
            <Button type="submit" loading={start.isPending || run.data?.status === "running"}>
              Lancer l'import
            </Button>
          </Group>
        </form>
        {start.error && (
          <Alert color="brique" mt="sm">
            {start.error instanceof ApiError ? start.error.message : String(start.error)}
          </Alert>
        )}
      </Paper>

      {run.data && (
        <Paper p="md">
          <Group justify="space-between">
            <Title order={3}>Rapport</Title>
            <Badge color={run.data.status === "completed" ? "lichen" : run.data.status === "failed" ? "brique" : "paille"}>
              {run.data.status === "completed" ? "Terminé" : run.data.status === "failed" ? "Échec" : "En cours…"}
            </Badge>
          </Group>
          {r?.error && <Alert color="brique" mt="sm">{r.error}</Alert>}
          {done && r?.counts && (
            <Stack mt="sm">
              <Table>
                <Table.Tbody>
                  {Object.entries(r.counts).map(([k, v]) => (
                    <Table.Tr key={k}>
                      <Table.Td>{k}</Table.Td>
                      <Table.Td ta="right" className="lv-num">{v}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {reasons.size > 0 && (
                <>
                  <Title order={4}>Lignes non reprises</Title>
                  <List size="sm">
                    {[...reasons].map(([k, n]) => (
                      <List.Item key={k}>
                        {n} × {k}
                      </List.Item>
                    ))}
                  </List>
                </>
              )}
              {(r.warnings?.length ?? 0) > 0 && (
                <>
                  <Title order={4}>À vérifier</Title>
                  <List size="sm">{r.warnings!.map((w, i) => <List.Item key={i}>{w.message}</List.Item>)}</List>
                </>
              )}
              {(r.phyto?.length ?? 0) > 0 && (
                <>
                  <Title order={4}>Registre phyto : Ekylibre ↔ Fourmy</Title>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Année</Table.Th>
                        <Table.Th ta="right">Ekylibre</Table.Th>
                        <Table.Th ta="right">Fourmy</Table.Th>
                        <Table.Th ta="right">Écart</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {r.phyto!.map((p) => (
                        <Table.Tr key={p.year}>
                          <Table.Td className="lv-num">{p.year}</Table.Td>
                          <Table.Td ta="right" className="lv-num">{p.ekylibre}</Table.Td>
                          <Table.Td ta="right" className="lv-num">{p.fourmy}</Table.Td>
                          <Table.Td ta="right" className="lv-num" c={p.fourmy === p.ekylibre ? "lichen" : "brique"}>
                            {p.fourmy - p.ekylibre}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}
            </Stack>
          )}
        </Paper>
      )}
      <EquipmentBundleImport />
    </Stack>
  );
}
