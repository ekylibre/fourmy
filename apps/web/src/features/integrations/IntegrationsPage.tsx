import { useState } from "react";
import { Alert, Badge, Button, Group, List, Paper, PasswordInput, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Integration, IntegrationProviderDefinition } from "@fourmy/contracts";
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
      {providers.map((definition) => (
        <ProviderCard
          key={definition.provider}
          farmId={farm.id}
          definition={definition}
          integration={items.find((i) => i.provider === definition.provider) ?? null}
        />
      ))}
      <Paper p="md" data-testid="integration-open-meteo">
        <Group justify="space-between">
          <Title order={2}>Open-Meteo — météo</Title>
          <Badge color="lichen">Actif par défaut</Badge>
        </Group>
        <Text size="sm" c="dimmed" mt={4}>
          Gratuit et sans clé : prévisions et historique depuis 1940 pour la météo des interventions et les conditions de
          pulvérisation. Utilisé quand ni meteoblue ni OpenWeather ne sont actifs, et toujours pour le passé.
        </Text>
      </Paper>
    </Stack>
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
          <Title order={2}>{definition.label}</Title>
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
