import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button, FileButton, Group, List, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import type { EquipmentBundleResult } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useEquipments } from "../../app/queries";

/** Fichiers lus d'un dossier de la base matériel (chemins relatifs au dossier). */
const WANTED = ["machine.json", "sources.json", "fiche_technique.json", "entretien/plan_entretien.json", "entretien/fluides.csv", "pieces/pieces_entretien.csv"];

export async function readBundle(files: File[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of files) {
    // « Claas Arion 430/entretien/plan_entretien.json » → « entretien/plan_entretien.json »
    const rel = (f.webkitRelativePath || f.name).split("/").slice(f.webkitRelativePath ? 1 : 0).join("/");
    if (WANTED.includes(rel)) out[rel] = await f.text();
  }
  return out;
}

/**
 * Import d'un dossier de la base matériel (FR-MAT-8) : le navigateur lit les
 * fichiers utiles du dossier choisi (fiche, plan, fluides, pièces) ; les
 * notices PDF et les images restent sur le poste.
 */
export function EquipmentBundleImport() {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const equipments = useEquipments(farm.id);
  const [target, setTarget] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [folder, setFolder] = useState("");
  const send = useMutation({
    mutationFn: () => api.post<EquipmentBundleResult>(farmPath(farm.id, "/imports/equipment-bundle"), { equipmentId: target, files }),
    onSuccess: () => {
      for (const key of ["equipments", "equipment-sheet", "maintenance", "maintenance-due", "articles", "brands"]) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  const r = send.data;
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={2}>Base matériel</Title>
        <Text size="sm" c="dimmed">
          Choisissez le dossier d'un matériel (format de la base Arion : <code>machine.json</code>, <code>entretien/</code>, <code>pieces/</code>). Fourmy reprend la fiche, la fiche technique, le
          plan d'entretien, les fluides et les pièces. Les notices restent sur votre poste. Un second import met à jour sans doublon et conserve vos ajustements du plan.
        </Text>
        <Group align="flex-end">
          <FileButton
            multiple
            onChange={async (list) => {
              const arr = list ?? [];
              setFolder(arr[0]?.webkitRelativePath.split("/")[0] ?? "");
              setFiles(await readBundle(arr));
              send.reset();
            }}
            inputProps={{ webkitdirectory: "", directory: "" } as Record<string, string>}
          >
            {(props) => (
              <Button {...props} variant="light" leftSection={<FolderOpen size={16} />}>
                Choisir un dossier
              </Button>
            )}
          </FileButton>
          <Select
            label="Rattacher au matériel"
            placeholder="Nouveau matériel (ou même n° de série)"
            data={(equipments.data?.items ?? []).map((e) => ({ value: e.id, label: e.name }))}
            value={target}
            onChange={setTarget}
            clearable
            searchable
            w={300}
          />
          <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!files?.["machine.json"]}>
            Importer
          </Button>
        </Group>
        {files && (
          <Text size="sm">
            {folder && <b>{folder} : </b>}
            {Object.keys(files).length} fichier(s) utile(s) sur {WANTED.length}
            {!files["machine.json"] && " — machine.json manquant"}.
          </Text>
        )}
        {send.error && <Alert color="brique">{send.error instanceof ApiError ? send.error.message : String(send.error)}</Alert>}
        {r && (
          <Alert color="lichen" title={`${r.report.model} ${r.created ? "créé" : "mis à jour"}`}>
            <List size="sm">
              <List.Item>
                {r.report.operationsAdded} opération(s) ajoutée(s){r.report.operationsKept ? `, ${r.report.operationsKept} conservée(s)` : ""}
              </List.Item>
              {r.report.notApplicable.length > 0 && <List.Item>Non applicables (option absente d'usine) : {r.report.notApplicable.join(" ; ")}</List.Item>}
              <List.Item>
                {r.report.fluids} fluide(s), {r.report.parts} pièce(s) dont {r.report.articlesCreated} nouvel(s) article(s)
              </List.Item>
              {r.report.warnings.map((w, i) => (
                <List.Item key={i}>À vérifier : {w}</List.Item>
              ))}
            </List>
            <Link to={`/f/${farm.id}/equipments/${r.equipmentId}?tab=maintenance`}>Voir le plan d'entretien</Link>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
