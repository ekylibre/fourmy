import { useMemo, useState } from "react";
import { Accordion, Alert, Anchor, Badge, Button, Code, Container, CopyButton, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Bot, Copy, Download, KeyRound, Search, ShieldCheck } from "lucide-react";
import { Wordmark } from "@fourmy/ui-lyvre";
import { api, ApiError } from "../../app/api";

/**
 * Page « Développeurs » (lot AM7, conception_api_mcp.md §6.3) : comment
 * s'authentifier, un premier appel, et la référence tirée de
 * `/api/v1/openapi.json`. Publique ; `?ferme=<id>` remplit les exemples.
 */

type Schema = { type?: string | string[]; format?: string; enum?: unknown[]; anyOf?: Schema[]; items?: Schema; $ref?: string };
type Param = { name: string; in: string; required?: boolean; description?: string; schema?: Schema; $ref?: string };
type Operation = {
  operationId: string;
  summary: string;
  tags: string[];
  parameters: Param[];
  responses: Record<string, { description: string; content?: Record<string, { schema?: Schema }>; $ref?: string }>;
  requestBody?: { content: Record<string, { schema?: Schema }> };
};
type Method = "get" | "post";
type OpenApi = {
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Partial<Record<Method, Operation>>>;
  components: { schemas: Record<string, unknown>; securitySchemes: { oauth2: { flows: { authorizationCode: { authorizationUrl: string; tokenUrl: string } } } } };
};

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/** Type lisible d'un paramètre (« entier », « date », « planned | done »). */
function typeLabel(s: Schema | undefined): string {
  if (!s) return "";
  if (s.enum) return s.enum.map(String).join(" | ");
  if (s.anyOf) return s.anyOf.map(typeLabel).join(" ou ");
  if (s.format === "date") return "date";
  if (s.format === "uuid") return "identifiant";
  if (s.type === "integer") return "entier";
  if (s.type === "number") return "nombre";
  if (s.type === "boolean") return "booléen";
  return "texte";
}

function CopyLine({ value, label }: { value: string; label: string }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <TextInput value={value} readOnly aria-label={label} style={{ flex: 1 }} ff="monospace" onFocus={(e) => e.currentTarget.select()} />
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Button variant="light" leftSection={<Copy size={14} />} onClick={copy}>
            {copied ? "Copié" : "Copier"}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}

/** Opérations à plat : chemin, méthode, opération. */
const operations = (doc: OpenApi) =>
  Object.entries(doc.paths).flatMap(([path, methods]) => (["get", "post"] as const).flatMap((method) => (methods[method] ? [{ path, method, op: methods[method] }] : [])));

