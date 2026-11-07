import { Alert, Center, Loader } from "@mantine/core";

/** États communs : chargement, erreur (message lisible de l'API). */
export function Loading() {
  return (
    <Center py="xl">
      <Loader aria-label="Chargement" />
    </Center>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  return (
    <Alert color="brique" title="Impossible de charger les données">
      {error instanceof Error ? error.message : String(error)}
    </Alert>
  );
}
