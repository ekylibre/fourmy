import { useEffect, useRef, useState } from "react";
import { Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 charge son worker (module ESM) relativement à son propre fichier,
// introuvable une fois bundlé : on fait construire le worker par Vite (avec ses
// dépendances) et on lui en donne l'URL. Sans cela : « Worker failed to load »,
// la carte ne reçoit jamais `load` (ni parcelles, ni trace).
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);

export type Basemap = "plan" | "ortho";

/** Fonds IGN Géoplateforme (WMTS, sans clé) — souverains, à jour. */
export const WMTS = (layer: string, format: string) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export interface ParcelMapProps {
  parcels: FeatureCollection;
  places: FeatureCollection;
  track: FeatureCollection;
  /** Zones de travail (interventions), en orange au-dessus des parcelles. */
  zones?: FeatureCollection;
  basemap: Basemap;
  onSelect?: (properties: Record<string, unknown> | null) => void;
}

function bbox(fc: FeatureCollection): LngLatBoundsLike | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const f of fc.features) if (f.geometry && "coordinates" in f.geometry) visit(f.geometry.coordinates);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/** Carte de travail (MapLibre) : parcellaire à la date, bâtiments, trace GPS. */
export function ParcelMap({ parcels, places, track, zones = EMPTY, basemap, onSelect }: ParcelMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);

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
          plan: { type: "raster", tiles: [WMTS("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png")], tileSize: 256, attribution: "© IGN — Géoplateforme", maxzoom: 19 },
          ortho: { type: "raster", tiles: [WMTS("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg")], tileSize: 256, attribution: "© IGN — Géoplateforme", maxzoom: 19 },
          parcels: { type: "geojson", data: EMPTY },
          places: { type: "geojson", data: EMPTY },
          track: { type: "geojson", data: EMPTY },
          zones: { type: "geojson", data: EMPTY },
        },
        layers: [
          { id: "plan", type: "raster", source: "plan" },
          { id: "ortho", type: "raster", source: "ortho", layout: { visibility: "none" } },
          { id: "parcels-fill", type: "fill", source: "parcels", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.4 } },
          { id: "parcels-casing", type: "line", source: "parcels", paint: { "line-color": "#1E2421", "line-width": 3.5, "line-opacity": 0.6 } },
          { id: "parcels-line", type: "line", source: "parcels", paint: { "line-color": ["get", "color"], "line-width": 2 } },
          { id: "places-fill", type: "fill", source: "places", paint: { "fill-color": "#3B5A78", "fill-opacity": 0.7 } },
          { id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#E85D04", "fill-opacity": 0.3 } },
          { id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#E85D04", "line-width": 1.5 } },
          {
            id: "track-transport", type: "line", source: "track", filter: ["==", ["get", "working"], false],
            paint: { "line-color": "#3B5A78", "line-width": 2, "line-dasharray": [2, 2] },
          },
          {
            id: "track-work", type: "line", source: "track", filter: ["==", ["get", "working"], true],
            paint: { "line-color": "#E85D04", "line-width": 3 },
          },
        ],
      },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => setReady(true));
    m.on("click", "parcels-fill", (e) => {
      const f = e.features?.[0];
      onSelect?.(f ? (f.properties as Record<string, unknown>) : null);
    });
    m.on("mouseenter", "parcels-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "parcels-fill", () => (m.getCanvas().style.cursor = ""));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("parcels") as GeoJSONSource).setData(parcels);
    (m.getSource("places") as GeoJSONSource).setData(places);
    (m.getSource("zones") as GeoJSONSource).setData(zones);
    if (!fitted.current) {
      const b = bbox(parcels);
      if (b) {
        m.fitBounds(b, { padding: 40, duration: 0 });
        fitted.current = true;
      }
    }
  }, [parcels, places, zones, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("track") as GeoJSONSource).setData(track);
    const b = track.features.length ? bbox(track) : null;
    if (b) m.fitBounds(b, { padding: 60, duration: 600 });
  }, [track, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty("plan", "visibility", basemap === "plan" ? "visible" : "none");
    m.setLayoutProperty("ortho", "visibility", basemap === "ortho" ? "visible" : "none");
  }, [basemap, ready]);

  return <div ref={container} style={{ width: "100%", height: "100%", minHeight: 480, borderRadius: 14, overflow: "hidden" }} />;
}