function OperationPanel({ op, doc }: { op: Operation; doc: OpenApi }) {
  const [showSchema, setShowSchema] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const params = op.parameters.filter((p) => !p.$ref);
  const ok = op.responses["200"] ?? op.responses["201"];
  const body = op.requestBody?.content["application/json"]?.schema?.$ref?.split("/").pop();
  const types = Object.keys(ok?.content ?? {});
  const ref = ok?.content?.["application/json"]?.schema?.$ref?.split("/").pop();
  return (
    <Stack gap="sm">
      {params.length > 0 && (
        <Table withTableBorder fz="sm" aria-label={`Paramètres de ${op.operationId}`}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Paramètre</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Description</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {params.map((p) => (
              <Table.Tr key={`${p.in}-${p.name}`}>
                <Table.Td>
                  <Code>{p.name}</Code>
                  {p.required && (
                    <Badge size="xs" ml={6} variant="light" color="brique">
                      obligatoire
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{typeLabel(p.schema)}</Table.Td>
                <Table.Td>{p.in === "path" ? "Dans le chemin" : p.description}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {body && (
        <div>
          <Button size="compact-sm" variant="subtle" onClick={() => setShowBody((v) => !v)}>
            {showBody ? "Masquer le corps" : `Corps de la requête (${body})`}
          </Button>
          {showBody && (
            <Code block mt="xs" mah={420} style={{ overflow: "auto" }}>
              {JSON.stringify(doc.components.schemas[body], null, 2)}
            </Code>
          )}
        </div>
      )}
      <Text size="sm">
        Réponse : {types.map((t) => <Code key={t} mr={4}>{t}</Code>)}
      </Text>
      {ref && (
        <div>
          <Button size="compact-sm" variant="subtle" onClick={() => setShowSchema((v) => !v)}>
            {showSchema ? "Masquer le schéma" : `Schéma de la réponse (${ref})`}
          </Button>
          {showSchema && (
            <Code block mt="xs" mah={420} style={{ overflow: "auto" }}>
              {JSON.stringify(doc.components.schemas[ref], null, 2)}
            </Code>
          )}
        </div>
      )}
    </Stack>
  );
}

function Reference({ doc }: { doc: OpenApi }) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return doc.tags
      .map((t) => ({
        ...t,
        ops: operations(doc).filter(({ path, op }) => op.tags.includes(t.name) && (!f || path.toLowerCase().includes(f) || op.summary.toLowerCase().includes(f))),
      }))
      .filter((g) => g.ops.length > 0);
  }, [doc, filter]);
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <TextInput
          leftSection={<Search size={14} />}
          placeholder="Filtrer : parcelles, /stock…"
          aria-label="Filtrer les routes"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          w={320}
          maw="100%"
        />
        <Button component="a" href="/api/v1/openapi.json" target="_blank" variant="light" leftSection={<Download size={14} />}>
          openapi.json
        </Button>
      </Group>
      {groups.map((g) => (
        <Stack key={g.name} gap={6}>
          <Title order={4}>{g.description}</Title>
          <Accordion variant="separated" chevronPosition="left">
            {g.ops.map(({ path, method, op }) => (
              <Accordion.Item key={`${method} ${path}`} value={`${method} ${path}`}>
                <Accordion.Control>
                  <Group gap="sm" wrap="nowrap">
                    <Badge variant="light" color={method === "post" ? "paille" : "lichen"} w={52}>
                      {method.toUpperCase()}
                    </Badge>
                    <Code>{path}</Code>
                    <Text size="sm" c="dimmed" visibleFrom="sm" lineClamp={1}>
                      {op.summary}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" mb="xs" hiddenFrom="sm">
                    {op.summary}
                  </Text>
                  <OperationPanel op={op} doc={doc} />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Stack>
      ))}
      {!groups.length && (
        <Text size="sm" c="dimmed">
          Aucune route ne correspond.
        </Text>
      )}
    </Stack>
  );
}

export function DevelopersPage() {
  const [params] = useSearchParams();
  const farmId = params.get("ferme") ?? "{farmId}";
  const origin = globalThis.location?.origin ?? "";
  const doc = useQuery({ queryKey: ["openapi"], queryFn: () => api.get<OpenApi>("/openapi.json"), staleTime: 5 * 60_000 });
  const server = doc.data?.servers[0]?.url ?? `${origin}/api/v1`;
  const flows = doc.data?.components.securitySchemes.oauth2.flows.authorizationCode;
  const curl = `curl -H "x-api-key: fmy_…" \\\n  ${server}/farms/${farmId}/land-parcels/names`;

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Wordmark style={{ fontSize: "1.6rem" }} />
          <Title order={1}>Développeurs</Title>
          <Text maw={760}>
            L'API de Fourmy donne accès en lecture aux données d'une ferme : parcelles, activités, interventions, registres, stocks, matériels… Un accès
            en écriture y propose des interventions, que le responsable valide. Chaque accès est donné par le responsable de la ferme, pour des modules
            et des activités choisis, et peut être révoqué à tout moment.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <Paper withBorder p="md" radius="md">
            <Stack gap="xs">
              <Group gap="xs">
                <KeyRound size={18} />
                <Text fw={600}>Clé d'API</Text>
              </Group>
              <Text size="sm">
                Pour un script ou un logiciel. Le responsable la crée dans <em>Ferme → Accès externes</em> ; elle commence par <Code>fmy_</Code> et ne s'affiche
                qu'une fois. Envoyez-la dans l'en-tête <Code>x-api-key</Code>.
              </Text>
            </Stack>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Stack gap="xs">
              <Group gap="xs">
                <ShieldCheck size={18} />
                <Text fw={600}>Application OAuth</Text>
              </Group>
              <Text size="sm">
                Pour un service utilisé par plusieurs fermes : autorisation par code avec PKCE, et la ressource <Code>{server}</Code>. L'utilisateur choisit la
                ferme et ce qu'il ouvre ; la ferme est dans le jeton (<Code>fourmy_farm</Code>).
              </Text>
              {flows && (
                <Text size="xs" c="dimmed">
                  Autorisation : <Code>{flows.authorizationUrl}</Code>
                  <br />
                  Jeton : <Code>{flows.tokenUrl}</Code>
                </Text>
              )}
            </Stack>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Stack gap="xs">
              <Group gap="xs">
                <Bot size={18} />
                <Text fw={600}>Assistant IA (MCP)</Text>
              </Group>
              <Text size="sm">Ajoutez Fourmy comme connecteur dans votre assistant avec cette adresse : il s'authentifie par OAuth.</Text>
              <CopyLine value={`${origin}/mcp`} label="Adresse du serveur MCP" />
            </Stack>
          </Paper>
        </SimpleGrid>

        <Stack gap="xs">
          <Title order={2}>Premier appel</Title>
          {params.get("ferme") ? (
            <Text size="sm">Identifiant de votre ferme, à placer dans chaque chemin :</Text>
          ) : (
            <Text size="sm">
              Chaque chemin commence par l'identifiant de la ferme, que le responsable trouve dans <em>Ferme → Accès externes</em>.
            </Text>
          )}
          {params.get("ferme") && <CopyLine value={farmId} label="Identifiant de la ferme" />}
          <Code block>{curl}</Code>
          <Text size="sm" c="dimmed" maw={760}>
            Les erreurs suivent la RFC 9457 (<Code>application/problem+json</Code>) : 401 sans clé valable, 403 pour un module non ouvert, 404 pour une route
            qui n'est pas ouverte aux accès externes, 429 au-delà du débit autorisé (en-tête <Code>Retry-After</Code>).
          </Text>
        </Stack>

        <Stack gap="xs">
          <Title order={2}>Référence</Title>
          {doc.isLoading && <Loader size="sm" />}
          {doc.error && <Alert color="brique">{message(doc.error)}</Alert>}
          {doc.data && (
            <>
              <Text size="sm" c="dimmed">
                {operations(doc.data).length} routes, version {doc.data.info.version}. Le document{" "}
                <Anchor href="/api/v1/openapi.json" target="_blank">
                  openapi.json
                </Anchor>{" "}
                (OpenAPI 3.1) se charge dans Postman, Insomnia ou un générateur de client.
              </Text>
              <Reference doc={doc.data} />
            </>
          )}
        </Stack>
      </Stack>
    </Container>
  );
}
