import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, ColorInput, FileButton, Grid, Group, Loader, NumberInput, Paper, Select, Stack, Switch, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Upload } from "lucide-react";
import { AVATAR_TEMPLATE_LABELS, buildAvatarGlb, resolveAvatar, type AvatarInput, type Provenance } from "@fourmy/equipment-3d";
import type { AvatarInfo, AvatarWrite, EquipmentSheet } from "@fourmy/contracts";
import { api, ApiError, farmPath } from "../../app/api";
import { useFarm } from "../../app/farm";
import { MapBoundary } from "../../components/MapBoundary";
import { ErrorAlert, Loading } from "../../components/states";
import { assetUrl } from "./EquipmentLogo";

const AvatarPreview = lazy(() => import("../../3d/AvatarPreview"));

const PROVENANCE: Record<Provenance, { label: string; color: string }> = {
  input: { label: "Saisi", color: "lichen" },
  technical: { label: "Fiche technique", color: "ardoise" },
  default: { label: "Par défaut", color: "gray" },
};

const DIMENSIONS: { key: keyof AvatarWrite; label: string; templates?: string[] }[] = [
  { key: "lengthM", label: "Longueur" },
  { key: "widthM", label: "Largeur" },
  { key: "heightM", label: "Hauteur" },
  { key: "wheelbaseM", label: "Empattement", templates: ["tractor", "self_propelled"] },
  { key: "frontWheelDiameterM", label: "Roues avant (diamètre)", templates: ["tractor", "self_propelled"] },
  { key: "rearWheelDiameterM", label: "Roues arrière (diamètre)", templates: ["tractor", "self_propelled", "trailed_tool", "trailed_sprayer", "trailer"] },
  { key: "workingWidthM", label: "Largeur de travail", templates: ["trailed_tool", "trailed_sprayer", "mounted_tool"] },
  { key: "hitchOffsetM", label: "Attelage (distance)", templates: ["tractor", "trailed_tool", "trailed_sprayer", "trailer"] },
];
const COLORS: { key: "body" | "cab" | "wheels" | "accent"; label: string }[] = [
  { key: "body", label: "Carrosserie" },
  { key: "cab", label: "Cabine (vitrage)" },
  { key: "wheels", label: "Pneus" },
  { key: "accent", label: "Châssis, jantes" },
];

