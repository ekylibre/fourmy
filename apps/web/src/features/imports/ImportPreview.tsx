import { Alert, Badge, Button, Checkbox, Group, List, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImportPreview as Preview, ImportRunView } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { procedureLabel } from "../../app/labels";

const fmt = (n: number) => n.toLocaleString("fr-FR");

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Paper withBorder p="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600} className="lv-num">
        {typeof value === "number" ? fmt(value) : value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

const createLink = (x: { create: number; link: number }) => (x.link ? `${fmt(x.create)} nouvelles, ${fmt(x.link)} déjà connues` : `${fmt(x.create)} nouvelles`);

/**
 * Aperçu d'un fichier analysé (lots IM5 et IM6) : ce que l'import créera ou
 * reliera, ce qu'il laissera de côté et pourquoi, les avertissements. Le
 * responsable valide (écriture en tâche de fond) ou abandonne.
 */
export function ImportPreview({
  farmId,
  run,
  onChange,
  actions = true,
}: {
  farmId: string;
  run: ImportRunView;
  onChange: (run: ImportRunView) => void;
  /** Boutons Importer / Abandonner (l'assistant importe à son étape « Import »). */
  actions?: boolean;
}) {
  const client = useQueryClient();
  const p = run.preview as Preview;
  const r = p.reconciliation;
  const blocking = p.warnings.filter((w) => w.level === "blocking");
  const refresh = (next: ImportRunView) => {
    void client.invalidateQueries({ queryKey: ["file-imports", farmId] });
    onChange(next);
  };
  const decide = useMutation({
    mutationFn: (confirmSiret: boolean) => api.put<ImportRunView>(farmPath(farmId, `/imports/${run.id}/decisions`), { ...run.decisions, confirmSiret }),
    onSuccess: refresh,
  });
  const apply = useMutation({ mutationFn: () => api.post<ImportRunView>(farmPath(farmId, `/imports/${run.id}/apply`), {}), onSuccess: refresh });
  const discard = useMutation({ mutationFn: () => api.post<ImportRunView>(farmPath(farmId, `/imports/${run.id}/discard`), {}), onSuccess: refresh });
  const error = decide.error ?? apply.error ?? discard.error;
  const identity = p.farm.identity;
  const editable = run.status === "analyzed";

  return (
    <Stack aria-label="Aperçu de l'import">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {p.fileName}
          {p.producedBy ? ` · ${p.producedBy}` : ""}
          {p.campaigns.length ? ` · campagne${p.campaigns.length > 1 ? "s" : ""} ${p.campaigns.join(", ")}` : ""}
        </Text>
      </Group>
      {(identity.name || identity.siret) && (
        <Text size="sm">
          Exploitation : {identity.name ?? "—"}
          {identity.siret ? ` · SIRET ${identity.siret}` : ""}
          {identity.pacage ? ` · PACAGE ${identity.pacage}` : ""}
          {p.farm.siretMatches === true && (
            <Badge ml="xs" size="sm" color="lichen" variant="light">
              votre ferme
            </Badge>
          )}
        </Text>
      )}

      {r && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          <Stat label="Parcelles" value={r.parcels.create + r.parcels.link} hint={createLink(r.parcels)} />
          <Stat label="Cultures" value={r.productions.create + r.productions.link} hint={createLink(r.productions)} />
          {r.history.create + r.history.link > 0 && <Stat label="Campagnes passées" value={r.history.create + r.history.link} hint="cultures N-1 à N-5" />}
          {r.covers.create + r.covers.link > 0 && <Stat label="Couverts" value={r.covers.create + r.covers.link} hint="d'interculture" />}
          <Stat label="Interventions" value={r.interventions.create} hint={r.interventions.alreadyImported ? `${fmt(r.interventions.alreadyImported)} déjà importées` : undefined} />
          <Stat label="Articles" value={r.articles.length} hint={`${fmt(r.articles.filter((a) => a.action === "create").length)} à créer`} />
          {r.capRefs.parcels > 0 && <Stat label="Parcelles PAC" value={r.capRefs.parcels} hint={`${fmt(r.capRefs.islets)} îlots`} />}
          {r.landscape.create + r.landscape.link > 0 && <Stat label="Haies et arbres" value={r.landscape.create + r.landscape.link} hint="éléments déclarés" />}
        </SimpleGrid>
      )}

      {r && r.activities.length > 0 && (
        <Paper withBorder p="sm">
          <Title order={5} mb="xs">
            Activités
          </Title>
          <Group gap="xs">
            {r.activities.map((a) => (
              <Badge key={a.key} variant={a.action === "create" ? "light" : "outline"} color={a.reference ? "lichen" : "paille"} title={a.referenceLabel ?? "Sans production de référence"}>
                {a.name} · {a.productions}
              </Badge>
            ))}
          </Group>
        </Paper>
      )}

      {r && r.interventions.byProcedure.length > 0 && (
        <Table fz="sm" aria-label="Interventions par procédure">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Intervention</Table.Th>
              <Table.Th ta="right">Réalisées</Table.Th>
              <Table.Th ta="right">Prévues</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {r.interventions.byProcedure.map((x) => (
              <Table.Tr key={x.procedure}>
                <Table.Td>{procedureLabel(x.procedure)}</Table.Td>
                <Table.Td ta="right" className="lv-num">
                  {x.done}
                </Table.Td>
                <Table.Td ta="right" className="lv-num">
                  {x.planned}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {r && r.interventions.skipped.length > 0 && (
        <Alert color="paille" title={`${r.interventions.skipped.length} intervention(s) laissée(s) de côté`}>
          <List size="sm">
            {r.interventions.skipped.slice(0, 8).map((s, i) => (
              <List.Item key={i}>
                {s.label} du {s.on} : {s.reason}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {p.notImported.length > 0 && (
        <Text size="sm" c="dimmed">
          Non importé : {p.notImported.map((n) => `${n.label} (${fmt(n.count)})`).join(", ")}.
        </Text>
      )}
      {p.warnings
        .filter((w) => w.level !== "info")
        .map((w, i) => (
          <Alert key={i} color={w.level === "blocking" ? "brique" : "paille"}>
            {w.message}
          </Alert>
        ))}

      {editable && actions && (
        <Group>
          {p.farm.siretMatches === false && (
            <Checkbox
              label="Ce fichier concerne bien ma ferme"
              checked={!!run.decisions.confirmSiret}
              onChange={(e) => decide.mutate(e.currentTarget.checked)}
              disabled={decide.isPending}
            />
          )}
          <Button onClick={() => apply.mutate()} loading={apply.isPending} disabled={blocking.length > 0 || !p.readable}>
            Importer
          </Button>
          <Button variant="subtle" color="gray" onClick={() => discard.mutate()} loading={discard.isPending}>
            Abandonner
          </Button>
        </Group>
      )}
      {error && <Alert color="brique">{error instanceof ApiError ? (error.detail ?? error.title) : String(error)}</Alert>}
    </Stack>
  );
}
