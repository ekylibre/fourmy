import { Link, useLocation } from "react-router";
import { Anchor, Badge, Group, Paper, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { NDVI_PALETTE, STALE_AFTER_DAYS, type ParcelIndexAt, type ParcelIndicesAt } from "@fourmy/contracts";
import { formatDate } from "../../app/labels";
import { ageLabel, formatNdvi, imageFor, type SatelliteLayer } from "./remote-sensing";

/** Légende du NDVI : la même palette que l'image rendue et la coloration des parcelles. */
export function NdviLegend() {
  return (
    <Stack gap={2} aria-label="Légende du NDVI">
      <div
        style={{
          height: 10,
          borderRadius: 4,
          background: `linear-gradient(to right, ${NDVI_PALETTE.map((p) => `${p.color} ${(p.value / 0.9) * 100}%`).join(", ")})`,
        }}
      />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          0 · sol nu
        </Text>
        <Text size="xs" c="dimmed">
          0,5
        </Text>
        <Text size="xs" c="dimmed">
          0,9 · couvert dense
        </Text>
      </Group>
    </Stack>
  );
}

/**
 * Choix de la couche satellite et date de l'image affichée. Sans intégration
 * Copernicus, renvoie vers les Intégrations plutôt que de proposer des couches vides.
 */
export function SatelliteControl({
  farmId,
  enabled,
  data,
  layer,
  onChange,
}: {
  farmId: string;
  enabled: boolean;
  data: ParcelIndicesAt | undefined;
  layer: SatelliteLayer;
  onChange: (l: SatelliteLayer) => void;
}) {
  const location = useLocation();
  if (!enabled) {
    return (
      <Paper p="md">
        <Title order={4} mb={4}>
          Satellite
        </Title>
        <Text size="sm" c="dimmed">
          Images Sentinel-2 et NDVI des parcelles :{" "}
          <Anchor component={Link} to={`/f/${farmId}/integrations${location.search}`}>
            configurer Copernicus
          </Anchor>
          .
        </Text>
      </Paper>
    );
  }
  const img = imageFor(data, layer);
  const age = img && data ? Math.round((Date.parse(data.at) - Date.parse(img.date)) / 86_400_000) : null;
  return (
    <Paper p="md">
      <Title order={4} mb="xs">
        Satellite
      </Title>
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
      {(layer === "ndvi" || layer === "parcels") && (
        <Stack mt="xs" gap={4}>
          <NdviLegend />
        </Stack>
      )}
      {layer !== "none" && data && (
        <Text size="xs" c="dimmed" mt="xs">
          {data.attribution}
        </Text>
      )}
    </Paper>
  );
}

/** Ligne « NDVI » d'une parcelle sélectionnée. */
export function ParcelNdvi({ item }: { item: ParcelIndexAt | undefined }) {
  if (!item) return null;
  if (item.status === "too_small")
    return (
      <Text size="sm" c="dimmed">
        Trop petite pour Sentinel-2 ({item.parcelPixels} pixels de 10 m).
      </Text>
    );
  if (item.status === "none")
    return (
      <Text size="sm" c="dimmed">
        NDVI : pas encore de mesure exploitable.
      </Text>
    );
  return (
    <Text size="sm">
      NDVI <b className="lv-num">{formatNdvi(item.mean)}</b>{" "}
      <Text span size="xs" c="dimmed">
        (p10–p90 {formatNdvi(item.p10)}–{formatNdvi(item.p90)}, {formatDate(item.date!)}, {ageLabel(item.ageDays)}
        {item.status === "stale" ? ", ancienne" : ""})
      </Text>
    </Text>
  );
}
