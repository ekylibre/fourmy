import { useEffect, useRef, useState } from "react";
import { Paper } from "@mantine/core";
import { Map as MlMap, NavigationControl, ScaleControl, type GeoJSONSource, type LngLatBoundsLike, type MapMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";
import { polygons } from "@fourmy/carto";
import { CartoEditor } from "../../carto/editor";
import { useFarmId } from "../../app/farm";
import { whenStyleLoaded } from "../../carto/when-style-loaded";
import { ignSource } from "../map/ParcelMap"; // règle aussi le worker de MapLibre
import { parcelsInBox, type ParcelShape } from "../interventions/zones";

/** Parcelle de l'assolement sur la carte. */
export interface CropPlanMapParcel extends ParcelShape {
  key: string;
  /** Couleur de l'activité prévue ; null : pas encore de culture. */
  color: string | null;
  fallow: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const NONE = "#FFF8E7";
/** Parcelles sans culture prévue (contour en pointillés). */
export const TODO = "#E03131";

function bounds(parcels: ParcelShape[]): LngLatBoundsLike | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  parcels.forEach((p) => visit(p.shape.coordinates));
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/**
 * Carte de l'assolement (FR-AS-4, FR-AS-5) : chaque parcelle à la couleur de
 * sa culture prévue, sans culture en clair et en pointillés ; clic pour
 * ajouter ou retirer une parcelle de la sélection, Maj + glisser pour en
 * prendre plusieurs.
 */
export function CropPlanMap({
  parcels,
  selected,
  onSelect,
  cutting = null,
  onCut,
  onError,
  height = 520,
}: {
  parcels: CropPlanMapParcel[];
  selected: string[];
  onSelect: (keys: string[]) => void;
  /** Parcelle en cours de découpe (outil carto « Découper »), ou null. */
  cutting?: string | null;
  onCut?: (key: string, pieces: Polygon[]) => void;
  onError?: (message: string) => void;
  height?: number;
}) {
  const farmId = useFarmId();
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const editor = useRef<CartoEditor | null>(null);
  const latest = useRef({ parcels, selected, onSelect, cutting, onCut, onError });
  latest.current = { parcels, selected, onSelect, cutting, onCut, onError };

  useEffect(() => {
    if (!container.current) return;
    const m = new MlMap({
      container: container.current,
      center: [2.5, 46.5],
      zoom: 5,
      boxZoom: false,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: { ortho: ignSource(farmId, "ortho"), parcels: { type: "geojson", data: EMPTY } },
        layers: [
          { id: "ortho", type: "raster", source: "ortho" },
          {
            id: "parcels-fill",
            type: "fill",
            source: "parcels",
            paint: { "fill-color": ["case", ["get", "planned"], ["get", "color"], TODO], "fill-opacity": ["case", ["get", "planned"], 0.45, 0.12] },
          },
          // Sans culture prévue : contour rouge en pointillés ; affectées : contour de la couleur de l'activité.
          {
            id: "parcels-line",
            type: "line",
            source: "parcels",
            filter: ["all", ["!", ["get", "selected"]], ["get", "planned"]],
            paint: { "line-color": ["get", "color"], "line-width": 3 },
          },
          {
            id: "parcels-todo",
            type: "line",
            source: "parcels",
            filter: ["all", ["!", ["get", "selected"]], ["!", ["get", "planned"]]],
            paint: { "line-color": TODO, "line-width": 3, "line-dasharray": [2, 1.5] },
          },
          { id: "parcels-selected", type: "line", source: "parcels", filter: ["get", "selected"], paint: { "line-color": "#FFFFFF", "line-width": 4 } },
        ],
      },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    whenStyleLoaded(m, () => {
      // Outils carto communs : la découpe (ligne tracée) seulement.
      editor.current = new CartoEditor(m, {
        onChange: (features: Feature<Polygon>[]) => {
          const key = latest.current.cutting;
          if (!key || features.length < 2) return;
          latest.current.onCut?.(key, features.map((f) => f.geometry));
        },
        onError: (message) => latest.current.onError?.(message),
      });
      editor.current.setTool("none");
      setMap(m);
    });
    m.on("click", "parcels-fill", (e) => {
      if (latest.current.cutting) return;
      const key = e.features?.[0]?.properties?.key as string | undefined;
      if (!key) return;
      const { selected: current, onSelect: select } = latest.current;
      select(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
    });
    m.on("mouseenter", "parcels-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "parcels-fill", () => (m.getCanvas().style.cursor = ""));

    let start: { x: number; y: number } | null = null;
    const down = (e: MapMouseEvent) => {
      if (!e.originalEvent.shiftKey) return;
      e.preventDefault();
      m.dragPan.disable();
      start = { x: e.point.x, y: e.point.y };
      setBox({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    };
    const move = (e: MapMouseEvent) => start && setBox({ x0: start.x, y0: start.y, x1: e.point.x, y1: e.point.y });
    const up = (e: MapMouseEvent) => {
      if (!start) return;
      const corners = [
        [start.x, start.y],
        [e.point.x, start.y],
        [e.point.x, e.point.y],
        [start.x, e.point.y],
      ].map(([x, y]) => m.unproject([x!, y!]).toArray());
      const byId = new Map(latest.current.parcels.map((p) => [p.id, p.key]));
      const keys = parcelsInBox(corners, latest.current.parcels).map((id) => byId.get(id)!);
      const { selected: current, onSelect: select } = latest.current;
      select([...new Set([...current, ...keys])]);
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
  }, [farmId]);

  // Découpe : la parcelle seule dans l'éditeur, outil « cut » ; sinon rien.
  useEffect(() => {
    const ed = editor.current;
    if (!map || !ed) return;
    const p = cutting ? parcels.find((x) => x.key === cutting) : undefined;
    const parts = p ? polygons(p.shape) : [];
    if (p && parts.length === 1) {
      ed.load([{ type: "Feature", id: p.key, properties: { key: p.key }, geometry: parts[0]! }]);
      ed.select([p.key]);
      ed.setTool("cut");
    } else {
      ed.load([]);
      ed.setTool("none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rechargé quand la parcelle à découper change, pas à chaque rendu
  }, [map, cutting]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!map) return;
    (map.getSource("parcels") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: parcels.map((p) => ({
        type: "Feature",
        geometry: p.shape as Geometry,
        properties: { key: p.key, color: p.color ?? NONE, planned: !!p.color || p.fallow, selected: selected.includes(p.key) },
      })),
    });
    if (!fitted.current) {
      const b = bounds(parcels);
      if (b) {
        map.fitBounds(b, { padding: 30, duration: 0 });
        fitted.current = true;
      }
    }
  }, [map, parcels, selected]);

  return (
    <Paper withBorder style={{ height, position: "relative", overflow: "hidden" }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} data-testid="crop-plan-map" />
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
  );
}
