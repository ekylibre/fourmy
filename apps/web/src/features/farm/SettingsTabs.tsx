import { useEffect, useState } from "react";
import { Button, Group, Paper, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FarmDisplay, FarmProfile } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { useBrands } from "../../app/queries";
import { ErrorAlert, Loading } from "../../components/states";
import { BrandPanel } from "../equipments/EquipmentSheetPage";
import { TrackSettingsPanel } from "../equipments/TrackSettingsPanel";
import { MaintenanceSettingsPanel } from "../maintenance/MaintenanceSettingsPanel";
import { SprayingSettingsPanel } from "../interventions/SprayingSettingsPanel";

/**
 * Réglages regroupés dans « Ma ferme » (E9, E21, E21 bis) : affichage,
 * entretien, parcours, marques. Un seul formulaire par réglage : les anciens
 * écrans renvoient ici (E22).
 */

/** Fond de carte par défaut et unité des surfaces. */
export function DisplaySettings({ profile }: { profile: FarmProfile }) {
  const farm = useFarm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FarmDisplay>(profile.display);
  const changed = form.basemap !== profile.display.basemap || form.areaUnit !== profile.display.areaUnit;
  const save = useMutation({
    mutationFn: () => api.put<FarmDisplay>(farmPath(farm.id, "/settings/display"), form),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Préférences d'affichage enregistrées." });
      void queryClient.invalidateQueries({ queryKey: ["farm-profile", farm.id] });
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  return (
    <Paper withBorder p="md" aria-label="Affichage">
      <Title order={4} mb="xs">
        Cartes et surfaces
      </Title>
      <Group align="flex-end" gap="xl">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Fond de carte par défaut
          </Text>
          <SegmentedControl
            disabled={!profile.canEdit}
            value={form.basemap}
            onChange={(v) => setForm((f) => ({ ...f, basemap: v as FarmDisplay["basemap"] }))}
            data={[
              { value: "ortho", label: "Orthophotos" },
              { value: "plan", label: "Plan IGN" },
            ]}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Unité des surfaces
          </Text>
          <SegmentedControl
            disabled={!profile.canEdit}
            value={form.areaUnit}
            onChange={(v) => setForm((f) => ({ ...f, areaUnit: v as FarmDisplay["areaUnit"] }))}
            data={[
              { value: "ha", label: "Hectares" },
              { value: "a", label: "Ares" },
            ]}
          />
        </Stack>
        {profile.canEdit && (
          <Button variant="default" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        )}
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        Chaque carte s'ouvre sur ce fond ; on peut en changer sur un écran sans modifier ce réglage. Les documents réglementaires (registre phyto, plan de fumure) restent en hectares.
      </Text>
    </Paper>
  );
}

export type PreferenceSection = "maintenance" | "tracks" | "spraying" | "brands";

/**
 * Onglet Préférences (besoins_navigation_compte.md §3.2) : entretien et
 * parcours (responsable seulement), puis marques (lecture pour tous).
 * `section` : ancien onglet demandé par un lien, l'écran y défile.
 */
export function PreferencesTab({ canEdit, section }: { canEdit: boolean; section: PreferenceSection | null }) {
  const farm = useFarm();
  useEffect(() => {
    if (!section) return;
    // Après le rendu des sections (les panneaux chargent leurs données).
    const t = setTimeout(() => document.getElementById(`preferences-${section}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 300);
    return () => clearTimeout(t);
  }, [section]);
  return (
    <Stack gap="xl">
      {canEdit && (
        <section id="preferences-maintenance" aria-labelledby="preferences-maintenance-title">
          <Title order={3} id="preferences-maintenance-title" mb="sm">
            Entretien
          </Title>
          <MaintenanceSettingsPanel farmId={farm.id} />
        </section>
      )}
      {canEdit && (
        <section id="preferences-tracks" aria-labelledby="preferences-tracks-title">
          <Title order={3} id="preferences-tracks-title" mb="sm">
            Parcours
          </Title>
          <TrackSettingsPanel farmId={farm.id} />
        </section>
      )}
      <section id="preferences-spraying" aria-labelledby="preferences-spraying-title">
        <Title order={3} id="preferences-spraying-title" mb="sm">
          Pulvérisation
        </Title>
        <SprayingSettingsPanel farmId={farm.id} canEdit={canEdit} />
      </section>
      <section id="preferences-brands" aria-labelledby="preferences-brands-title">
        <Title order={3} id="preferences-brands-title" mb="sm">
          Marques
        </Title>
        <BrandsTab canEdit={canEdit} />
      </section>
    </Stack>
  );
}

/** Marques des matériels : couleur et logo (servent aussi aux avatars 3D). */
export function BrandsTab({ canEdit }: { canEdit: boolean }) {
  const farm = useFarm();
  const brands = useBrands(farm.id);
  if (brands.isLoading) return <Loading />;
  if (brands.error) return <ErrorAlert error={brands.error} />;
  const items = brands.data?.items ?? [];
  if (!items.length)
    return (
      <Text size="sm" c="dimmed">
        Aucune marque : elles apparaissent avec les matériels.
      </Text>
    );
  return (
    <Stack>
      {items.map((b) => (
        <BrandPanel key={b.id} brand={b} owner={canEdit} />
      ))}
    </Stack>
  );
}
