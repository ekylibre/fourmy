import { useEffect, useState, type ReactNode } from "react";
import { Button, Group, NumberInput, Paper, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudRain, Droplets, Thermometer, Wind } from "lucide-react";
import { DEFAULT_SPRAYING_THRESHOLDS, REGULATORY_WIND_KMH, type Light, type SprayingThresholds } from "@fourmy/domain";
import type { FarmSprayingSettings } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { TrafficLight } from "../../components/TrafficLight";

/**
 * Seuils des conditions de pulvérisation de la ferme (Préférences) : une seule
 * règle pour toute l'application (frise horaire du tableau de bord, de la
 * fiche parcelle, de la saisie et de la fiche d'une intervention). Valeurs
 * par défaut : celles d'Ekylibre.
 */

export function useSprayingSettings(farmId: string, enabled = true) {
  return useQuery({
    queryKey: ["settings-spraying", farmId],
    queryFn: () => api.get<FarmSprayingSettings>(farmPath(farmId, "/settings/spraying")),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** Une ligne de réglage : intitulé, champs numériques, explication. */
function Row({ icon: Icon, label, children, help }: { icon: typeof Wind; label: string; children: ReactNode; help: string }) {
  return (
    <Group align="flex-start" gap="md" wrap="nowrap">
      <Group gap={6} w={140} wrap="nowrap" pt={26}>
        <Icon size={16} aria-hidden color="var(--mantine-color-dimmed)" />
        <Text size="sm" fw={500}>
          {label}
        </Text>
      </Group>
      <Stack gap={4} style={{ flex: 1 }}>
        <Group gap="sm" wrap="wrap">
          {children}
        </Group>
        <Text size="xs" c="dimmed">
          {help}
        </Text>
      </Stack>
    </Group>
  );
}

/** Champ de seuil, avec la pastille de la zone qu'il borne. */
function Field({ label, level, value, onChange, max, min, step = 1, suffix, disabled }: { label: string; level: Light; value: number; onChange: (v: number) => void; max?: number; min?: number; step?: number; suffix: string; disabled: boolean }) {
  return (
    <NumberInput
      label={label}
      size="xs"
      w={150}
      value={value}
      min={min}
      max={max}
      step={step}
      decimalScale={1}
      decimalSeparator=","
      suffix={` ${suffix}`}
      disabled={disabled}
      onChange={(v) => typeof v === "number" && onChange(v)}
      leftSection={<TrafficLight level={level} variant="icon" size="xs" />}
    />
  );
}

/** Préférences de la ferme : seuils de pulvérisation, avec retour aux valeurs d'Ekylibre. */
export function SprayingSettingsPanel({ farmId, canEdit }: { farmId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const settings = useSprayingSettings(farmId);
  const [form, setForm] = useState<SprayingThresholds>(DEFAULT_SPRAYING_THRESHOLDS);
  useEffect(() => {
    if (settings.data) setForm(settings.data.thresholds);
  }, [settings.data]);
  const done = (message: string) => (data: FarmSprayingSettings) => {
    queryClient.setQueryData(["settings-spraying", farmId], data);
    // La frise horaire se recalcule avec les nouveaux seuils.
    void queryClient.invalidateQueries({ queryKey: ["weather-spraying", farmId] });
    notifications.show({ color: "lichen", message });
  };
  const onError = (e: unknown) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) });
  const save = useMutation({ mutationFn: () => api.put<FarmSprayingSettings>(farmPath(farmId, "/settings/spraying"), form), onSuccess: done("Seuils de pulvérisation enregistrés."), onError });
  const reset = useMutation({
    mutationFn: async () => (await api.delete<FarmSprayingSettings>(farmPath(farmId, "/settings/spraying")))!,
    onSuccess: done("Valeurs d'Ekylibre rétablies."),
    onError,
  });
  const changed = JSON.stringify(form) !== JSON.stringify(settings.data?.thresholds);
  const set = <K extends keyof SprayingThresholds>(k: K, part: Partial<SprayingThresholds[K]>) => setForm((f) => ({ ...f, [k]: { ...f[k], ...part } }));
  const off = !canEdit;
  return (
    <Paper withBorder p="md" aria-label="Seuils de pulvérisation">
      <Title order={4} mb={4}>
        Conditions de pulvérisation
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Heure par heure : favorable dans la plage verte, défavorable au-delà des seuils rouges, à surveiller entre les deux. Ces seuils servent partout : tableau de bord, fiche parcelle, saisie et fiche d'une intervention.
      </Text>
      <Stack gap="md">
        <Row icon={Wind} label="Vent" help={`Au-delà de ${REGULATORY_WIND_KMH} km/h (3 Beaufort), traiter est interdit : ce seuil ne se relâche pas.`}>
          <Field label="Favorable jusqu'à" level="ok" value={form.windKmh.green} max={REGULATORY_WIND_KMH} min={0} suffix="km/h" disabled={off} onChange={(v) => set("windKmh", { green: v })} />
          <Field label="Défavorable dès" level="danger" value={form.windKmh.red} max={REGULATORY_WIND_KMH} min={1} suffix="km/h" disabled={off} onChange={(v) => set("windKmh", { red: v })} />
        </Row>
        <Row icon={Droplets} label="Hygrométrie" help="L'air sec évapore les gouttes ; l'air saturé fait ruisseler la bouillie.">
          <Field label="Favorable de" level="ok" value={form.humidityPct.greenMin} min={0} max={100} suffix="%" disabled={off} onChange={(v) => set("humidityPct", { greenMin: v })} />
          <Field label="à" level="ok" value={form.humidityPct.greenMax} min={0} max={100} suffix="%" disabled={off} onChange={(v) => set("humidityPct", { greenMax: v })} />
          <Field label="Défavorable sous" level="danger" value={form.humidityPct.redMin} min={0} max={100} suffix="%" disabled={off} onChange={(v) => set("humidityPct", { redMin: v })} />
          <Field label="ou dès" level="danger" value={form.humidityPct.redMax} min={0} max={100} suffix="%" disabled={off} onChange={(v) => set("humidityPct", { redMax: v })} />
        </Row>
        <Row icon={Thermometer} label="Température" help="La chaleur favorise l'évaporation et la volatilisation ; le froid réduit l'efficacité.">
          <Field label="Favorable de" level="ok" value={form.temperatureC.greenMin} suffix="°C" disabled={off} onChange={(v) => set("temperatureC", { greenMin: v })} />
          <Field label="à" level="ok" value={form.temperatureC.greenMax} suffix="°C" disabled={off} onChange={(v) => set("temperatureC", { greenMax: v })} />
          <Field label="Défavorable sous" level="danger" value={form.temperatureC.redMin} suffix="°C" disabled={off} onChange={(v) => set("temperatureC", { redMin: v })} />
          <Field label="ou dès" level="danger" value={form.temperatureC.redMax} suffix="°C" disabled={off} onChange={(v) => set("temperatureC", { redMax: v })} />
        </Row>
        <Row icon={CloudRain} label="Pluie" help="Par heure : la pluie lessive le produit.">
          <Field label="Favorable jusqu'à" level="ok" value={form.rainMmPerHour.green} min={0} step={0.1} suffix="mm/h" disabled={off} onChange={(v) => set("rainMmPerHour", { green: v })} />
          <Field label="Défavorable au-delà de" level="danger" value={form.rainMmPerHour.red} min={0} step={0.1} suffix="mm/h" disabled={off} onChange={(v) => set("rainMmPerHour", { red: v })} />
        </Row>
      </Stack>
      {canEdit && (
        <Group mt="md" gap="xs">
          <Button variant="default" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
          <Button variant="subtle" disabled={settings.data?.isDefault !== false} loading={reset.isPending} onClick={() => reset.mutate()}>
            Revenir aux valeurs d'Ekylibre
          </Button>
        </Group>
      )}
    </Paper>
  );
}
