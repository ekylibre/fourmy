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
  /** Cours d'eau et plans d'eau (BD TOPO) ; les fossés en pointillés. */
  water?: FeatureCollection;
  /** Bande de ZNT autour de la zone traitée, hachurée de rouge, incluse dans le cadrage. */
  buffer?: FeatureCollection;
  /** Hauteur minimale (480 px par défaut ; 0 pour suivre son cadre). */
  minHeight?: number;
  basemap: Basemap;
  onSelect?: (properties: Record<string, unknown> | null) => void;
  /** Clic n'importe où sur la carte (création d'une parcelle). */
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  /** Forme proposée (parcelle PAC ou cadastrale), en surbrillance. */
  highlight?: FeatureCollection;
  /** Image satellite (PNG transparent hors parcelles) posée sous les contours des parcelles. */
  satellite?: { href: string; bbox: [number, number, number, number] } | null;
  /** Opacité du remplissage des parcelles (0,4 par défaut ; plus faible sous une image satellite). */
  fillOpacity?: number;
}

function bbox(...fcs: FeatureCollection[]): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as [number, number];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const fc of fcs) for (const f of fc.features) if (f.geometry && "coordinates" in f.geometry) visit(f.geometry.coordinates);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/** Carte de travail (MapLibre) : parcellaire à la date, bâtiments, trace GPS. */
export function ParcelMap({
  parcels,
  places,
  track,
  zones = EMPTY,
  water = EMPTY,
  buffer = EMPTY,
  minHeight = 480,
  basemap,
  onSelect,
  onMapClick,
  highlight = EMPTY,
  satellite = null,
  fillOpacity = 0.4,
}: ParcelMapProps) {
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  // Dernier cadrage automatique, rejoué quand le cadre change de taille (tant que l'utilisateur n'a pas bougé la carte).
  const bounds = useRef<LngLatBoundsLike | null>(null);
  const moved = useRef(false);

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
          water: { type: "geojson", data: EMPTY },
          buffer: { type: "geojson", data: EMPTY },
          highlight: { type: "geojson", data: EMPTY },
        },
        layers: [
          { id: "plan", type: "raster", source: "plan" },
          { id: "ortho", type: "raster", source: "ortho", layout: { visibility: "none" } },
          { id: "parcels-fill", type: "fill", source: "parcels", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.4 } },
          { id: "parcels-casing", type: "line", source: "parcels", paint: { "line-color": "#1E2421", "line-width": 3.5, "line-opacity": 0.6 } },
          { id: "parcels-line", type: "line", source: "parcels", paint: { "line-color": ["get", "color"], "line-width": 2 } },
          { id: "buffer-fill", type: "fill", source: "buffer", paint: { "fill-color": "#C0392B", "fill-opacity": 0.18 } },
          { id: "buffer-line", type: "line", source: "buffer", paint: { "line-color": "#C0392B", "line-width": 1.5, "line-dasharray": [3, 2] } },
          { id: "water-fill", type: "fill", source: "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2B7BB9", "fill-opacity": 0.5 } },
          {
            id: "water-line", type: "line", source: "water", filter: ["all", ["!=", ["geometry-type"], "Polygon"], ["!=", ["get", "ditch"], true]],
            paint: { "line-color": "#2B7BB9", "line-width": ["case", ["==", ["get", "permanent"], false], 1.5, 2.5] },
          },
          {
            id: "water-ditch", type: "line", source: "water", filter: ["all", ["!=", ["geometry-type"], "Polygon"], ["==", ["get", "ditch"], true]],
            paint: { "line-color": "#2B7BB9", "line-width": 1, "line-dasharray": [2, 2] },
          },
          { id: "places-fill", type: "fill", source: "places", paint: { "fill-color": "#3B5A78", "fill-opacity": 0.7 } },
          { id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#E85D04", "fill-opacity": 0.3 } },
          { id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#E85D04", "line-width": 1.5 } },
          { id: "highlight-fill", type: "fill", source: "highlight", paint: { "fill-color": "#00B4D8", "fill-opacity": 0.3 } },
          { id: "highlight-line", type: "line", source: "highlight", paint: { "line-color": "#00B4D8", "line-width": 3 } },
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
    m.on("click", (e) => clickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    // Un geste de l'utilisateur (pas un fitBounds) : on ne recadre plus de soi-même.
    m.on("movestart", (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) moved.current = true;
    });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            m.resize();
            if (bounds.current && !moved.current) m.fitBounds(bounds.current, { padding: 40, duration: 0 });
          });
    observer?.observe(container.current);
    m.on("click", "parcels-fill", (e) => {
      const f = e.features?.[0];
      onSelect?.(f ? (f.properties as Record<string, unknown>) : null);
    });
    m.on("mouseenter", "parcels-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "parcels-fill", () => (m.getCanvas().style.cursor = ""));
    map.current = m;
    return () => {
      observer?.disconnect();
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
    (m.getSource("water") as GeoJSONSource).setData(water);
    (m.getSource("buffer") as GeoJSONSource).setData(buffer);
    (m.getSource("highlight") as GeoJSONSource).setData(highlight);
    if (onMapClick) m.getCanvas().style.cursor = "crosshair";
    // Cadrage sur les parcelles et la bande de ZNT ; refait quand la bande arrive.
    const b = bbox(parcels, buffer);
    if (b && (!fitted.current || (buffer.features.length > 0 && !moved.current))) {
      bounds.current = b;
      m.fitBounds(b, { padding: 40, duration: 0 });
      fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels, places, zones, water, buffer, highlight, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("track") as GeoJSONSource).setData(track);
    // La trace et les parcelles : toutes restent visibles.
    const b = track.features.length ? bbox(track, parcels, buffer) : null;
    if (b) {
      bounds.current = b;
      m.fitBounds(b, { padding: 40, duration: 600 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setLayoutProperty("plan", "visibility", basemap === "plan" ? "visible" : "none");
    m.setLayoutProperty("ortho", "visibility", basemap === "ortho" ? "visible" : "none");
  }, [basemap, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.setPaintProperty("parcels-fill", "fill-opacity", fillOpacity);
  }, [fillOpacity, ready]);

  // Image satellite : source `image` aux 4 coins de son emprise (WGS84), sous les parcelles.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (m.getLayer("satellite")) m.removeLayer("satellite");
    if (m.getSource("satellite")) m.removeSource("satellite");
    if (!satellite) return;
    const [w, s, e, n] = satellite.bbox;
    m.addSource("satellite", { type: "image", url: satellite.href, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    m.addLayer({ id: "satellite", type: "raster", source: "satellite", paint: { "raster-fade-duration": 0, "raster-resampling": "nearest" } }, "parcels-fill");
  }, [satellite?.href, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} style={{ width: "100%", height: "100%", minHeight, borderRadius: 14, overflow: "hidden" }} />;
}
