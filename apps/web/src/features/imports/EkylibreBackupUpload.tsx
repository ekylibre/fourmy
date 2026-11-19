import { useState } from "react";
import { Alert, Button, FileButton, Group, Progress, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import type { ImportRunView } from "@fourmy/contracts";
import { ApiError } from "../../app/api";
import { uploadEkylibreBackup } from "./fileImport";

/**
 * Reprise d'Ekylibre (lot IM6) : dépôt de la sauvegarde de tenant (zip,
 * 2 Go au plus), avec la progression de l'envoi. Le serveur la restaure
 * ensuite (quelques minutes pour une grosse ferme) ; rien n'est écrit dans
 * la ferme avant l'import.
 */
export function EkylibreBackupUpload({ farmId, onUploaded }: { farmId: string; onUploaded?: (run: ImportRunView) => void }) {
  const client = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadEkylibreBackup(farmId, file, setProgress),
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ["file-imports", farmId] });
      onUploaded?.(run);
    },
    onSettled: () => setProgress(null),
  });
  return (
    <Stack gap="xs" aria-label="Reprise d'Ekylibre">
      <Text size="sm">
        Vous utilisiez <b>Ekylibre</b> ? Déposez la sauvegarde de votre ferme (Ekylibre → Administration → Sauvegardes, archive .zip, 2 Go au plus) :
        parcelles, activités, interventions, matériels, stocks et identité de la ferme sont repris.
      </Text>
      <Group>
        <FileButton accept=".zip,application/zip" onChange={(f) => f && upload.mutate(f)}>
          {(props) => (
            <Button {...props} variant="light" leftSection={<Archive size={16} />} loading={upload.isPending}>
              Déposer une sauvegarde Ekylibre
            </Button>
          )}
        </FileButton>
        {progress !== null && (
          <Text size="sm" c="dimmed">
            Envoi : {progress} %
          </Text>
        )}
      </Group>
      {progress !== null && <Progress value={progress} aria-label="Envoi de la sauvegarde" />}
      {upload.error && <Alert color="brique">{upload.error instanceof ApiError ? (upload.error.detail ?? upload.error.title) : String(upload.error)}</Alert>}
    </Stack>
  );
}
