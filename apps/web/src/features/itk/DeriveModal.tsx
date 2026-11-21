import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, ScrollArea, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProcedure, unitLabel, type ItkDeriveResult, type ItkDetail, type ItkHistoryCampaign, type ItkWrite } from "@fourmy/contracts";
import { anchorLabel } from "@fourmy/domain";
import { api, ApiError, farmPath } from "../../app/api";
import { itksKey } from "./queries";

const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

/**
 * « Créer depuis l'historique » (lot IT2, conception §5) : choix de
 * l'activité et des campagnes, proposition calculée sur les interventions
 * réalisées (rien n'est enregistré), relecture, puis création de l'ITK.
 */
export function DeriveModal({
  farmId,
  activityOptions,
  defaultActivityId,
  onClose,
  onCreated,
}: {
  farmId: string;
  activityOptions: { value: string; label: string }[];
  defaultActivityId: string | null;
  onClose: () => void;
  onCreated: (t: ItkDetail) => void;
}) {
  const queryClient = useQueryClient();
  const [activityId, setActivityId] = useState<string | null>(defaultActivityId);
  const [years, setYears] = useState<string[]>([]);
  const [proposal, setProposal] = useState<ItkDeriveResult | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: [...itksKey(farmId), "history", activityId],
    queryFn: () => api.get<{ items: ItkHistoryCampaign[] }>(farmPath(farmId, `/technical-itineraries/history?activityId=${activityId}`)),
    enabled: !!activityId,
  });
  // Par défaut : les deux dernières campagnes avec des interventions.
  useEffect(() => {
    setYears((history.data?.items ?? []).slice(0, 2).map((c) => String(c.year)));
    setProposal(null);
  }, [history.data]);

  const derive = useMutation({
    mutationFn: () => api.post<ItkDeriveResult>(farmPath(farmId, "/technical-itineraries/derive"), { activityId, campaigns: years.map(Number) }),
    onSuccess: (r) => {
      setProposal(r);
      setName(r.name);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const create = useMutation({
    mutationFn: (body: ItkWrite) => api.post<ItkDetail>(farmPath(farmId, "/technical-itineraries"), body),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: itksKey(farmId) });
      onCreated(t);
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? "Un itinéraire porte déjà ce nom." : e instanceof Error ? e.message : String(e)),
  });

  const campaigns = history.data?.items ?? [];
  return (
    <Modal opened onClose={onClose} title="Créer un itinéraire depuis l'historique" size={proposal ? "90%" : "lg"}>
      <Stack>
        <Text size="sm" c="dimmed">
          Fourmy regroupe les interventions réalisées de l'activité en étapes, datées par rapport au semis ou à la récolte, avec les doses médianes à l'hectare et
          les matériels habituels. Rien n'est enregistré avant « Créer l'itinéraire » ; vous pourrez ensuite tout modifier.
        </Text>
        <Select
          label="Activité"
          data={activityOptions}
          value={activityId}
          onChange={(v) => {
            setActivityId(v);
            setProposal(null);
          }}
          searchable
          data-autofocus
        />
        {activityId && history.isLoading && <Loader size="sm" />}
        {activityId && history.data && campaigns.length === 0 && <Alert color="gray">Aucune intervention réalisée sur les parcelles de cette activité.</Alert>}
        {campaigns.length > 0 && (
          <Checkbox.Group
            label="Campagnes à reprendre"
            value={years}
            onChange={(v) => {
              setYears(v);
              setProposal(null);
            }}
          >
            <Group mt={4} gap="md">
              {campaigns.map((c) => (
                <Checkbox
                  key={c.year}
                  value={String(c.year)}
                  label={`${c.year} (${c.productions} parcelle${c.productions > 1 ? "s" : ""}, ${c.interventions} intervention${c.interventions > 1 ? "s" : ""})`}
                />
              ))}
            </Group>
          </Checkbox.Group>
        )}
        {!proposal && (
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Annuler
            </Button>
            <Button onClick={() => derive.mutate()} loading={derive.isPending} disabled={!activityId || years.length === 0}>
              Proposer
            </Button>
          </Group>
        )}

        {proposal && (
          <>
            <Group gap="xs">
              <Badge variant="light">{proposal.stats.productions} parcelle{proposal.stats.productions > 1 ? "s" : ""} retenue{proposal.stats.productions > 1 ? "s" : ""}</Badge>
              <Badge variant="light">{proposal.stats.interventions} interventions</Badge>
              {proposal.stats.excluded > 0 && (
                <Badge variant="light" color="gray">
                  {proposal.stats.excluded} écartée{proposal.stats.excluded > 1 ? "s" : ""} (ni semis ni récolte)
                </Badge>
              )}
              {proposal.stats.toComplete > 0 && (
                <Badge variant="light" color="orange">
                  {proposal.stats.toComplete} étape{proposal.stats.toComplete > 1 ? "s" : ""} sans matériel : à compléter
                </Badge>
              )}
              {proposal.stats.unconvertedInputs > 0 && (
                <Badge variant="light" color="orange">
                  {proposal.stats.unconvertedInputs} dose{proposal.stats.unconvertedInputs > 1 ? "s" : ""} non reprise{proposal.stats.unconvertedInputs > 1 ? "s" : ""} (unité)
                </Badge>
              )}
            </Group>
            {proposal.content.steps.length === 0 ? (
              <Alert color="gray">Aucune étape : pas d'intervention datable sur ces campagnes.</Alert>
            ) : (
              <ScrollArea.Autosize mah={420}>
                <Table verticalSpacing={4} aria-label="Étapes proposées">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Étape</Table.Th>
                      <Table.Th>Quand</Table.Th>
                      <Table.Th>Part</Table.Th>
                      <Table.Th>Intrants</Table.Th>
                      <Table.Th>D'après</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {proposal.content.steps.map((s) => (
                      <Table.Tr key={s.id}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm">{getProcedure(s.procedure).label}</Text>
                            {s.optional && (
                              <Badge size="xs" variant="light" color="gray">
                                si besoin
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {anchorLabel(s.anchor)}
                            {s.windowDays ? ` ±${s.windowDays} j` : ""}
                            {s.repeat ? ` · ${s.repeat.count} passages tous les ${s.repeat.everyDays} j` : ""}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{Math.round(s.share * 100)} %</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c={s.inputs.length ? undefined : "dimmed"}>
                            {s.inputs.map((i) => `${i.label} ${fmt(i.dose)} ${unitLabel(i.unit)}`).join(" · ") || "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {s.evidence ? `${s.evidence.parcels}/${s.evidence.ofParcels} parcelles` : ""}
                            {s.evidence?.observedRateHaH ? ` · ${fmt(s.evidence.observedRateHaH)} ha/h observé` : ""}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            <TextInput label="Nom de l'itinéraire" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} required />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setProposal(null)}>
                Changer les campagnes
              </Button>
              <Button
                onClick={() =>
                  create.mutate({
                    id: crypto.randomUUID(),
                    name: name.trim(),
                    activityId: proposal.activityId,
                    production: proposal.production,
                    system: proposal.system,
                    origin: "history",
                    source: proposal.source,
                    content: proposal.content,
                  })
                }
                loading={create.isPending}
                disabled={!name.trim() || proposal.content.steps.length === 0}
              >
                Créer l'itinéraire
              </Button>
            </Group>
          </>
        )}
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Modal>
  );
}
