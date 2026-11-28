import { useState } from "react";
import { Alert, Button, Checkbox, Group, List, Modal, Stack, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SeedListItem, SeedUnitRewrite, SeedUnitRewriteResult } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { formatNumber } from "../../app/labels";
import { invalidateAfterIntervention } from "../../app/queries";
import { ErrorAlert } from "../../components/states";
import { stockUnitLabel } from "./labels";
import { seedsKey } from "./queries";

/** Libellé d'une unité de stock, avant ou après : « doses de 50 000 grains », « milliers de grains », « plants ». */
const unitText = (unit: string, grainsPerDose: number | null) => stockUnitLabel({ unit, unitDim: null, sheet: { grainsPerDose } as SeedListItem["sheet"] });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

function usageText(u: SeedUnitRewrite["usage"]): string {
  const parts = [u.movements && plural(u.movements, "mouvement"), u.interventions && plural(u.interventions, "intervention"), u.prices && plural(u.prices, "prix", "prix")];
  return parts.filter(Boolean).join(", ") || "aucun mouvement";
}

const SKIP_REASONS: Record<SeedUnitRewriteResult["skipped"][number]["reason"], string> = {
  not_found: "semence introuvable",
  changed: "unité changée entre-temps",
  conflict: "nombre de grains par dose en conflit",
  stock_mismatch: "stock différent après réécriture, rien n'a été changé",
};

/**
 * Réécrire les unités reprises (issue #130, lot SU4, FR-SU-1 à 6) : chaque
 * semence, son unité actuelle et l'unité proposée, de même grandeur ; le stock
 * ne change pas. Le responsable décoche ce qu'il veut garder, puis réécrit.
 * Les conflits (nombre de grains par dose de la fiche différent) sont à part.
 */
export function UnitRewriteModal({ items, onClose }: { items: SeedUnitRewrite[]; onClose: () => void }) {
  const farm = useFarm();
  const client = useQueryClient();
  const ready = items.filter((i) => i.to && !i.conflict);
  const conflicts = items.filter((i) => i.conflict);
  const [chosen, setChosen] = useState<string[]>(ready.map((i) => i.articleId));
  const rewrite = useMutation({
    mutationFn: () =>
      api.post<SeedUnitRewriteResult>(farmPath(farm.id, "/seeds/units"), {
        items: ready.filter((i) => chosen.includes(i.articleId)).map((i) => ({ articleId: i.articleId, to: i.to })),
      }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: seedsKey(farm.id) });
      invalidateAfterIntervention(client);
      const names = new Map(items.map((i) => [i.articleId, i.name]));
      notifications.show({
        color: r.skipped.length ? "paille" : "lichen",
        message:
          `${plural(r.rewritten.length, "semence réécrite", "semences réécrites")}.` +
          (r.skipped.length ? ` Ignorées : ${r.skipped.map((s) => `${names.get(s.articleId) ?? "?"} (${SKIP_REASONS[s.reason]})`).join(", ")}.` : ""),
        autoClose: r.skipped.length ? 10_000 : 4_000,
      });
      onClose();
    },
  });
  const all = chosen.length === ready.length;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <Modal opened onClose={onClose} title="Unités reprises d'un autre logiciel" size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          Ces semences gardent l'unité écrite dans le logiciel d'origine. Fourmy propose l'unité de même grandeur : un sac reste un sac, un millier reste un
          millier. Aucune quantité ne change : stocks passés, semis, registre et prix restent identiques.
        </Text>
        {ready.length > 0 && (
          <Table fz="sm" aria-label="Unités à réécrire">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>
                  <Checkbox aria-label="Tout choisir" checked={all} indeterminate={!all && chosen.length > 0} onChange={() => setChosen(all ? [] : ready.map((i) => i.articleId))} />
                </Table.Th>
                <Table.Th>Semence</Table.Th>
                <Table.Th>Unité actuelle</Table.Th>
                <Table.Th>Devient</Table.Th>
                <Table.Th ta="right">Stock du jour</Table.Th>
                <Table.Th>Concerne</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ready.map((i) => (
                <Table.Tr key={i.articleId}>
                  <Table.Td>
                    <Checkbox aria-label={`Réécrire ${i.name}`} checked={chosen.includes(i.articleId)} onChange={() => toggle(i.articleId)} />
                  </Table.Td>
                  <Table.Td>{i.name}</Table.Td>
                  <Table.Td>« {i.from} »</Table.Td>
                  <Table.Td>{unitText(i.to!, i.grainsPerDose)}</Table.Td>
                  <Table.Td ta="right" className="lv-num">
                    {formatNumber(i.stock, 3)}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {usageText(i.usage)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {conflicts.length > 0 && (
          <Alert color="paille" title="À régler sur la fiche avant de réécrire">
            <List size="sm" spacing={2}>
              {conflicts.map((i) => (
                <List.Item key={i.articleId}>
                  {i.name} : l'unité dit {formatNumber(i.conflict!.unitGrains, 0)} grains par dose, la fiche {formatNumber(i.conflict!.sheetGrains, 0)}. Corrigez
                  le nombre de grains par dose sur la fiche, ou l'unité.
                </List.Item>
              ))}
            </List>
          </Alert>
        )}
        {rewrite.error && <ErrorAlert error={rewrite.error} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!chosen.length} loading={rewrite.isPending} onClick={() => rewrite.mutate()}>
            Réécrire {plural(chosen.length, "semence")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
