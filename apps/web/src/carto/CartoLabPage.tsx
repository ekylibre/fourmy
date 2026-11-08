import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Alert, Button, Grid, Group, Paper, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { Map as MlMap, NavigationControl, ScaleControl } from "maplibre-gl";
import type { Feature, Polygon } from "geojson";
import { areaM2 } from "@fourmy/carto";
import { useAt } from "../app/at";
import { useFarm } from "../app/farm";
import { formatDate } from "../app/labels";
import { useSnapshot } from "../app/queries";
import { ErrorAlert, Loading } from "../components/states";
import { WMTS } from "../features/map/ParcelMap"; // règle aussi le worker de MapLibre
import { CartoToolbar } from "./CartoToolbar";
import { formatArea } from "./format";
import { useCartoEditor } from "./useCartoEditor";

function bounds(features: Feature<Polygon>[]): [[number, number], [number, number]] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of features) for (const [x, y] of f.geometry.coordinates[0]!) {
    minX = Math.min(minX, x!); minY = Math.min(minY, y!); maxX = Math.max(maxX, x!); maxY = Math.max(maxY, y!);
  }
  return [[minX, minY], [maxX, maxY]];
}

/**
 * Atelier des outils carto (exigence CARTO-1) : les parcelles à la date de la
 * frise, éditables avec tous les outils communs. Essai à la main : rien n'est
 * enregistré. Les écrans (saisie sur carte des interventions, parcellaire)
 * réutilisent le même éditeur.
 */
export function CartoLabPage() {
  const farm = useFarm();
  const location = useLocation();
  const { at } = useAt();
  const snap = useSnapshot(farm.id, at);
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const m = new MlMap({
      container: container.current,
      center: [2.5, 46.5],
      zoom: 5,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          ortho: { type: "raster", tiles: [WMTS("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg")], tileSize: 256, attribution: "© IGN — Géoplateforme", maxzoom: 19 },
        },
        layers: [{ id: "ortho", type: "raster", source: "ortho" }],
      },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => setMap(m));
    return () => {
      setMap(null);
      m.remove();
    };
  }, []);

  const parcels = useMemo<Feature<Polygon>[] | null>(() => {
    if (!snap.data) return null;
    // L'éditeur travaille sur des polygones simples : un multipolygone donne une surface par partie.
    return snap.data.landParcels.flatMap((p) => {
      const shape = p.version.shape as unknown as { type: string; coordinates: unknown };
      const parts = shape.type === "MultiPolygon" ? (shape.coordinates as Polygon["coordinates"][]) : [shape.coordinates as Polygon["coordinates"]];
      return parts.map((coordinates, i) => ({
        type: "Feature" as const,
        id: parts.length > 1 ? `${p.id}:${i}` : p.id,
        properties: { parcelId: p.id, name: parts.length > 1 ? `${p.name} (${i + 1})` : p.name, storedAreaM2: parts.length > 1 ? null : p.version.areaM2 },
        geometry: { type: "Polygon" as const, coordinates },
      }));
    });
  }, [snap.data]);

  const carto = useCartoEditor(map, parcels);

  // Cadrage sur les parcelles au premier chargement.
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || !parcels?.length || fitted.current) return;
    map.fitBounds(bounds(parcels), { padding: 40, duration: 0 });
    fitted.current = true;
  }, [map, parcels]);

  /** Sélectionne une surface de la liste et centre la carte dessus. */
  const focus = (f: Feature<Polygon>) => {
    carto.editor?.select([String(f.id)]);
    if (map) map.fitBounds(bounds([f]), { padding: 80, duration: 0 });
  };

  if (snap.error) return <ErrorAlert error={snap.error} />;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1}>Outils de carte</Title>
        <Button component={Link} to={`/f/${farm.id}/map${location.search}`} variant="default">
          Retour à la carte
        </Button>
      </Group>
      <Alert color="blue" variant="light">
        Atelier d'essai : parcelles au {formatDate(at)}. Dessinez, découpez, fusionnez, mesurez ; rien n'est enregistré.
      </Alert>
      <CartoToolbar state={carto} />
      <Grid>
        <Grid.Col span={{ base: 12, md: 8 }} style={{ height: "64vh" }}>
          <div ref={container} style={{ width: "100%", height: "100%", borderRadius: 8 }} data-testid="carto-map" />
          {!parcels && <Loading />}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper p="md" withBorder>
            <Title order={4} mb="xs">
              Surfaces ({carto.features.length})
            </Title>
            <ScrollArea h="54vh">
              <Table striped aria-label="Surfaces">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nom</Table.Th>
                    <Table.Th ta="right">Surface</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {carto.features.map((f) => {
                    const p = f.properties as { name?: string; storedAreaM2?: number | null };
                    const selected = carto.selection.includes(String(f.id));
                    return (
                      <Table.Tr
                        key={String(f.id)}
                        bg={selected ? "var(--mantine-color-yellow-light)" : undefined}
                        style={{ cursor: "pointer" }}
                        aria-selected={selected}
                        onClick={() => focus(f)}
                      >
                        <Table.Td>{p.name ?? <Text span c="dimmed">Nouvelle surface</Text>}</Table.Td>
                        <Table.Td ta="right" className="lv-num">
                          {formatArea(areaM2(f.geometry))}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
