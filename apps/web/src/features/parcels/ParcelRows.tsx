import { useState } from "react";
import { Button, Group, NumberInput, Paper, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Vegetation3dAt } from "@fourmy/contracts";
import { api, farmPath } from "../../app/api";
import { useAt } from "../../app/at";

const fmt = (v: number) => String(v).replace(".", ",");

/**
 * Rangs de la parcelle pour le plan 3D (lot AA) : orientation et inter-rang
 * déduits (grand axe, culture) ou saisis par le responsable de la ferme.
 */
export function ParcelRows({ farmId, parcelId, owner }: { farmId: string; parcelId: string; owner: boolean }) {
  const { day } = useAt();
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["vegetation3d", farmId, day],
    queryFn: () => api.get<Vegetation3dAt>(farmPath(farmId, `/vegetation3d?at=${day}`)),
    staleTime: 10 * 60_000,
  });
  const rows = q.data?.parcels.find((p) => p.parcelId === parcelId)?.rows;
  const [edit, setEdit] = useState<{ bearing: number; spacing: number } | null>(null);
  const done = (message: string) => {
    setEdit(null);
    void client.invalidateQueries({ queryKey: ["vegetation3d", farmId] });
    notifications.show({ color: "lichen", message });
  };
  const save = useMutation({
    mutationFn: (v: { bearing: number; spacing: number }) => api.put(farmPath(farmId, `/land-parcels/${parcelId}/rows`), { bearingDeg: v.bearing, spacingM: v.spacing }),
    onSuccess: () => done("Rangs enregistrés."),
  });
  const reset = useMutation({
    mutationFn: () => api.delete(farmPath(farmId, `/land-parcels/${parcelId}/rows`)),
    onSuccess: () => done("Rangs : retour à l'orientation automatique."),
  });
  if (!rows) return null;
  return (
    <Paper withBorder p="md" aria-label="Rangs de la parcelle">
      <Title order={4} mb={4}>
        Rangs (plan 3D)
      </Title>
      {edit ? (
        <Group align="flex-end">
          <NumberInput
            label="Orientation (° depuis le nord)"
            min={0}
            max={179.9}
            step={1}
            decimalScale={1}
            value={edit.bearing}
            onChange={(v) => setEdit({ ...edit, bearing: Number(v) })}
            w={190}
          />
          <NumberInput
            label="Inter-rang (m)"
            min={0.1}
            max={10}
            step={0.05}
            decimalScale={2}
            value={edit.spacing}
            onChange={(v) => setEdit({ ...edit, spacing: Number(v) })}
            w={130}
          />
          <Button onClick={() => save.mutate(edit)} loading={save.isPending}>
            Enregistrer
          </Button>
          <Button variant="subtle" onClick={() => setEdit(null)}>
            Annuler
          </Button>
        </Group>
      ) : (
        <Group justify="space-between">
          <Text size="sm">
            Orientation {fmt(rows.bearingDeg)}° · inter-rang {fmt(rows.spacingM)} m{" "}
            <Text span size="xs" c="dimmed">
              ({rows.auto ? "automatique : grand axe de la parcelle, inter-rang de la culture" : "saisi"})
            </Text>
          </Text>
          {owner && (
            <Group gap="xs">
              <Button size="compact-sm" variant="light" onClick={() => setEdit({ bearing: rows.bearingDeg, spacing: rows.spacingM })}>
                Modifier
              </Button>
              {!rows.auto && (
                <Button size="compact-sm" variant="subtle" color="gray" onClick={() => reset.mutate()} loading={reset.isPending}>
                  Revenir à l'automatique
                </Button>
              )}
            </Group>
          )}
        </Group>
      )}
    </Paper>
  );
}
