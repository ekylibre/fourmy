import { useState } from "react";
import { Badge, Button, Checkbox, Group, Modal, Stack, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SeedAttachProposal } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { ErrorAlert } from "../../components/states";
import { seedsKey } from "./queries";

/** « Blé tendre · Thermidor · 512E492 », ou « Mélange ». */
export function proposalLabel(p: SeedAttachProposal): string {
  if (p.isMixture) return "Mélange";
  return [p.speciesLabel ?? p.species, p.varietyName, p.gnisCode].filter(Boolean).join(" · ");
}

export function ProposalBadge({ p }: { p: SeedAttachProposal }) {
  if (p.sure) return <Badge variant="light" color="lichen" size="sm" style={{ flexShrink: 0 }}>Sûr</Badge>;
  if (p.approximate) return <Badge variant="light" color="brique" size="sm" style={{ flexShrink: 0 }}>À vérifier de près</Badge>;
  return <Badge variant="light" color="paille" size="sm" style={{ flexShrink: 0 }}>À vérifier</Badge>;
}

/**
 * Rattacher des semences au référentiel (lot SE4, FR-SE-12) : les
 * propositions, cochées d'office quand elles sont sûres (code GNIS au
 * catalogue) ou tirées telles quelles de l'espèce du fichier importé. Le
 * responsable décoche ce qui ne va pas, puis rattache.
 */
export function AttachModal({ proposals, onClose }: { proposals: SeedAttachProposal[]; onClose: () => void }) {
  const farm = useFarm();
  const client = useQueryClient();
  const [chosen, setChosen] = useState<string[]>(proposals.filter((p) => p.sure || !p.approximate).map((p) => p.articleId));
  const attach = useMutation({
    mutationFn: (articleIds: string[]) => api.post<{ items: SeedAttachProposal[] }>(farmPath(farm.id, "/seeds/attach"), { articleIds }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: seedsKey(farm.id) });
      notifications.show({ color: "lichen", message: `${r.items.length} semence${r.items.length > 1 ? "s" : ""} rattachée${r.items.length > 1 ? "s" : ""}.` });
      onClose();
    },
  });
  const all = chosen.length === proposals.length;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <Modal opened onClose={onClose} title="Rattacher au référentiel" size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          Fourmy propose l'espèce et la variété de chaque semence d'après son code GNIS, l'espèce lue dans le fichier importé ou son nom. Le PMG n'est pas
          touché.
        </Text>
        <Table fz="sm" aria-label="Rattachements proposés">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40}>
                <Checkbox aria-label="Tout choisir" checked={all} indeterminate={!all && chosen.length > 0} onChange={() => setChosen(all ? [] : proposals.map((p) => p.articleId))} />
              </Table.Th>
              <Table.Th>Semence</Table.Th>
              <Table.Th>Proposition</Table.Th>
              <Table.Th>D'après</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {proposals.map((p) => (
              <Table.Tr key={p.articleId}>
                <Table.Td>
                  <Checkbox aria-label={`Rattacher ${p.name}`} checked={chosen.includes(p.articleId)} onChange={() => toggle(p.articleId)} />
                </Table.Td>
                <Table.Td>{p.name}</Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{proposalLabel(p)}</Text>
                    <ProposalBadge p={p} />
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {p.reason}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {attach.error && <ErrorAlert error={attach.error} />}
        <Group>
          <Button onClick={() => attach.mutate(chosen)} disabled={!chosen.length} loading={attach.isPending}>
            Rattacher {chosen.length} semence{chosen.length > 1 ? "s" : ""}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
