import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Alert, Anchor, Badge, Box, Button, Group, Image, List, Modal, Paper, PasswordInput, SimpleGrid, Stack, Switch, Table, Text, TextInput, ThemeIcon, Title, Tooltip } from "@mantine/core";
import { Cable, CloudRain, CloudSun, Gauge, Lightbulb, Navigation, Plug, Satellite, Sun, Thermometer, Tractor, type LucideIcon } from "lucide-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INTEGRATION_CATEGORIES, type Integration, type IntegrationCategory, type IntegrationProviderDefinition } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDate } from "../../app/labels";
import { ErrorAlert, Loading } from "../../components/states";

type Catalogue = { providers: IntegrationProviderDefinition[]; items: Integration[] };

const STATUS: Record<Integration["status"], { label: string; color: string }> = {
  pending: { label: "À synchroniser", color: "paille" },
  ok: { label: "Synchronisée", color: "lichen" },
  error: { label: "En erreur", color: "brique" },
  disconnected: { label: "Déconnectée", color: "brique" },
};

/** Logo officiel de chaque service (public/integrations, provenance dans SOURCES.md). */
const PROVIDER_LOGOS: Record<string, string> = {
  traccar: "/integrations/traccar.png",
  openweather: "/integrations/openweather.svg",
  meteoblue: "/integrations/meteoblue.png",
  weenat: "/integrations/weenat.webp",
  sencrop: "/integrations/sencrop.png",
  copernicus: "/integrations/copernicus.png",
  agrirouter: "/integrations/agrirouter.svg",
  "open-meteo": "/integrations/open-meteo.png",
};

/** Feu d'un service : vert allumé (actif), rouge (en erreur), éteint (non configuré ou désactivé). */
type Light = "on" | "error" | "off";

function StatusLight({ light, label, pulse }: { light: Light; label: string; pulse?: boolean }) {
  const color = light === "on" ? "var(--mantine-color-lichen-6)" : light === "error" ? "var(--mantine-color-brique-6)" : "var(--mantine-color-gray-4)";
  return (
    <Tooltip label={label} withArrow>
      <Box
        role="img"
        aria-label={label}
        w={14}
        h={14}
        style={{
          flex: "none",
          borderRadius: "50%",
          background: light === "off" ? "transparent" : color,
          border: `2px solid ${color}`,
          boxShadow: light === "off" ? "none" : `0 0 6px 1px ${color}`,
          animation: pulse ? "fourmy-pulse 1.2s ease-in-out infinite" : undefined,
        }}
      />
    </Tooltip>
  );
}

/** Icône de chaque catégorie et de chaque service (lucide, à défaut de logo). */
const CATEGORY_ICONS: Record<IntegrationCategory, LucideIcon> = {
  weather: CloudSun,
  gps_equipment: Navigation,
  remote_sensing: Satellite,
  machine_data: Tractor,
  decision_support: Lightbulb,
};
const PROVIDER_ICONS: Record<string, LucideIcon> = {
  traccar: Navigation,
  openweather: CloudSun,
  meteoblue: CloudRain,
  weenat: Thermometer,
  sencrop: Gauge,
  copernicus: Satellite,
  agrirouter: Cable,
  "open-meteo": Sun,
};

