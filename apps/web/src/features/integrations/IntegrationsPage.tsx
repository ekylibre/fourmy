import { useState } from "react";
import { Alert, Badge, Button, Group, List, Paper, PasswordInput, Stack, Switch, Table, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTEGRATION_CATEGORIES, type Integration, type IntegrationProviderDefinition } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

type Catalogue = { providers: IntegrationProviderDefinition[]; items: Integration[] };

const STATUS: Record<Integration["status"], { label: string; color: string }> = {
  pending: { label: "À synchroniser", color: "paille" },
  ok: { label: "Synchronisée", color: "lichen" },
  error: { label: "En erreur", color: "brique" },
};

/**
 * Intégrations de la ferme (responsable) : un formulaire par fournisseur,
 * construit à partir de sa description. Le secret saisi est envoyé une fois,
 * chiffré par le serveur et jamais réaffiché (seuls ses 4 derniers caractères).
 */
export function IntegrationsPage() {
  const farm = useFarm();
  const catalogue = useQuery({
    queryKey: ["integrations", farm.id],
    queryFn: () => api.get<Catalogue>(farmPath(farm.id, "/integrations")),
    // Suivi d'une synchro en cours.
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.running) ? 2000 : false),
  });
  if (catalogue.isLoading) return <Loading />;
  if (catalogue.error) return <ErrorAlert error={catalogue.error} />;
  const { providers, items } = catalogue.data!;

  return (
    <Stack>
      <Title order={1}>Intégrations</Title>
      <Text c="dimmed" size="sm">
        Services externes reliés à cette ferme. Les accès (jetons, mots de passe) sont chiffrés et ne sont jamais réaffichés.
      </Text>
      {INTEGRATION_CATEGORIES.map(({ category, label, description }) => {
        const inCategory = providers.filter((d) => d.category === category);
        const withOpenMeteo = category === "weather";
        if (!inCategory.length && !withOpenMeteo) return null;
        return (
          <Stack key={category} gap="sm" component="section" aria-labelledby={`integrations-${category}`}>
            <div>
              <Title order={2} size="h3" id={`integrations-${category}`}>
                {label}
              </Title>
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            </div>
            {inCategory.map((definition) =>
              definition.connect === "oauth" ? (
                <AgrirouterCard
                  key={definition.provider}
                  farmId={farm.id}
                  definition={definition}
                  integration={items.find((i) => i.provider === definition.provider) ?? null}
                />
              ) : (
                <ProviderCard
                  key={definition.provider}
                  farmId={farm.id}
                  definition={definition}
                  integration={items.find((i) => i.provider === definition.provider) ?? null}
                />
              ),
            )}
            {withOpenMeteo && <StationsCard farmId={farm.id} />}
            {withOpenMeteo && <OpenMeteoCard />}
          </Stack>
        );
      })}
    </Stack>
  );
}

type Station = { id: string; provider: string; name: string; lat: number | null; lon: number | null; lastMeasureAt: string | null; measures: number };

