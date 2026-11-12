import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Anchor, Badge, Group, Paper, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { INDEX_SCALES, STALE_AFTER_DAYS, VEGETATION_INDICES, type ParcelIndexAt, type ParcelIndicesAt, type VegetationIndex } from "@fourmy/contracts";
import { formatDate } from "../../app/labels";
import { ageLabel, formatIndex, imageFor, type SatelliteLayer } from "./remote-sensing";

/** Légende d'un indice : la même palette que l'image rendue (NDVI), la coloration des parcelles et la courbe. */
export function IndexLegend({ index = "ndvi" }: { index?: VegetationIndex }) {
  const { label, palette, domain, legend } = INDEX_SCALES[index];
  const [lo, hi] = domain;
  return (
    <Stack gap={2} aria-label={`Légende du ${label}`}>
      <div
        style={{
          height: 10,
          borderRadius: 4,
          background: `linear-gradient(to right, ${palette.map((p) => `${p.color} ${((p.value - lo) / (hi - lo)) * 100}%`).join(", ")})`,
        }}
      />
      <Group justify="space-between">
        {legend.map((l) => (
          <Text key={l} size="xs" c="dimmed">
            {l}
          </Text>
        ))}
      </Group>
    </Stack>
  );
}

/** Choix de l'indice (NDVI, NDRE, NDMI), avec l'aide d'une ligne de l'indice choisi. */
export function IndexPicker({ value, onChange }: { value: VegetationIndex; onChange: (i: VegetationIndex) => void }) {
  return (
    <Stack gap={4}>
      <SegmentedControl
        size="xs"
        aria-label="Indice"
        value={value}
        onChange={(v) => onChange(v as VegetationIndex)}
        data={VEGETATION_INDICES.map((i) => ({ value: i, label: INDEX_SCALES[i].label }))}
      />
      <Text size="xs" c="dimmed">
        {INDEX_SCALES[value].help}
      </Text>
    </Stack>
  );
}

/**
 * Choix de la couche satellite et date de l'image affichée. Sans intégration
 * Copernicus, renvoie vers les Intégrations plutôt que de proposer des couches vides.
 */
/** Encadré « Satellite », ou rien dans un panneau qui a déjà son cadre. */
function Frame({ bare, children }: { bare: boolean; children: ReactNode }) {
  if (bare) return <>{children}</>;
  return (
    <Paper p="md">
      <Title order={4} mb="xs">
        Satellite
      </Title>
      {children}
    </Paper>
  );
}

export function SatelliteControl({
  farmId,
  enabled,
  data,
  layer,
  onChange,
  index,
  onIndexChange,
  bare = false,
}: {
  farmId: string;
  enabled: boolean;
  data: ParcelIndicesAt | undefined;
  layer: SatelliteLayer;
  onChange: (l: SatelliteLayer) => void;
  /** Indice de la coloration « Par parcelle » (l'image reste celle du NDVI). */
  index: VegetationIndex;
  onIndexChange: (i: VegetationIndex) => void;
  /** Sans cadre ni titre : dans un panneau qui porte déjà les siens (barre d'icônes du plan 3D). */
  bare?: boolean;
}) {
  const location = useLocation();

  if (!enabled) {
    return (
      <Frame bare={bare}>
        <Text size="sm" c="dimmed">
          Images Sentinel-2 et NDVI des parcelles :{" "}
          <Anchor component={Link} to={`/f/${farmId}/integrations${location.search}`}>
            configurer Copernicus
          </Anchor>
          .
        </Text>
      </Frame>
    );
  }
  const img = imageFor(data, layer);
  const age = img && data ? Math.round((Date.parse(data.at) - Date.parse(img.date)) / 86_400_000) : null;
  return (
    <Frame bare={bare}>
      <SegmentedControl
        fullWidth
        size="xs"
        value={layer}
        onChange={(v) => onChange(v as SatelliteLayer)}
        data={[
          { value: "none", label: "Aucun" },
          { value: "ndvi", label: "NDVI" },
          { value: "rgb", label: "Couleurs" },
          { value: "parcels", label: "Par parcelle" },
        ]}
      />
      {(layer === "ndvi" || layer === "rgb") && (
        <Group gap="xs" mt="xs">
          {img ? (
            <Badge variant="light" color={age !== null && age > STALE_AFTER_DAYS ? "orange" : "lichen"}>
              Sentinel-2 du {formatDate(img.date)}
              {age !== null ? ` (${ageLabel(age)})` : ""}
            </Badge>
          ) : (
            <Text size="sm" c="dimmed">
              Aucune image exploitable à cette date.
            </Text>
          )}
        </Group>
      )}
      {layer === "parcels" && (
        <Stack mt="xs" gap={4}>
          <IndexPicker value={index} onChange={onIndexChange} />
        </Stack>
      )}
      {(layer === "ndvi" || layer === "parcels") && (
        <Stack mt="xs" gap={4}>
          <IndexLegend index={layer === "parcels" ? index : "ndvi"} />
        </Stack>
      )}
      {layer !== "none" && data && (
        <Text size="xs" c="dimmed" mt="xs">
          {data.attribution}
        </Text>
      )}
    </Frame>
  );
}

/** Ligne « NDVI » (ou de l'indice choisi) d'une parcelle sélectionnée. */
export function ParcelIndex({ item, index = "ndvi" }: { item: ParcelIndexAt | undefined; index?: VegetationIndex }) {
  if (!item) return null;
  const label = INDEX_SCALES[index].label;
  if (item.status === "too_small")
    return (
      <Text size="sm" c="dimmed">
        Trop petite pour Sentinel-2 ({item.parcelPixels} pixels de 10 m).
      </Text>
    );
  if (item.status === "none")
    return (
      <Text size="sm" c="dimmed">
        {label} : pas encore de mesure exploitable.
      </Text>
    );
  return (
    <Text size="sm">
      {label} <b className="lv-num">{formatIndex(item.mean)}</b>{" "}
      <Text span size="xs" c="dimmed">
        (p10–p90 {formatIndex(item.p10)}–{formatIndex(item.p90)}, {formatDate(item.date!)}, {ageLabel(item.ageDays)}
        {item.status === "stale" ? ", ancienne" : ""})
      </Text>
    </Text>
  );
}
