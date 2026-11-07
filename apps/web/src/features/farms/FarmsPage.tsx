import { Alert, Badge, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router";
import { Wordmark } from "@fourmy/ui-lyvre";
import { useMyFarms } from "../../app/farm";

/** Choix de la ferme : celles dont l'utilisateur est membre. */
export function FarmsPage() {
  const farms = useMyFarms();
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
        <Alert color="ardoise">Vous n'êtes membre d'aucune ferme pour le moment.</Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        {farms.data?.items.map((f) => (
          <Card key={f.id} component={Link} to={`/f/${f.id}`} withBorder padding="lg" style={{ textDecoration: "none" }}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700} truncate>
                {f.name}
              </Text>
              <Badge color={f.role === "owner" ? "lichen" : "ardoise"}>{f.role === "owner" ? "Responsable" : "Salarié"}</Badge>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
