import { useState } from "react";
import { Alert, Anchor, Badge, Button, Code, CopyButton, Group, Modal, Paper, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { Link } from "react-router";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Code2, Copy, KeyRound, ScrollText, Trash2 } from "lucide-react";
import { ACCESS_MODULE_LABELS, accessModules, type AccessGrant, type AccessLogEntry, type FarmAccess, type FarmAccessCreated } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatDateTime } from "../../app/labels";
import { AccessGrantEditor, grantUsable } from "../team/AccessGrantEditor";

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const DURATIONS = [
  { value: "90", label: "3 mois" },
  { value: "30", label: "1 mois" },
  { value: "365", label: "1 an" },
  { value: "none", label: "Sans expiration" },
];

/** Résumé des droits : modules ouverts et activités. */
export function grantSummary(g: AccessGrant): string {
  const modules = accessModules
    .filter((m) => g.modules[m] && g.modules[m] !== "none")
    .map((m) => `${ACCESS_MODULE_LABELS[m]}${g.modules[m] === "write" ? " (et propositions)" : ""}`);
  const acts = g.activities === "all" ? "toutes activités" : `${g.activities.length} activité${g.activities.length > 1 ? "s" : ""}`;
  return `${modules.join(", ") || "aucun module"} · ${acts}`;
}

const status = (a: FarmAccess) =>
  a.revokedAt ? (
    <Badge color="gray">Révoquée</Badge>
  ) : a.expiresAt && new Date(a.expiresAt) <= new Date() ? (
    <Badge color="brique">Expirée</Badge>
  ) : (
    <Badge color="lichen">Active</Badge>
  );

/**
 * Accès externes de la ferme (lot AM4, conception_api_mcp.md §9) : clés
 * d'API pour un script ou un logiciel. Le responsable voit toutes les clés de
 * la ferme ; un autre membre, les siennes (en lecture seulement pour un compte
 * en lecture seule). Une clé n'est affichée qu'une fois.
 */
