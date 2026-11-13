import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Map as MlMap, Marker, NavigationControl, ScaleControl, type GeoJSONSource } from "maplibre-gl";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { GeoPoint } from "@fourmy/contracts";
import { whenStyleLoaded } from "../../carto/when-style-loaded";
import { WMTS } from "../map/ParcelMap";

/**
 * Carte des sites (E6, E18) : un point et le cercle de sa zone par site,
 * les parcelles en contour pour juger de la couverture. En édition, le site
 * modifié a une épingle déplaçable ; un clic sur la carte la pose.
 */

export interface MapSite {
  id: string;
  name: string;
  location: GeoPoint | null;
  radiusM: number;
  isHeadquarters: boolean;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Cercle géodésique approché (64 sommets), suffisant à l'échelle d'une zone de 1 à 30 km. */
export function circle(center: GeoPoint, radiusM: number, steps = 64): Feature<Polygon> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (2 * Math.PI * (i % steps)) / steps;
    return [center.lon + dLon * Math.cos(a), center.lat + dLat * Math.sin(a)];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

export function SitesMap({
  sites,
  parcels,
  edit,
  height = 360,
}: {
  sites: MapSite[];
  parcels: FeatureCollection;
  /** Site en cours d'édition : épingle déplaçable, cercle à jour. */
  edit?: { id: string | null; location: GeoPoint | null; radiusM: number; onMove: (p: GeoPoint) => void };
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const onMove = useRef(edit?.onMove);
  onMove.current = edit?.onMove;
  const editing = edit !== undefined;

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
          zones: { type: "geojson", data: EMPTY },
          parcels: { type: "geojson", data: EMPTY },
        },
        layers: [
          { id: "plan", type: "raster", source: "plan" },
          { id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#2B7BB9", "fill-opacity": 0.08 } },
          { id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#2B7BB9", "line-width": 1.5, "line-dasharray": [3, 2] } },
          { id: "parcels-line", type: "line", source: "parcels", paint: { "line-color": "#E8B500", "line-width": 1.5 } },
        ],
      },
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    whenStyleLoaded(m, () => setMap(m));
    if (editing) m.on("click", (e) => onMove.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    return () => {
      setMap(null);
      m.remove();
    };
  }, [editing]);

  // Zones, parcelles, points des autres sites. Cadrage au premier affichage,
  // puis à chaque changement des sites placés (vue d'ensemble seulement : en
  // édition, le cadre ne doit pas bouger sous l'épingle).
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const shown = sites.map((s) => (edit && s.id === edit.id ? { ...s, location: edit.location, radiusM: edit.radiusM } : s));
    if (edit && edit.id === null && edit.location) shown.push({ id: "new", name: "Nouveau site", location: edit.location, radiusM: edit.radiusM, isHeadquarters: false });
    const located = shown.filter((s): s is MapSite & { location: GeoPoint } => s.location !== null);
    (map.getSource("zones") as GeoJSONSource).setData({ type: "FeatureCollection", features: located.map((s) => circle(s.location, s.radiusM)) });
    (map.getSource("parcels") as GeoJSONSource).setData(parcels);
    const others = located.filter((s) => !edit || s.id !== (edit.id ?? "new")).map((s) => new Marker({ color: s.isHeadquarters ? "#2B7BB9" : "#5C6B73", scale: 0.7 }).setLngLat([s.location.lon, s.location.lat]).addTo(map));
    const key = editing ? "edit" : located.map((s) => `${s.id}:${s.location.lat}:${s.location.lon}:${s.radiusM}`).join("|") + `#${parcels.features.length}`;
    if (fitted.current !== key) {
      const b = new LngLatBounds();
      for (const s of located) for (const [lon, lat] of circle(s.location, s.radiusM, 8).geometry.coordinates[0]!) b.extend([lon!, lat!]);
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") b.extend([c[0], c[1] as number]);
        else if (Array.isArray(c)) c.forEach(walk);
      };
      for (const f of parcels.features) if ("coordinates" in f.geometry) walk(f.geometry.coordinates);
      if (!b.isEmpty()) {
        map.fitBounds(b, { padding: 20, duration: 0, maxZoom: 15 });
        fitted.current = key;
      }
    }
    return () => others.forEach((o) => o.remove());
  }, [map, sites, parcels, edit, editing]);

  // Épingle du site édité.
  useEffect(() => {
    if (!map || !edit) return;
    if (!edit.location) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = new Marker({ color: "#C0392B", draggable: true }).setLngLat([edit.location.lon, edit.location.lat]).addTo(map);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLngLat();
        onMove.current?.({ lat: p.lat, lon: p.lng });
      });
      map.easeTo({ center: [edit.location.lon, edit.location.lat], zoom: Math.max(map.getZoom(), 14), duration: 0 });
    } else {
      marker.current.setLngLat([edit.location.lon, edit.location.lat]);
      // Point venu d'une suggestion d'adresse, hors du cadre : on le suit.
      if (!map.getBounds().contains([edit.location.lon, edit.location.lat])) map.easeTo({ center: [edit.location.lon, edit.location.lat], zoom: 14, duration: 0 });
    }
  }, [map, edit]);

  return <div ref={container} data-testid="sites-map" style={{ height, borderRadius: 8, overflow: "hidden" }} />;
}