/** Stations Weenat et Sencrop recopiées (lot W) : dernière mesure de chacune. */
function StationsCard({ farmId }: { farmId: string }) {
  const q = useQuery({
    queryKey: ["weather-stations", farmId],
    queryFn: () => api.get<{ items: Station[] }>(farmPath(farmId, "/weather/stations")),
  });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <Paper p="md" data-testid="weather-stations">
      <Title order={3}>Stations météo de la ferme</Title>
      <Text size="sm" c="dimmed" mb="xs">
        Mesures horaires synchronisées toutes les heures. La météo d'une intervention passée prend la station la plus proche des
        parcelles (moins de 5 km).
      </Text>
      <Table aria-label="Stations météo">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Station</Table.Th>
            <Table.Th>Fournisseur</Table.Th>
            <Table.Th>Dernière mesure</Table.Th>
            <Table.Th>Mesures</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((s) => (
            <Table.Tr key={s.id}>
              <Table.Td>
                {s.name}
                {s.lat === null && (
                  <Badge ml={6} size="xs" color="paille" variant="light">
                    sans position
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{s.provider === "weenat" ? "Weenat" : "Sencrop"}</Table.Td>
              <Table.Td className="lv-num">{s.lastMeasureAt ? new Date(s.lastMeasureAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—"}</Table.Td>
              <Table.Td className="lv-num">{s.measures.toLocaleString("fr-FR")}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

type Recipient = { id: string; name: string; endpointType: string; formats: string[] };

/**
 * agrirouter (lot AD) : connexion par consentement dans le compte agrirouter
 * de la ferme (pas de secret saisi), destinataires joignables, retrait.
 */
function AgrirouterCard({ farmId, definition, integration }: { farmId: string; definition: IntegrationProviderDefinition; integration: Integration | null }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiError ? (e.detail ?? e.message) : String(e));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["integrations"] });
  const connected = !!integration?.hasSecret;
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>(farmPath(farmId, "/integrations/agrirouter/connect"), {}),
    onSuccess: ({ url }) => window.location.assign(url),
    onError,
  });
  const sync = useMutation({
    mutationFn: () => api.post<Integration>(farmPath(farmId, `/integrations/${integration!.id}/sync`), {}),
    onSuccess: () => void refresh(),
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ remoteError?: string }>(farmPath(farmId, `/integrations/${integration!.id}`)),
    onSuccess: (r) => {
      notifications.show({
        color: r?.remoteError ? "paille" : "lichen",
        message: r?.remoteError ? `Retirée de Fourmy ; à retirer aussi dans agrirouter (${r.remoteError}).` : "Connexion agrirouter retirée.",
      });
      void refresh();
    },
    onError,
  });
  const report = integration?.lastReport as { companyName?: string | null; recipients?: Recipient[] } | null;

  return (
    <Paper p="md" data-testid={`integration-${definition.provider}`}>
      <Stack>
        <Group justify="space-between">
          <Title order={3}>{definition.label}</Title>
          {connected && integration && (
            <Group gap="xs">
              {integration.running ? (
                <Badge color="ardoise">Synchronisation…</Badge>
              ) : (
                <Badge color={STATUS[integration.status].color}>{integration.status === "ok" ? "Connectée" : STATUS[integration.status].label}</Badge>
              )}
              {!integration.enabled && <Badge color="gray">Désactivée</Badge>}
            </Group>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {definition.description}
        </Text>
        {definition.available === false && !connected && (
          <Alert color="paille">agrirouter n'est pas encore configuré sur ce serveur : l'administrateur doit enregistrer Fourmy chez agrirouter.</Alert>
        )}
        {error && (
          <Alert color="brique" withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {connected ? (
          <>
            <Text size="sm">
              Compte agrirouter : <b>{String(integration!.settings.companyName ?? "connecté")}</b>
              {integration!.settings.connectedAt ? `, depuis le ${formatDate(String(integration!.settings.connectedAt))}` : ""}.
            </Text>
            {report?.recipients && (
              <div>
                <Text size="sm" fw={600}>
                  Destinataires joignables
                </Text>
                {report.recipients.length ? (
                  <List size="sm">
                    {report.recipients.map((r) => (
                      <List.Item key={r.id}>
                        {r.name} {r.endpointType === "virtual_communication_unit" ? "(machine)" : ""} : {r.formats.map((f) => (f === "isoxml" ? "ISO-XML" : "Shapefile")).join(", ")}
                      </List.Item>
                    ))}
                  </List>
                ) : (
                  <Text size="sm" c="dimmed">
                    Aucun pour l'instant : dans agrirouter, reliez vos consoles à Fourmy par une route.
                  </Text>
                )}
              </div>
            )}
            {integration!.lastError && (
              <Alert color="brique" title="Dernière synchronisation en échec">
                {integration!.lastError}
              </Alert>
            )}
            <Group>
              <Button variant="light" onClick={() => sync.mutate()} loading={sync.isPending} disabled={integration!.running}>
                Actualiser les destinataires
              </Button>
              <Button variant="subtle" onClick={() => connect.mutate()} loading={connect.isPending}>
                Reconnecter
              </Button>
              <Button variant="subtle" color="brique" onClick={() => remove.mutate()} loading={remove.isPending}>
                Déconnecter
              </Button>
            </Group>
          </>
        ) : (
          <Group>
            <Button onClick={() => connect.mutate()} loading={connect.isPending} disabled={definition.available === false}>
              Connecter à agrirouter
            </Button>
            <Text size="xs" c="dimmed">
              Vous serez redirigé vers agrirouter pour autoriser Fourmy, puis ramené ici.
            </Text>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

function OpenMeteoCard() {
  return (
    <Paper p="md" data-testid="integration-open-meteo">
      <Group justify="space-between">
        <Title order={3}>Open-Meteo — météo</Title>
        <Badge color="lichen">Actif par défaut</Badge>
      </Group>
      <Text size="sm" c="dimmed" mt={4}>
        Gratuit et sans clé : prévisions et historique depuis 1940 pour la météo des interventions et les conditions de
        pulvérisation. Utilisé quand ni meteoblue ni OpenWeather ne sont actifs, et pour le passé quand aucune station Weenat ou Sencrop n'est assez proche.
      </Text>
    </Paper>
  );
}

function ProviderCard({
  farmId,
  definition,
  integration,
}: {
  farmId: string;
  definition: IntegrationProviderDefinition;
  integration: Integration | null;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(definition.fields.filter((f) => f.kind !== "secret").map((f) => [f.key, integration?.settings[f.key] ?? ""])),
  );
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const secretField = definition.fields.find((f) => f.kind === "secret");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["integrations"] });
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));

  const save = useMutation({
    mutationFn: (body: { enabled?: boolean }) =>
      api.put<{ integration: Integration; test: Record<string, unknown> | null }>(
        farmPath(farmId, `/integrations/${definition.provider}`),
        { settings: values, ...(secret ? { secret } : {}), ...body },
      ),
    onSuccess: (r) => {
      setError(null);
      setSecret("");
      setTest(r.test);
      notifications.show({ color: "lichen", message: "Intégration enregistrée (connexion vérifiée)." });
      void refresh();
    },
    onError,
  });
  const sync = useMutation({
    mutationFn: () => api.post<Integration>(farmPath(farmId, `/integrations/${integration!.id}/sync`), {}),
    onSuccess: () => {
      setError(null);
      notifications.show({ color: "lichen", message: "Synchronisation lancée." });
      void refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/integrations/${integration!.id}`)),
    onSuccess: () => {
      setTest(null);
      notifications.show({ color: "lichen", message: "Intégration retirée." });
      void refresh();
    },
    onError,
  });

  const report = (test ?? integration?.lastReport ?? null) as {
    matched?: { device: string; equipment: string }[];
    unmatched?: { device: string; reason: string }[];
    inserted?: number;
  } | null;

  return (
    <Paper p="md" data-testid={`integration-${definition.provider}`}>
      <Stack>
        <Group justify="space-between">
          <Title order={3}>{definition.label}</Title>
          {integration && (
            <Group gap="xs">
              {integration.running ? (
                <Badge color="ardoise">Synchronisation…</Badge>
              ) : (
                <Badge color={STATUS[integration.status].color}>{STATUS[integration.status].label}</Badge>
              )}
              {!integration.enabled && <Badge color="gray">Désactivée</Badge>}
            </Group>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {definition.description}
        </Text>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({});
          }}
        >
          <Stack>
            {definition.fields
              .filter((f) => f.kind !== "secret")
              .map((f) => (
                <TextInput
                  key={f.key}
                  label={f.label}
                  type={f.kind === "url" ? "url" : "text"}
                  placeholder={f.placeholder}
                  description={f.help}
                  required={f.required}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.currentTarget.value })}
                />
              ))}
            {secretField && (
              <PasswordInput
                label={secretField.label}
                description={
                  integration?.hasSecret
                    ? `Enregistré${integration.secretHint ? ` (…${integration.secretHint})` : ""} — laisser vide pour le conserver.`
                    : secretField.help
                }
                required={secretField.required && !integration?.hasSecret}
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.currentTarget.value)}
              />
            )}
            {error && (
              <Alert color="brique" withCloseButton onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            <Group>
              <Button type="submit" loading={save.isPending}>
                {integration ? "Tester et enregistrer" : "Tester et activer"}
              </Button>
              {integration && (
                <>
                  <Button
                    variant="light"
                    onClick={() => sync.mutate()}
                    loading={sync.isPending}
                    disabled={!integration.enabled || integration.running}
                  >
                    Synchroniser maintenant
                  </Button>
                  <Switch
                    label="Synchronisation automatique"
                    checked={integration.enabled}
                    onChange={(e) => save.mutate({ enabled: e.currentTarget.checked })}
                  />
                  <Button variant="subtle" color="brique" onClick={() => remove.mutate()} loading={remove.isPending}>
                    Retirer
                  </Button>
                </>
              )}
            </Group>
          </Stack>
        </form>

        {integration?.lastSyncAt && (
          <Text size="sm" c="dimmed">
            Dernière synchronisation : {formatDate(integration.lastSyncAt)}{" "}
            {new Date(integration.lastSyncAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            {typeof report?.inserted === "number" ? ` — ${report.inserted} position(s) ajoutée(s)` : ""}
          </Text>
        )}
        {integration?.lastError && (
          <Alert color="brique" title="Dernière synchronisation en échec">
            {integration.lastError}
          </Alert>
        )}
        {report?.matched && report.matched.length > 0 && (
          <div>
            <Text size="sm" fw={600}>
              Boîtiers rattachés
            </Text>
            <List size="sm">
              {report.matched.map((m) => (
                <List.Item key={m.device}>
                  {m.device} → {m.equipment}
                </List.Item>
              ))}
            </List>
          </div>
        )}
        {report?.unmatched && report.unmatched.length > 0 && (
          <Alert color="paille" title="Boîtiers non rattachés">
            <List size="sm">
              {report.unmatched.map((u) => (
                <List.Item key={u.device}>
                  {u.device} : {u.reason} (donnez au matériel le même nom que le boîtier)
                </List.Item>
              ))}
            </List>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
