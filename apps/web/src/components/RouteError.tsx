import { useRouteError } from "react-router";
import { Alert, Button, Center, Stack, Text } from "@mantine/core";
import { RefreshCw } from "lucide-react";

/**
 * Message lisible d'une erreur : les erreurs de Cesium (DeveloperError,
 * RuntimeError, erreurs relayées des workers) ne sont pas des `Error` mais des
 * objets { name, message, stack }.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    const where = typeof e.stack === "string" ? e.stack.split("\n").find((l) => l.trim())?.trim() : undefined;
    if (typeof e.message === "string") return [typeof e.name === "string" && e.name !== "Error" ? `${e.name} : ${e.message}` : e.message, where ? `(${where})` : ""].filter(Boolean).join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      /* objet circulaire */
    }
  }
  return String(error);
}

/** Module chargé à la demande introuvable (application mise à jour depuis l'ouverture de la page). */
export function isChunkError(error: unknown): boolean {
  const message = errorMessage(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|Outdated Optimize Dep|ChunkLoadError/i.test(message);
}

export function ErrorPanel({ error, what = "la page" }: { error: unknown; what?: string }) {
  const chunk = isChunkError(error);
  const message = errorMessage(error);
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
