import { useState } from "react";
import { Link } from "react-router";
import { Alert, Anchor, Button, Center, Group, Paper, Radio, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Integration, IntegrationProviderDefinition } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useMyFarms } from "../../app/farm";
import { ErrorAlert, Loading } from "../../components/states";
import { Wordmark } from "@fourmy/ui-lyvre";

type Catalogue = { providers: IntegrationProviderDefinition[]; items: Integration[] };

/**
 * Connexion lancée depuis agrirouter (Deep URL, claudedocs/conception_agrirouter.md §4) :
 * fourmy.org/agrirouter renvoie ici. L'utilisateur, connecté, choisit la ferme
 * dont il est responsable, confirme, puis suit le consentement habituel.
 */
export function AgrirouterStartPage() {
  const farms = useMyFarms();
  const [chosen, setChosen] = useState<string | null>(null);
  if (farms.isLoading) return <Loading />;
  if (farms.error) return <ErrorAlert error={farms.error} />;
  const owned = (farms.data?.items ?? []).filter((f) => f.role === "owner");
  const farm = owned.length === 1 ? owned[0]! : (owned.find((f) => f.id === chosen) ?? null);

  return (
    <Center mih="100vh" p="md">
      <Paper p="xl" w={520} maw="100%">
        <Stack>
          <Wordmark style={{ fontSize: "2rem" }} />
          <Title order={2}>Connecter une ferme à agrirouter</Title>
          {owned.length === 0 ? (
            <>
              <Alert color="paille" title="Aucune ferme à connecter">
                Seul le responsable d'une ferme peut la connecter à agrirouter. Demandez-lui de le faire depuis Fourmy (Intégrations).
              </Alert>
              <Anchor component={Link} to="/farms">
                Retour à mes fermes
              </Anchor>
            </>
          ) : farm ? (
            <Confirm farmId={farm.id} farmName={farm.name} onBack={owned.length > 1 ? () => setChosen(null) : undefined} />
          ) : (
            <ChooseFarm farms={owned} onChoose={setChosen} />
          )}
        </Stack>
      </Paper>
    </Center>
  );
}

function ChooseFarm({ farms, onChoose }: { farms: { id: string; name: string }[]; onChoose: (id: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <Text>Vous êtes responsable de plusieurs fermes. Laquelle voulez-vous connecter ?</Text>
      <Radio.Group value={value} onChange={setValue} aria-label="Ferme à connecter">
        <Stack gap="xs">
          {farms.map((f) => (
            <Radio key={f.id} value={f.id} label={f.name} />
          ))}
        </Stack>
      </Radio.Group>
      <Group>
        <Button disabled={!value} onClick={() => value && onChoose(value)}>
          Continuer
        </Button>
        <Anchor component={Link} to="/farms">
          Annuler
        </Anchor>
      </Group>
    </>
  );
}

function Confirm({ farmId, farmName, onBack }: { farmId: string; farmName: string; onBack?: () => void }) {
  const catalogue = useQuery({
    queryKey: ["integrations", farmId],
    queryFn: () => api.get<Catalogue>(farmPath(farmId, "/integrations")),
  });
  const [error, setError] = useState<string | null>(null);
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>(farmPath(farmId, "/integrations/agrirouter/connect"), {}),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e: unknown) => setError(e instanceof ApiError ? (e.detail ?? e.message) : String(e)),
  });
  if (catalogue.isLoading) return <Loading />;
  if (catalogue.error) return <ErrorAlert error={catalogue.error} />;
  const definition = catalogue.data!.providers.find((p) => p.provider === "agrirouter");
  const integration = catalogue.data!.items.find((i) => i.provider === "agrirouter");

  if (definition?.available === false) {
    return <Alert color="paille">agrirouter n'est pas encore configuré sur ce serveur.</Alert>;
  }
  if (integration?.hasSecret) {
    return (
      <>
        <Alert color="lichen" title="Déjà connectée">
          La ferme {farmName} est déjà connectée à agrirouter.
        </Alert>
        <Anchor component={Link} to={`/f/${farmId}/integrations`}>
          Voir ses intégrations
        </Anchor>
      </>
    );
  }
  return (
    <>
      <Text>
        Connecter la ferme <b>{farmName}</b> à agrirouter ?
      </Text>
      <Text size="sm" c="dimmed">
        Fourmy pourra envoyer les cartes de modulation et les parcelles à vos machines, et recevoir les travaux qu'elles ont réalisés. Vous allez autoriser Fourmy dans agrirouter, puis revenir ici.
      </Text>
      {error && <Alert color="brique">{error}</Alert>}
      <Group>
        <Button onClick={() => connect.mutate()} loading={connect.isPending}>
          Connecter à agrirouter
        </Button>
        {onBack ? (
          <Button variant="subtle" onClick={onBack}>
            Choisir une autre ferme
          </Button>
        ) : (
          <Anchor component={Link} to="/farms">
            Annuler
          </Anchor>
        )}
      </Group>
    </>
  );
}