/** Octets d'un fichier de la ferme (logo PNG, modèle importé). */
async function bytesOf(url: string): Promise<Uint8Array | null> {
  const res = await fetch(`${globalThis.location?.origin ?? ""}${url}`, { credentials: "same-origin" });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

/**
 * Onglet 3D de la fiche matériel (FR-MAT-81 à 83) : paramètres de l'avatar
 * avec leur provenance (saisie, fiche technique, défaut), aperçu recalculé à
 * chaque réglage, import d'un modèle GLB à la place de l'avatar généré.
 */
export function AvatarTab({ sheet: s }: { sheet: EquipmentSheet }) {
  const farm = useFarm();
  const owner = farm.role === "owner";
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["avatar", farm.id, s.id], queryFn: () => api.get<AvatarInfo>(farmPath(farm.id, `/equipments/${s.id}/avatar`)) });
  const [draft, setDraft] = useState<AvatarWrite | null>(null);
  const [glb, setGlb] = useState<Uint8Array | null>(null);
  const saved = useMemo<AvatarWrite>(() => draft ?? info.data?.saved ?? {}, [draft, info.data?.saved]);
  const logo = useQuery({
    queryKey: ["avatar-logo", farm.id, info.data?.logoAssetId],
    queryFn: () => bytesOf(assetUrl(farm.id, info.data!.logoAssetId!)),
    enabled: !!info.data?.logoAssetId,
    staleTime: Infinity,
  });
  const resolved = useMemo(() => {
    const clean: AvatarInput = Object.fromEntries(Object.entries(saved).filter(([k, v]) => v !== null && v !== undefined && k !== "colors")) as AvatarInput;
    if (saved.colors) clean.colors = Object.fromEntries(Object.entries(saved.colors).filter(([, v]) => v)) as AvatarInput["colors"];
    return resolveAvatar({ kind: s.kind, name: s.name, technical: s.technical, brandColor: s.brandInfo?.color ?? null, saved: clean });
  }, [saved, s.kind, s.technical, s.brandInfo?.color]);

  // Aperçu : modèle importé, sinon avatar recalculé dans le navigateur.
  useEffect(() => {
    let off = false;
    if (!info.data) return;
    if (info.data.imported) {
      void bytesOf(`/api/v1${farmPath(farm.id, `/equipments/${s.id}/avatar.glb`)}`).then((b) => !off && setGlb(b));
    } else {
      void buildAvatarGlb(resolved.params, logo.data ?? null).then((a) => !off && setGlb(a.glb));
    }
    return () => {
      off = true;
    };
  }, [info.data, resolved, logo.data, farm.id, s.id]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["avatar", farm.id, s.id] });
  };
  const save = useMutation({
    mutationFn: (body: AvatarWrite) => api.put<AvatarInfo>(farmPath(farm.id, `/equipments/${s.id}/avatar`), body),
    onSuccess: () => {
      notifications.show({ color: "lichen", message: "Avatar enregistré." });
      setDraft(null);
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof ApiError ? e.message : String(e) }),
  });
  const model = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file) return api.delete(farmPath(farm.id, `/equipments/${s.id}/model`));
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`${globalThis.location?.origin ?? ""}/api/v1${farmPath(farm.id, `/equipments/${s.id}/model`)}`, { method: "PUT", body: form, credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Erreur ${res.status}`);
      return res.json();
    },
    onSuccess: (_r, file) => {
      notifications.show({ color: "lichen", message: file ? "Modèle importé." : "Avatar généré rétabli." });
      refresh();
    },
    onError: (e) => notifications.show({ color: "brique", message: e instanceof Error ? e.message : String(e) }),
  });

  if (info.isLoading) return <Loading />;
  if (info.error) return <ErrorAlert error={info.error} />;
  const p = resolved.params as unknown as Record<string, number>;
  const set = (patch: AvatarWrite) => setDraft({ ...saved, ...patch });
  const prov = (k: string) => {
    const v = PROVENANCE[resolved.provenance[k] ?? "default"];
    return (
      <Badge size="xs" variant="light" color={v.color}>
        {v.label}
      </Badge>
    );
  };
  const imported = info.data!.imported;

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Paper withBorder p="xs">
          <MapBoundary what="l'aperçu 3D">
            <Suspense fallback={<Loader size="sm" />}>{glb ? <AvatarPreview glb={glb} height={380} sizeM={Math.max(p.lengthM ?? 5, p.widthM ?? 2.5, p.workingWidthM ?? 0)}
                  centerM={["tractor", "self_propelled"].includes(resolved.params.template) ? (p.wheelbaseM ?? 0) / 2 : -(p.lengthM ?? 0) / 2}
                /> : <Loader size="sm" />}</Suspense>
          </MapBoundary>
        </Paper>
        <Text size="xs" c="dimmed" mt={4}>
          {imported
            ? "Modèle 3D importé."
            : "Avatar généré à l'échelle : silhouette et proportions du matériel, pas le dessin du constructeur. Il représente le matériel dans le plan 3D (rejeu des traces Traccar)."}
        </Text>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Stack>
          {imported && (
            <Alert color="ardoise" icon={<Box size={16} />}>
              Un modèle importé remplace l'avatar généré.
              {owner && (
                <Button size="compact-xs" variant="subtle" ml="xs" onClick={() => model.mutate(null)} loading={model.isPending}>
                  Rétablir l'avatar généré
                </Button>
              )}
            </Alert>
          )}
          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              Avatar
            </Title>
            <Stack gap="xs">
              <Group justify="space-between" align="flex-end">
                <Select
                  label="Gabarit"
                  data={Object.entries(AVATAR_TEMPLATE_LABELS).map(([value, label]) => ({ value, label }))}
                  value={resolved.params.template}
                  onChange={(v) => set({ template: (v as AvatarWrite["template"]) ?? null })}
                  disabled={!owner || imported}
                  allowDeselect={false}
                  style={{ flex: 1 }}
                />
                {prov("template")}
              </Group>
              {DIMENSIONS.filter((d) => !d.templates || d.templates.includes(resolved.params.template)).map((d) => (
                <Group key={d.key} justify="space-between" align="flex-end" wrap="nowrap">
                  <NumberInput
                    label={d.label}
                    suffix=" m"
                    decimalScale={2}
                    min={0.05}
                    max={60}
                    value={(saved[d.key] as number | null | undefined) ?? ""}
                    placeholder={p[d.key]?.toLocaleString("fr-FR")}
                    onChange={(v) => set({ [d.key]: v === "" ? null : Number(v) })}
                    disabled={!owner || imported}
                    style={{ flex: 1 }}
                  />
                  {prov(d.key)}
                </Group>
              ))}
              <Group grow>
                {COLORS.map((c) => (
                  <ColorInput
                    key={c.key}
                    size="xs"
                    label={c.label}
                    format="hex"
                    value={saved.colors?.[c.key] ?? resolved.params.colors[c.key]}
                    onChange={(v) => set({ colors: { ...(saved.colors ?? {}), [c.key]: v || null } })}
                    disabled={!owner || imported}
                  />
                ))}
              </Group>
              <Switch
                label="Logo sur les flancs"
                description={info.data!.logoAssetId ? "Logo du matériel ou de sa marque." : "Aucun logo PNG (ou SVG) : ajoutez-en un dans l'onglet Général."}
                checked={resolved.params.logo === "sides"}
                onChange={(e) => set({ logo: e.currentTarget.checked ? "sides" : "none" })}
                disabled={!owner || imported}
              />
              {owner && !imported && (
                <Group justify="space-between">
                  <Button variant="subtle" color="gray" onClick={() => save.mutate({})} disabled={!info.data!.saved}>
                    Tout déduire
                  </Button>
                  <Button onClick={() => save.mutate(saved)} loading={save.isPending} disabled={!draft}>
                    Enregistrer
                  </Button>
                </Group>
              )}
            </Stack>
          </Paper>
          {owner && (
            <Paper withBorder p="md">
              <Title order={4} mb={4}>
                Modèle 3D fourni
              </Title>
              <Text size="xs" c="dimmed" mb="xs">
                Un fichier GLB (glTF binaire), 5 Mo et 100 000 triangles au plus, à l'échelle en mètres, l'avant vers +Z.
              </Text>
              <FileButton accept=".glb,model/gltf-binary" onChange={(f) => f && model.mutate(f)}>
                {(props) => (
                  <Button {...props} size="xs" variant="light" leftSection={<Upload size={14} />} loading={model.isPending}>
                    Importer un GLB
                  </Button>
                )}
              </FileButton>
            </Paper>
          )}
        </Stack>
      </Grid.Col>
    </Grid>
  );
}
