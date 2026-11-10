import { useState } from "react";
import { Button, Group, NumberInput, Paper, SimpleGrid, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrackSettings } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";

/**
 * Réglages du découpage des traces GPS en parcours (FR-GPS-16), pour le
 * responsable. Enregistrer ne recalcule que les parcours libres (au prochain
 * passage du worker, ou tout de suite avec « Recalculer ») ; les parcours
 * rattachés à une intervention gardent leur étendue.
 */
const FIELDS: { key: keyof TrackSettings; label: string; suffix?: string; min: number; max?: number; step?: number; percent?: boolean }[] = [
  { key: "stopMin", label: "Un arrêt de plus de… coupe le parcours", suffix: " min", min: 2, max: 180 },
  { key: "minDurationMin", label: "Durée minimale d'un parcours", suffix: " min", min: 0, max: 120 },
  { key: "minDistanceM", label: "Distance minimale d'un parcours", suffix: " m", min: 0, max: 10_000 },
  { key: "movingKmh", label: "En mouvement au-dessus de (boîtier sans signal « au travail »)", suffix: " km/h", min: 0.5, max: 15, step: 0.5 },
  { key: "parcelMinShare", label: "Parcelle comptée si couverte à au moins", suffix: " %", min: 0, max: 100, percent: true },
  { key: "parcelMinAreaM2", label: "ou si au moins … couverts", suffix: " m²", min: 0 },
];

export function TrackSettingsPanel({ farmId }: { farmId: string }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["track-settings", farmId], queryFn: () => api.get<TrackSettings>(farmPath(farmId, "/settings/tracks")) });
  const [draft, setDraft] = useState<Partial<Record<keyof TrackSettings, number | string>>>({});
  const value = (f: (typeof FIELDS)[number]) => draft[f.key] ?? (f.percent ? Math.round((q.data?.[f.key] ?? 0) * 100) : q.data?.[f.key]);
  const done = (message: string) => {
    notifications.show({ color: "lichen", message });
    void queryClient.invalidateQueries({ queryKey: ["track-settings"] });
    void queryClient.invalidateQueries({ queryKey: ["track-sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["track-sessions-any"] });
  };
  const fail = (e: unknown) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) });
  const save = useMutation({
    mutationFn: () =>
      api.put<TrackSettings>(
        farmPath(farmId, "/settings/tracks"),
        Object.fromEntries(FIELDS.map((f) => [f.key, f.percent ? Number(value(f)) / 100 : Number(value(f))])),
      ),
    onSuccess: () => {
      setDraft({});
      done("Réglages des parcours enregistrés : les parcours libres seront recalculés.");
    },
    onError: fail,
  });
  const recompute = useMutation({
    mutationFn: () => api.post<{ inserted: number }>(farmPath(farmId, "/track-sessions/recompute"), {}),
    onSuccess: (r) => done(`Parcours recalculés (${r.inserted} parcours).`),
    onError: fail,
  });
  if (!q.data) return null;
  return (
    <Paper withBorder p="md" aria-label="Réglages des parcours GPS">
      <Title order={4} mb={4}>
        Parcours GPS
      </Title>
      <Text size="xs" c="dimmed" mb="sm">
        Découpage des traces en parcours (travail, déplacements). Un changement recalcule les parcours libres ; ceux rattachés à une intervention ne bougent pas.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {FIELDS.map((f) => (
          <NumberInput
            key={f.key}
            label={f.label}
            value={value(f)}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
            min={f.percent ? 0 : f.min}
            max={f.percent ? 100 : f.max}
            step={f.step ?? 1}
            decimalSeparator=","
            suffix={f.suffix}
          />
        ))}
      </SimpleGrid>
      <Group mt="sm">
        <Button variant="default" onClick={() => save.mutate()} loading={save.isPending} disabled={Object.keys(draft).length === 0}>
          Enregistrer
        </Button>
        <Button variant="subtle" onClick={() => recompute.mutate()} loading={recompute.isPending}>
          Recalculer maintenant
        </Button>
      </Group>
    </Paper>
  );
}
