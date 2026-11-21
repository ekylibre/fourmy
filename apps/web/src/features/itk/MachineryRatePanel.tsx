import { useState } from "react";
import { Alert, Button, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ItkMachineryRateInfo } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { fmtRate, useEquipmentRates, useMachineryRates } from "./work";

const describe = (r: ItkMachineryRateInfo) => `${r.label}${r.haH ? ` · ${fmtRate(r.haH)}` : ""}`;

/**
 * Fiche d'un matériel, « Débit de chantier » (lot IT4, §15.3) : ligne du
 * barème BCMA rattachée, proposition d'après le type et la largeur, choix
 * par recherche. Sert au temps de travaux quand aucun débit n'est saisi ni
 * observé.
 */
export function MachineryRatePanel({ farmId, equipmentId, owner }: { farmId: string; equipmentId: string; owner: boolean }) {
  const queryClient = useQueryClient();
  const list = useEquipmentRates(farmId);
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState(false);
  const rates = useMachineryRates(farmId, null, search, choosing && search.trim().length >= 2);
  const e = list.data?.items.find((x) => x.id === equipmentId);
  const save = useMutation({
    mutationFn: (machineryRateId: string | null) => api.put(farmPath(farmId, `/equipments/${equipmentId}/machinery-rate`), { machineryRateId }),
    onSuccess: async () => {
      setChoosing(false);
      notifications.show({ color: "lichen", message: "Débit de chantier enregistré." });
      await queryClient.invalidateQueries({ queryKey: ["equipments-rates", farmId] });
      await queryClient.invalidateQueries({ queryKey: ["itk-work", farmId] });
    },
  });
  if (!e || e.carrier) return null;
  return (
    <Paper withBorder p="md" aria-label="Débit de chantier">
      <Title order={4} mb="xs">
        Débit de chantier
      </Title>
      <Stack gap="xs">
        {e.rate ? (
          <Text size="sm">
            Barème BCMA : <b>{describe(e.rate)}</b>
            {e.rate.widthM && e.widthM && e.rate.widthM !== e.widthM ? ` (ramené à ${String(e.widthM).replace(".", ",")} m)` : ""}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            Aucune ligne du barème BCMA rattachée{e.widthM ? ` ; largeur de travail ${String(e.widthM).replace(".", ",")} m` : ""}.
          </Text>
        )}
        {!e.rate && e.suggested && (
          <Alert color="gray" p="xs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm">Proposé : {describe(e.suggested)}</Text>
              {owner && (
                <Button size="compact-xs" onClick={() => save.mutate(e.suggested!.id)} loading={save.isPending}>
                  Retenir
                </Button>
              )}
            </Group>
          </Alert>
        )}
        {owner && !choosing && (
          <Group gap="xs">
            <Button size="compact-sm" variant="light" onClick={() => setChoosing(true)}>
              {e.rate ? "Changer" : "Choisir dans le barème"}
            </Button>
            {e.rate && (
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => save.mutate(null)} loading={save.isPending}>
                Retirer
              </Button>
            )}
          </Group>
        )}
        {owner && choosing && (
          <Select
            placeholder="Rechercher : charrue 5 corps, semoir 4 m…"
            data={(rates.data?.items ?? []).map((r) => ({ value: r.id, label: `${r.family} — ${describe(r)}` }))}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            filter={({ options }) => options}
            onChange={(v) => v && save.mutate(v)}
            nothingFoundMessage={search.trim().length >= 2 ? "Aucun matériel du barème" : "Tapez au moins deux lettres"}
            aria-label="Ligne du barème BCMA"
          />
        )}
        <Text size="xs" c="dimmed">
          Utilisé pour les temps de travaux de l'assolement quand l'étape n'a pas de débit saisi ni observé sur vos chantiers. Source : barème BCMA 2024 (CEGARA).
        </Text>
      </Stack>
    </Paper>
  );
}
