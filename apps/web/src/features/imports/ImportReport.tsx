import { Alert, Button, List, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImportRunView } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useConfirm } from "../../components/confirm";
import { COUNT_LABELS, type FileImportReport, type RevertReport } from "./fileImport";

/** Une ligne de comptes : créés, reliés, laissés de côté (seulement ce qui n'est pas nul) ; un nombre seul (reprise Ekylibre). */
function countText(v: Record<string, number> | number): string {
  if (typeof v === "number") return v ? v.toLocaleString("fr-FR") : "";
  const names: Record<string, string> = { created: "créés", linked: "reliés", skipped: "laissés de côté", failed: "en échec", alreadyImported: "déjà importés", islets: "îlots", parcels: "parcelles" };
  return Object.entries(v)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n.toLocaleString("fr-FR")} ${names[k] ?? k}`)
    .join(", ");
}

/**
 * Rapport d'un import de fichier terminé (lots IM5 et IM6) et son
 * annulation : ce que l'import a créé et que personne n'a modifié depuis est
 * supprimé ; le reste est gardé et signalé.
 */
export function ImportReport({
  farmId,
  run,
  onChange,
  revertable = true,
}: {
  farmId: string;
  run: ImportRunView;
  onChange: (run: ImportRunView) => void;
  revertable?: boolean;
}) {
  const client = useQueryClient();
  const { confirm, element } = useConfirm();
  const r = (run.report ?? {}) as FileImportReport;
  const revert = useMutation({
    mutationFn: () => api.post<{ run: ImportRunView; revert: RevertReport }>(farmPath(farmId, `/imports/${run.id}/revert`), {}),
    onSuccess: ({ run: next }) => {
      for (const key of ["file-imports", "snapshot", "interventions", "activities", "articles"]) void client.invalidateQueries({ queryKey: [key] });
      onChange(next);
    },
  });
  const rows = Object.entries(r.counts ?? {}).filter(([, v]) => countText(v));

  return (
    <Stack aria-label="Rapport de l'import">
      {element}
      {r.error && <Alert color="brique" title="L'import a échoué ; rien n'a été écrit.">{r.error}</Alert>}
      {rows.length > 0 && (
        <Table fz="sm">
          <Table.Tbody>
            {rows.map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td>{COUNT_LABELS[k] ?? k}</Table.Td>
                <Table.Td>{countText(v)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {r.compliance && r.compliance.phytoDanger + r.compliance.nitrateDanger > 0 && (
        <Alert color="paille" title="À revoir">
          {r.compliance.phytoDanger > 0 && <Text size="sm">{r.compliance.phytoDanger} intervention(s) en alerte phytosanitaire.</Text>}
          {r.compliance.nitrateDanger > 0 && <Text size="sm">{r.compliance.nitrateDanger} intervention(s) en alerte nitrates.</Text>}
        </Alert>
      )}
      {(r.failures?.length ?? 0) > 0 && (
        <Alert color="brique" title="Interventions en échec">
          <List size="sm">
            {r.failures!.slice(0, 10).map((f, i) => (
              <List.Item key={i}>
                {f.label} du {f.on} : {f.reason}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {r.revert && (
        <>
          <Title order={5}>Annulation</Title>
          <Text size="sm">
            Supprimé :{" "}
            {Object.entries(r.revert.deleted)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${COUNT_LABELS[k] ?? k} ${n}`)
              .join(", ") || "rien"}
            .
          </Text>
          {r.revert.kept.length > 0 && (
            <Alert color="paille" title="Gardé (modifié ou utilisé depuis l'import)">
              <List size="sm">
                {r.revert.kept.map((k) => (
                  <List.Item key={k.entity}>
                    {COUNT_LABELS[k.entity] ?? k.entity} : {k.count} — {k.reason}
                  </List.Item>
                ))}
              </List>
            </Alert>
          )}
        </>
      )}
      {revertable && run.status === "completed" && run.format && (
        <Button
          color="brique"
          variant="light"
          w="fit-content"
          loading={revert.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: "Annuler cet import ?",
              message: "Ce que l'import a créé (parcelles, cultures, interventions, articles…) est supprimé, sauf ce qui a été modifié ou utilisé depuis.",
              action: "Annuler l'import",
            });
            if (ok) revert.mutate();
          }}
        >
          Annuler l'import
        </Button>
      )}
      {revert.error && <Alert color="brique">{revert.error instanceof ApiError ? (revert.error.detail ?? revert.error.title) : String(revert.error)}</Alert>}
    </Stack>
  );
}
