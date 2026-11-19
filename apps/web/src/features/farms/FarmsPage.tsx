import { Alert, Badge, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { Link, Navigate } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { onboardingPending, useMyFarms } from "../../app/farm";

/**
 * Choix de la ferme : celles dont l'utilisateur est membre. Un compte « à
 * embarquer » sans ferme part dans l'assistant ; une seule ferme dont
 * l'assistant n'est pas fini le reprend (lot IM6).
 */
export function FarmsPage() {
  const farms = useMyFarms();
  const items = farms.data?.items ?? [];
  if (farms.data && items.length === 0 && farms.data.canCreateFarm) return <Navigate to="/onboarding" replace />;
  const only = items.length === 1 ? items[0]! : null;
  if (only && onboardingPending(only)) return <Navigate to={`/f/${only.id}/onboarding/${only.onboarding?.step ?? "files"}`} replace />;
  return (
    <Stack p="xl" maw={960} mx="auto">
      <Wordmark style={{ fontSize: "2rem" }} />
      <Title order={1}>Vos fermes</Title>
      {farms.isLoading && (
        <Center>
          <Loader />
        </Center>
      )}
      {farms.error && <Alert color="brique">{String(farms.error.message)}</Alert>}
      {farms.data && farms.data.items.length === 0 && (
        <Alert color="ardoise" title="Vous n'êtes membre d'aucune ferme pour le moment.">
          Le responsable d'une ferme peut vous inviter depuis sa page Équipe. Pour créer votre ferme dans Fourmy, demandez l'ouverture de votre compte à
          l'administrateur de Fourmy.
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        {farms.data?.items.map((f) => (
          <Card key={f.id} component={Link} to={onboardingPending(f) ? `/f/${f.id}/onboarding/${f.onboarding?.step ?? "files"}` : `/f/${f.id}`} withBorder padding="lg" style={{ textDecoration: "none" }}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700} truncate>
                {f.name}
              </Text>
              <Badge color={f.role === "owner" ? "lichen" : "ardoise"}>{f.role === "owner" ? "Responsable" : "Salarié"}</Badge>
            </Group>
            {onboardingPending(f) && (
              <Text size="sm" c="paille" mt="xs">
                Mise en route à reprendre
              </Text>
            )}
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