export function AccessesTab() {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const key = ["accesses", farm.id];
  const list = useQuery({ queryKey: key, queryFn: () => api.get<{ items: FarmAccess[] }>(farmPath(farm.id, "/accesses")) });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<FarmAccessCreated | null>(null);
  const [revoking, setRevoking] = useState<FarmAccess | null>(null);
  const [logOf, setLogOf] = useState<FarmAccess | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(farmPath(farm.id, `/accesses/${id}`)),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Accès révoqué : il est refusé dès maintenant." });
      setRevoking(null);
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", title: "Refusé", message: message(e) }),
  });

  return (
    <Stack gap="md" maw={1100}>
      <Text size="sm" c="dimmed">
        Une clé d'API permet à un script ou à un logiciel (comptabilité, outil d'un conseiller) de lire les données de la ferme, sans votre mot de passe. Une
        application (assistant IA, service connecté) s'autorise elle-même : vous choisissez alors ce qu'elle voit sur l'écran de consentement. Un accès
        n'ouvre que les modules et les activités choisis, jamais plus que vos propres droits, et ne peut rien modifier.
        {farm.role !== "owner" && " Vous voyez ici vos propres clés."}
      </Text>
      <ConnectAssistant />
      <DeveloperHint />
      <Group>
        <Button leftSection={<KeyRound size={16} />} onClick={() => setCreating(true)}>
          Créer une clé
        </Button>
      </Group>
      {list.error && <Alert color="brique">{message(list.error)}</Alert>}
      {list.data && !list.data.items.length && (
        <Text size="sm" c="dimmed">
          Aucune clé pour l'instant.
        </Text>
      )}
      {!!list.data?.items.length && (
        <Table striped highlightOnHover aria-label="Accès externes">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th>
              <Table.Th>Droits</Table.Th>
              <Table.Th>Auteur</Table.Th>
              <Table.Th>Clé</Table.Th>
              <Table.Th>Dernière utilisation</Table.Th>
              <Table.Th>Expire</Table.Th>
              <Table.Th>État</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.data.items.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    {a.name}
                    <Badge size="xs" variant="light" color={a.kind === "oauth" ? "lichen" : "ardoise"}>
                      {a.kind === "oauth" ? "Application" : "Clé"}
                    </Badge>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{grantSummary(a.grant)}</Text>
                </Table.Td>
                <Table.Td>{a.user.name}</Table.Td>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {a.keyStart ? `${a.keyStart}…` : "—"}
                  </Text>
                </Table.Td>
                <Table.Td>{a.lastUsedAt ? formatDateTime(a.lastUsedAt) : "Jamais"}</Table.Td>
                <Table.Td>{a.expiresAt ? formatDateTime(a.expiresAt) : "Jamais"}</Table.Td>
                <Table.Td>{status(a)}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="subtle" leftSection={<ScrollText size={14} />} onClick={() => setLogOf(a)}>
                      Journal
                    </Button>
                    {!a.revokedAt && (
                      <Button size="compact-xs" variant="subtle" color="brique" leftSection={<Trash2 size={14} />} onClick={() => setRevoking(a)}>
                        Révoquer
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <CreateKey
        opened={creating}
        onClose={() => setCreating(false)}
        onCreated={(r) => {
          setCreating(false);
          setCreated(r);
          refresh();
        }}
      />
      <Modal opened={created !== null} onClose={() => setCreated(null)} title="Clé créée" size="lg">
        {created && (
          <Stack gap="sm">
            <Alert color="paille" title="Copiez la clé maintenant">
              Elle ne sera plus affichée. Gardez-la comme un mot de passe ; en cas de doute, révoquez-la et créez-en une autre.
            </Alert>
            <Group gap="xs" wrap="nowrap">
              <TextInput value={created.key} readOnly aria-label="Clé d'API" style={{ flex: 1 }} ff="monospace" onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={created.key}>
                {({ copied, copy }) => (
                  <Button variant="light" leftSection={<Copy size={14} />} onClick={copy}>
                    {copied ? "Copiée" : "Copier"}
                  </Button>
                )}
              </CopyButton>
            </Group>
            {!!created.access.reduced?.length && (
              <Alert color="ardoise">
                Droits réduits aux vôtres pour : {created.access.reduced.map((m) => ACCESS_MODULE_LABELS[m]).join(", ")}.
              </Alert>
            )}
            <Text size="xs" c="dimmed">
              À envoyer dans l'en-tête <code>x-api-key</code> des appels à l'API de la ferme.
            </Text>
          </Stack>
        )}
      </Modal>
      <Modal opened={revoking !== null} onClose={() => setRevoking(null)} title={revoking?.kind === "oauth" ? "Retirer l'accès de l'application" : "Révoquer la clé"}>
        <Text size="sm">
          {revoking?.kind === "oauth"
            ? `L'application « ${revoking.name} » n'aura plus accès à la ferme, dès maintenant. Pour la reconnecter, il faudra l'autoriser à nouveau.`
            : `La clé « ${revoking?.name ?? ""} » sera refusée dès maintenant. Les logiciels qui l'utilisent n'auront plus accès à la ferme.`}
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setRevoking(null)}>
            Annuler
          </Button>
          <Button color="brique" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>
            Révoquer
          </Button>
        </Group>
      </Modal>
      <Modal opened={logOf !== null} onClose={() => setLogOf(null)} title={`Journal de « ${logOf?.name ?? ""} »`} size="xl">
        {logOf && <AccessLog farmId={farm.id} access={logOf} />}
      </Modal>
    </Stack>
  );
}

/**
 * Connecter un assistant IA (lot AM6) : l'adresse du serveur MCP de Fourmy et
 * les étapes. L'assistant s'autorise lui-même (OAuth) : écran de consentement.
 */
function ConnectAssistant() {
  const url = `${globalThis.location?.origin ?? ""}/mcp`;
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Group gap="xs">
          <Bot size={18} />
          <Text fw={600}>Connecter un assistant IA</Text>
        </Group>
        <Text size="sm">
          Ajoutez Fourmy comme connecteur MCP dans votre assistant (Claude, ChatGPT, Le Chat…) avec cette adresse. L'assistant vous renvoie ici pour vous
          connecter, choisir la ferme et ce qu'il pourra consulter. Il apparaît ensuite dans la liste ci-dessous.
        </Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput value={url} readOnly aria-label="Adresse du serveur MCP" style={{ flex: 1 }} ff="monospace" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton value={url}>
            {({ copied, copy }) => (
              <Button variant="light" leftSection={<Copy size={14} />} onClick={copy}>
                {copied ? "Copiée" : "Copier"}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Text size="xs" c="dimmed">
          Un script peut aussi s'y connecter avec une clé d'API, dans l'en-tête <code>x-api-key</code>. L'assistant ne peut rien modifier.
        </Text>
      </Stack>
    </Paper>
  );
}

/** Pour un développeur : l'identifiant de la ferme et la documentation de l'API (lot AM7). */
function DeveloperHint() {
  const farm = useFarm();
  return (
    <Group gap="xs">
      <Code2 size={16} />
      <Text size="sm">
        Identifiant de la ferme pour l'API : <Code>{farm.id}</Code> ·{" "}
        <Anchor component={Link} to={`/developpeurs?ferme=${farm.id}`}>
          Documentation de l'API
        </Anchor>
      </Text>
    </Group>
  );
}

function CreateKey({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: (r: FarmAccessCreated) => void }) {
  const farm = useFarm();
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("90");
  const [grant, setGrant] = useState<AccessGrant>({ modules: { activities: "read", interventions: "read" }, activities: "all" });
  const create = useMutation({
    mutationFn: () =>
      api.post<FarmAccessCreated>(farmPath(farm.id, "/accesses"), {
        name: name.trim(),
        grant,
        expiresInDays: duration === "none" ? null : Number(duration),
      }),
    onSuccess: (r) => {
      setName("");
      onCreated(r);
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Créer une clé d'API" size="lg">
      <Stack gap="md">
        <TextInput label="Nom" description="Pour la reconnaître : logiciel, personne, usage." placeholder="Export comptable" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={100} />
        <Select label="Durée de validité" data={DURATIONS} value={duration} allowDeselect={false} onChange={(v) => v && setDuration(v)} />
        <AccessGrantEditor farmId={farm.id} value={grant} onChange={setGrant} writable={farm.role === "owner" || farm.role === "worker"} />
        {create.error && <Alert color="brique">{message(create.error)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!name.trim() || !grantUsable(grant)} loading={create.isPending} onClick={() => create.mutate()}>
            Créer la clé
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AccessLog({ farmId, access }: { farmId: string; access: FarmAccess }) {
  const log = useQuery({
    queryKey: ["accesses", farmId, access.id, "log"],
    queryFn: () => api.get<{ items: AccessLogEntry[] }>(farmPath(farmId, `/accesses/${access.id}/log?limit=200`)),
  });
  if (log.error) return <Alert color="brique">{message(log.error)}</Alert>;
  if (!log.data) return null;
  if (!log.data.items.length) return <Text size="sm">Aucun appel enregistré (le journal garde 90 jours).</Text>;
  return (
    <Table striped aria-label="Journal des appels">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Date</Table.Th>
          <Table.Th>Appel</Table.Th>
          <Table.Th>Réponse</Table.Th>
          <Table.Th>Durée</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {log.data.items.map((l, i) => (
          <Table.Tr key={`${l.at}-${i}`}>
            <Table.Td>{formatDateTime(l.at)}</Table.Td>
            <Table.Td>
              <Text size="xs" ff="monospace">
                {l.operation}
              </Text>
            </Table.Td>
            <Table.Td>
              <Badge color={l.status < 300 ? "lichen" : l.status === 429 ? "paille" : "brique"} variant="light">
                {l.status}
              </Badge>
            </Table.Td>
            <Table.Td>{l.durationMs === null ? "—" : `${l.durationMs} ms`}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