/** Tuile d'un service : icône, nom, état, et sa configuration dans une fenêtre. */
function ProviderTile({
  provider,
  title,
  summary,
  badge,
  children,
}: {
  provider: string;
  title: string;
  summary: string;
  badge: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = PROVIDER_ICONS[provider] ?? Plug;
  const logo = PROVIDER_LOGOS[provider];
  const [name] = title.split(" — ");
  return (
    <Paper withBorder p="sm" radius="md" data-testid={`tile-${provider}`}>
      <Stack gap={6} h="100%">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="xs" wrap="nowrap">
            {logo ? (
              <Box w={40} h={40} p={4} bg="white" style={{ flex: "none", borderRadius: 8, border: "1px solid var(--mantine-color-default-border)" }}>
                <Image src={logo} alt={`Logo ${name}`} w="100%" h="100%" fit="contain" />
              </Box>
            ) : (
              <ThemeIcon variant="light" color="lichen" size={40} radius="md">
                <Icon size={18} />
              </ThemeIcon>
            )}
            <Title order={3} size="h5">
              {title}
            </Title>
          </Group>
          {badge}
        </Group>
        <Text size="xs" c="dimmed" lineClamp={3} style={{ flex: 1 }}>
          {summary}
        </Text>
        {children && (
          <Button size="xs" variant="light" w="fit-content" onClick={() => setOpen(true)} aria-label={`Configurer ${name}`}>
            Configurer
          </Button>
        )}
      </Stack>
      {children && (
        <Modal opened={open} onClose={() => setOpen(false)} title={title} size="lg">
          {children}
        </Modal>
      )}
    </Paper>
  );
}

const statusBadge = (integration: Integration | null) =>
  !integration ? (
    <StatusLight light="off" label="Non configurée" />
  ) : !integration.enabled ? (
    <StatusLight light="off" label="Désactivée" />
  ) : integration.status === "error" || integration.status === "disconnected" ? (
    <StatusLight light="error" label={STATUS[integration.status].label} />
  ) : (
    <StatusLight light="on" label={integration.running ? "Synchronisation…" : STATUS[integration.status].label} pulse={integration.running} />
  );

/**
 * Intégrations de la ferme (responsable) : un pavé par catégorie, une tuile
 * par service (icône, état) ; la configuration, construite à partir de la
 * description du service, s'ouvre dans une fenêtre. Le secret saisi est
 * envoyé une fois, chiffré par le serveur et jamais réaffiché (seuls ses 4
 * derniers caractères).
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
      {/* Feu d'un service en cours de synchronisation : il pulse. */}
      <style>{"@keyframes fourmy-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }"}</style>
      <Title order={1}>Intégrations</Title>
      <Text c="dimmed" size="sm">
        Services externes reliés à cette ferme. Les accès (jetons, mots de passe) sont chiffrés et ne sont jamais réaffichés.
      </Text>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        {INTEGRATION_CATEGORIES.map(({ category, label, description }) => {
          const inCategory = providers.filter((d) => d.category === category);
          const withOpenMeteo = category === "weather";
          if (!inCategory.length && !withOpenMeteo) return null;
          const Icon = CATEGORY_ICONS[category] ?? Plug;
          const active = inCategory.filter((d) => items.some((i) => i.provider === d.provider && i.enabled)).length + (withOpenMeteo ? 1 : 0);
          return (
            <Paper key={category} p="md" radius="md" component="section" aria-labelledby={`integrations-${category}`}>
              <Stack gap="sm">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon size={40} radius="md" variant="filled" color="lichen">
                      <Icon size={22} />
                    </ThemeIcon>
                    <div>
                      <Title order={2} size="h4" id={`integrations-${category}`}>
                        {label}
                      </Title>
                      <Text size="xs" c="dimmed">
                        {description}
                      </Text>
                    </div>
                  </Group>
                  <Badge variant="light" color={active ? "lichen" : "gray"} style={{ flex: "none" }}>
                    {active} active{active > 1 ? "s" : ""}
                  </Badge>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {inCategory.map((definition) => {
                    const integration = items.find((i) => i.provider === definition.provider) ?? null;
                    return (
                      <ProviderTile key={definition.provider} provider={definition.provider} title={definition.label} summary={definition.description} badge={statusBadge(integration)}>
                        {definition.connect === "oauth" ? (
                          <AgrirouterCard farmId={farm.id} definition={definition} integration={integration} />
                        ) : (
                          <ProviderCard farmId={farm.id} definition={definition} integration={integration} />
                        )}
                      </ProviderTile>
                    );
                  })}
                  {withOpenMeteo && (
                    <ProviderTile
                      provider="open-meteo"
                      title="Open-Meteo — météo"
                      summary="Gratuit et sans clé : prévisions et historique depuis 1940. Utilisé quand ni meteoblue ni OpenWeather ne sont actifs."
                      badge={<StatusLight light="on" label="Actif par défaut" />}
                    />
                  )}
                </SimpleGrid>
                {withOpenMeteo && <StationsCard farmId={farm.id} />}
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
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
  // Connexion défaite dans agrirouter (autorisation retirée, point de terminaison supprimé), constatée par Fourmy.
  const disconnected = !connected && integration?.status === "disconnected";
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
          {disconnected && <Badge color="brique">Déconnectée</Badge>}
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
            <Anchor component={Link} to={`/f/${farmId}/agrirouter/inbox`} size="sm">
              Fichiers reçus d'agrirouter
            </Anchor>
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
        ) : disconnected ? (
          <>
            <Alert color="brique" title={`Déconnectée${integration!.settings.disconnectedAt ? ` le ${formatDate(String(integration!.settings.disconnectedAt))}` : ""}`}>
              {integration!.lastError ?? "La connexion a été défaite dans agrirouter."} Les cartes ne peuvent plus être envoyées tant que la ferme n'est pas reconnectée.
            </Alert>
            <Group>
              <Button onClick={() => connect.mutate()} loading={connect.isPending} disabled={definition.available === false}>
                Reconnecter
              </Button>
              <Button variant="subtle" color="brique" onClick={() => remove.mutate()} loading={remove.isPending}>
                Retirer
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
    // Test de Copernicus : acquisitions Sentinel-2 des 30 derniers jours au-dessus de la ferme.
    acquisitions?: number | null;
    dates?: string[];
    note?: string;
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
        {test && (typeof report?.acquisitions === "number" || report?.note) && (
          <Alert color="lichen" title="Connexion réussie">
            {typeof report?.acquisitions === "number"
              ? `${report.acquisitions} acquisition(s) Sentinel-2 au-dessus de la ferme sur les 30 derniers jours${report.dates?.length ? `, la dernière le ${formatDate(report.dates.at(-1)!)}` : ""}.`
              : report?.note}
          </Alert>
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
