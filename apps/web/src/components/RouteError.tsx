import { useRouteError } from "react-router";
import { Alert, Button, Center, Stack, Text } from "@mantine/core";
import { RefreshCw } from "lucide-react";

/** Module chargé à la demande introuvable (application mise à jour depuis l'ouverture de la page). */
export function isChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|Outdated Optimize Dep|ChunkLoadError/i.test(message);
}

export function ErrorPanel({ error, what = "la page" }: { error: unknown; what?: string }) {
  const chunk = isChunkError(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Center p="md" h="100%">
      <Stack align="center" maw={560}>
        <Alert color={chunk ? "paille" : "brique"} title={chunk ? "Fourmy a été mis à jour" : `Erreur de chargement de ${what}`} w="100%">
          <Text size="sm">
            {chunk ? "Une partie de l'application a changé depuis l'ouverture de cette page : rechargez-la pour continuer." : message}
          </Text>
        </Alert>
        <Button leftSection={<RefreshCw size={16} />} onClick={() => globalThis.location.reload()}>
          Recharger la page
        </Button>
      </Stack>
    </Center>
  );
}

/** Erreur d'une page (route) : message lisible et rechargement, au lieu de l'écran d'erreur par défaut. */
export function RouteError() {
  return <ErrorPanel error={useRouteError()} />;
}
