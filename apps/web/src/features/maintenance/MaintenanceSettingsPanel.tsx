import { useState } from "react";
import { Button, Group, MultiSelect, NumberInput, Paper, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MaintenanceSettings } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useMembers } from "../../app/queries";

/** Seuils « bientôt » et destinataires des alertes d'entretien (onglet Entretien de « Ma ferme »). */
export function MaintenanceSettingsPanel({ farmId }: { farmId: string }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["maintenance-settings", farmId], queryFn: () => api.get<MaintenanceSettings>(farmPath(farmId, "/settings/maintenance")) });
  const members = useMembers(farmId);
  const [hours, setHours] = useState<number | string | null>(null);
  const [months, setMonths] = useState<number | string | null>(null);
  const [notify, setNotify] = useState<string[] | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.put(farmPath(farmId, "/settings/maintenance"), {
        soonHours: Number(hours ?? q.data?.soonHours),
        soonMonths: Number(months ?? q.data?.soonMonths),
        notify: notify ?? q.data?.notify ?? [],
      }),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Seuils enregistrés." });
      void queryClient.invalidateQueries({ queryKey: ["maintenance-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["maintenance-due"] });
      void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  if (!q.data) return null;
  return (
    <Paper withBorder p="md">
      <Title order={4} mb="xs">
        Réglages
      </Title>
      <Group align="flex-end">
        <NumberInput label="« Bientôt » : heures avant l'échéance" value={hours ?? q.data.soonHours} onChange={setHours} min={0} suffix=" h" w={240} />
        <NumberInput label="ou mois avant" value={months ?? q.data.soonMonths} onChange={setMonths} min={0} max={12} w={140} />
      </Group>
      <MultiSelect
        mt="sm"
        label="Prévenir par e-mail"
        description="Un récapitulatif quand une opération passe à « bientôt » ou « en retard » (une fois par échéance)."
        data={(members.data?.items ?? []).map((m) => ({ value: m.userId, label: m.name ? `${m.name} (${m.email})` : m.email }))}
        value={notify ?? q.data.notify ?? []}
        onChange={setNotify}
        maw={520}
      />
      <Button mt="sm" variant="default" onClick={() => save.mutate()} loading={save.isPending} disabled={hours === null && months === null && notify === null}>
        Enregistrer
      </Button>
    </Paper>
  );
}
