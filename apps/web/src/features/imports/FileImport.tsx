import { useState } from "react";
import { Alert, Button, FileButton, Group, Paper, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import type { ImportRunView } from "@fourmy/contracts";
import { ApiError } from "../../app/api";
import { uploadImportFile } from "./fileImport";

/**
 * Dépôt d'un fichier à importer (lots IM5 et IM6 : page Imports et
 * assistant) : export Geofolia (.zip), dossier PAC TelePAC (.xml), EDI
 * DAPLOS (.dap). Le fichier est lu sans rien écrire ; `onAnalyzed` reçoit
 * l'import « à valider » et son aperçu.
 */
export function FileImport({ farmId, onAnalyzed }: { farmId: string; onAnalyzed: (run: ImportRunView) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadImportFile(farmId, file),
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ["file-imports", farmId] });
      onAnalyzed(run);
    },
  });
  return (
    <Paper p="md">
      <Stack gap="xs">
        <Text size="sm">
          Exports acceptés : <b>Geofolia</b> « Parcelles et Interventions complet » (.zip), <b>dossier PAC</b> TelePAC (.xml), <b>EDI DAPLOS</b>{" "}
          (.dap). Le fichier est d'abord analysé : rien n'est écrit avant votre validation.
        </Text>
        <Group>
          <FileButton
            accept=".zip,.xml,.dap,.edi,application/zip,application/xml,text/xml,text/plain"
            onChange={(file) => {
              if (!file) return;
              setName(file.name);
              upload.mutate(file);
            }}
          >
            {(props) => (
              <Button {...props} leftSection={<Upload size={16} />} loading={upload.isPending}>
                Choisir un fichier
              </Button>
            )}
          </FileButton>
          {name && upload.isPending && (
            <Text size="sm" c="dimmed">
              Analyse de {name}…
            </Text>
          )}
        </Group>
        {upload.error && (
          <Alert color="brique" title="Fichier refusé">
            {upload.error instanceof ApiError ? (upload.error.detail ?? upload.error.title) : String(upload.error)}
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
