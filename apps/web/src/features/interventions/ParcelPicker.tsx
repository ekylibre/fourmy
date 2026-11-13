import { whenStyleLoaded } from "../../carto/when-style-loaded";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Button, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { Map as MlMap, NavigationControl, ScaleControl, type GeoJSONSource, type LngLatBoundsLike, type MapMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import { Crosshair, Pentagon, Trash2, X } from "lucide-react";
import { formatHa } from "@fourmy/ui-lyvre";
import type { Area } from "@fourmy/carto";
import { CartoEditor } from "../../carto/editor";
import { WMTS } from "../map/ParcelMap"; // règle aussi le worker de MapLibre
import { parcelsInBox, zonesFor, type ParcelShape, type WorkingZone } from "./zones";

export interface PickerParcel extends ParcelShape {
  name: string;
}

export interface ParcelPickerProps {
  parcels: PickerParcel[];
  selected: string[];
  /** Zones de travail partielles déjà dessinées, par parcelle. */
  zones: Map<string, { workingZone?: unknown; workedAreaM2?: number }>;
  onSelect: (ids: string[]) => void;
  onZones: (zones: WorkingZone[]) => void;
  onClearZone: (parcelId: string) => void;
  /** Cours d'eau et plans d'eau autour de la ferme (fossés en pointillés). */
  water?: FeatureCollection;
  /** Bande de ZNT autour des parcelles choisies. */
  buffer?: FeatureCollection;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function bounds(geometries: Area[]): LngLatBoundsLike | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  geometries.forEach((g) => visit(g.coordinates));
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/**
 * Choix des parcelles sur la carte (exigence INT-UI-6) : clic pour ajouter ou
 * retirer une parcelle, Maj + glisser pour en prendre plusieurs d'un coup,
 * « Zone partielle » pour dessiner la surface réellement travaillée (découpée
 * sur les parcelles touchées par les outils carto communs). Les parcelles sont
 * celles de la date de l'intervention.
 */
export function ParcelPicker({ parcels, selected, zones, onSelect, onZones, onClearZone, water = EMPTY, buffer = EMPTY }: ParcelPickerProps) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const editor = useRef<CartoEditor | null>(null);
  // Le clic qui ferme une zone arrive aussi à la carte : sans garde, il retirerait la parcelle.
  const drawEnded = useRef(0);
  // Rappels à jour pour les gestionnaires de la carte (créés une fois).
  const latest = useRef({ selected, onSelect, onZones, parcels, drawing });
  latest.current = { selected, onSelect, onZones, parcels, drawing };

  // Eau et bande de ZNT : mises à jour quand elles arrivent ou changent.
  useEffect(() => {
    if (!map) return;
    (map.getSource("water") as GeoJSONSource | undefined)?.setData(water);
    (map.getSource("buffer") as GeoJSONSource | undefined)?.setData(buffer);
  }, [map, water, buffer]);

  useEffect(() => {
    if (!container.current) return;
    const m = new MlMap({
      container: container.current,
      center: [2.5, 46.5],
      zoom: 5,
      boxZoom: false, // Maj + glisser sert à la sélection par zone
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          ortho: { type: "raster", tiles: [WMTS("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg")], tileSize: 256, attribution: "© IGN — Géoplateforme", maxzoom: 19 },
          parcels: { type: "geojson", data: EMPTY },
          zones: { type: "geojson", data: EMPTY },
          water: { type: "geojson", data: EMPTY },
          buffer: { type: "geojson", data: EMPTY },
        },
        layers: [
          { id: "ortho", type: "raster", source: "ortho" },
          { id: "buffer-fill", type: "fill", source: "buffer", paint: { "fill-color": "#C0392B", "fill-opacity": 0.2 } },
          { id: "buffer-line", type: "line", source: "buffer", paint: { "line-color": "#C0392B", "line-width": 1.5, "line-dasharray": [3, 2] } },
          {
            id: "parcels-fill",
            type: "fill",
            source: "parcels",
            paint: { "fill-color": ["case", ["get", "selected"], "#E8B500", "#FFF8E7"], "fill-opacity": ["case", ["get", "selected"], 0.35, 0.08] },
          },
          {
            id: "parcels-line",
            type: "line",
            source: "parcels",
            paint: { "line-color": ["case", ["get", "selected"], "#E8B500", "#FFF8E7"], "line-width": ["case", ["get", "selected"], 3, 1.5] },
          },
          { id: "water-fill", type: "fill", source: "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2B7BB9", "fill-opacity": 0.55 } },
          {
            id: "water-line", type: "line", source: "water", filter: ["all", ["!=", ["geometry-type"], "Polygon"], ["!=", ["get", "ditch"], true]],
            paint: { "line-color": "#4FA3E0", "line-width": ["case", ["==", ["get", "permanent"], false], 1.5, 2.5] },
          },
          {
            id: "water-ditch", type: "line", source: "water", filter: ["all", ["!=", ["geometry-type"], "Polygon"], ["==", ["get", "ditch"], true]],
            paint: { "line-color": "#4FA3E0", "line-width": 1, "line-dasharray": [2, 2] },
          },
          { id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#E85D04", "fill-opacity": 0.45 } },
          { id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#E85D04", "line-width": 2 } },
        ],
      },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    // Prête dès que le style est chargé, sans attendre les tuiles IGN (lentes en CI, ou hors ligne).
    whenStyleLoaded(m, () => {
      editor.current = new CartoEditor(m, {
        onChange: (features: Feature<Polygon>[]) => {
          const drawn = features.at(-1);
          if (!drawn) return;
          drawEnded.current = Date.now();
          const found = zonesFor(drawn.geometry, latest.current.parcels);
          if (found.length) latest.current.onZones(found);
          setNotice(found.length ? null : "La zone dessinée ne touche aucune parcelle.");
          editor.current?.load([]);
          editor.current?.setTool("none");
          setDrawing(false);
        },
      });
      editor.current.setTool("none");
      setMap(m);
    });
    m.on("click", "parcels-fill", (e) => {
      if (latest.current.drawing || Date.now() - drawEnded.current < 400) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const { selected: current, onSelect: select } = latest.current;
      select(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
    });
    m.on("mouseenter", "parcels-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "parcels-fill", () => (m.getCanvas().style.cursor = ""));

    // Maj + glisser : toutes les parcelles du rectangle.
    let start: { x: number; y: number } | null = null;
    const down = (e: MapMouseEvent) => {
      if (!e.originalEvent.shiftKey || latest.current.drawing) return;
      e.preventDefault();
      m.dragPan.disable();
      start = { x: e.point.x, y: e.point.y };
      setBox({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    };
    const move = (e: MapMouseEvent) => start && setBox({ x0: start.x, y0: start.y, x1: e.point.x, y1: e.point.y });
    const up = (e: MapMouseEvent) => {
      if (!start) return;
      // Calcul sur les contours, pas sur ce que la carte a déjà dessiné
      // (queryRenderedFeatures) : juste après l'ouverture, des parcelles
      // pouvaient manquer.
      const corners = [
        [start.x, start.y],
        [e.point.x, start.y],
        [e.point.x, e.point.y],
        [start.x, e.point.y],
      ].map(([x, y]) => m.unproject([x!, y!]).toArray());
      const ids = parcelsInBox(corners, latest.current.parcels);
      const { selected: current, onSelect: select } = latest.current;
      select([...new Set([...current, ...ids])]);
      start = null;
      setBox(null);
      m.dragPan.enable();
    };
    m.on("mousedown", down);
    m.on("mousemove", move);
    m.on("mouseup", up);
    return () => {
      editor.current?.destroy();
      editor.current = null;
      setMap(null);
      m.remove();
    };
  }, []);

  // Parcelles et zones affichées.
  const fitted = useRef(false);
  useEffect(() => {
    if (!map) return;
    (map.getSource("parcels") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: parcels.map((p) => ({ type: "Feature", geometry: p.shape as Geometry, properties: { id: p.id, selected: selected.includes(p.id) } })),
    });
    (map.getSource("zones") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [...zones.entries()]
        .filter(([id, z]) => z.workingZone && selected.includes(id))
        .map(([id, z]) => ({ type: "Feature", geometry: z.workingZone as Geometry, properties: { id } })),
    });
    if (!fitted.current) {
      const chosen = parcels.filter((p) => selected.includes(p.id));
      const b = bounds((chosen.length ? chosen : parcels).map((p) => p.shape));
      if (b) {
        map.fitBounds(b, { padding: 30, duration: 0 });
        fitted.current = true;
      }
    }
  }, [map, parcels, selected, zones]);

  const byId = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);
  const center = (id: string) => {
    const p = byId.get(id);
    const b = p && bounds([p.shape]);
    if (map && b) map.fitBounds(b, { padding: 60, duration: 0 });
  };
  const startZone = () => {
    setNotice(null);
    editor.current?.setTool("draw");
    setDrawing(true);
  };
  const stopZone = () => {
    editor.current?.load([]);
    editor.current?.setTool("none");
    setDrawing(false);
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">
          {drawing
            ? "Cliquez les sommets de la zone travaillée ; cliquez le premier point pour fermer."
            : "Clic : ajouter ou retirer une parcelle · Maj + glisser : plusieurs parcelles."}
        </Text>
        {drawing ? (
          <Button size="xs" variant="default" leftSection={<X size={14} />} onClick={stopZone}>
            Annuler le dessin
          </Button>
        ) : (
          <Button size="xs" variant="light" leftSection={<Pentagon size={14} />} onClick={startZone} disabled={!map}>
            Zone partielle
          </Button>
        )}
      </Group>
      <Paper withBorder style={{ height: 340, position: "relative", overflow: "hidden" }}>
        <div ref={container} style={{ position: "absolute", inset: 0 }} data-testid="parcel-picker-map" />
        {box && (
          <div
            style={{
              position: "absolute",
              left: Math.min(box.x0, box.x1),
              top: Math.min(box.y0, box.y1),
              width: Math.abs(box.x1 - box.x0),
              height: Math.abs(box.y1 - box.y0),
              border: "2px dashed #E8B500",
              background: "rgba(232,181,0,0.12)",
              pointerEvents: "none",
            }}
          />
        )}
      </Paper>
      {notice && (
        <Text size="sm" c="brique" role="alert">
          {notice}
        </Text>
      )}
      {selected.length > 0 && (
        <Stack gap={2} aria-label="Parcelles choisies">
          {selected.map((id) => {
            const p = byId.get(id);
            const z = zones.get(id);
            return (
              <Group key={id} justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm">
                  {p?.name ?? "Parcelle d'une autre date"}{" "}
                  <Text span size="xs" c="dimmed" className="lv-num">
                    {z?.workedAreaM2 ? `zone ${formatHa(z.workedAreaM2)} sur ${formatHa(p?.areaM2 ?? 0)}` : p ? formatHa(p.areaM2) : ""}
                  </Text>
                </Text>
                <Group gap={2} wrap="nowrap">
                  <Tooltip label="Voir sur la carte">
                    <ActionIcon variant="subtle" size="sm" aria-label={`Voir ${p?.name ?? "la parcelle"} sur la carte`} onClick={() => center(id)}>
                      <Crosshair size={14} />
                    </ActionIcon>
                  </Tooltip>
                  {z?.workingZone ? (
                    <Tooltip label="Retirer la zone partielle (parcelle entière)">
                      <ActionIcon variant="subtle" size="sm" color="brique" aria-label={`Retirer la zone de ${p?.name ?? "la parcelle"}`} onClick={() => onClearZone(id)}>
                        <Trash2 size={14} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
