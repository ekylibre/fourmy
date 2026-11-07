import "./cesium-base";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClassificationType,
  ClockRange,
  Color,
  CustomHeightmapTerrainProvider,
  DistanceDisplayCondition,
  Entity,
  GeographicTilingScheme,
  HeightReference,
  JulianDate,
  LabelStyle,
  NearFarScalar,
  Math as CesiumMath,
  SampledPositionProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TimeInterval,
  TimeIntervalCollection,
  VerticalOrigin,
  Viewer,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
  sampleTerrain,
  defined,
} from "cesium";
import { outerRing, type Pt } from "@fourmy/domain";
import type { GeoJsonGeometry } from "@fourmy/contracts";
import { initialView, splitRuns, type Sample } from "./geometry";

/**
 * Scène 3D de la ferme (ADR-8/9/10) : relief IGN servi par l'API, photo
 * aérienne IGN, parcelles drapées, bâtiments extrudés translucides, cuves
 * (enveloppe + liquide), trace GPS rejouée sur l'horloge Cesium.
 * Aucun service Cesium ion n'est utilisé.
 */

export interface PlanData {
  extent: { west: number; south: number; east: number; north: number } | null;
  parcels: { id: string; name: string; nature: string | null; shape: GeoJsonGeometry }[];
  buildings: { id: string; name: string; kind: string; footprint: GeoJsonGeometry; heightM: number; heightSource: string }[];
  tanks: { id: string; name: string; placeId: string; lon: number; lat: number; radius: number; height: number; fill: number; placement: string }[];
  context: { id: string; footprint: { type: string; coordinates: unknown }; heightM: number }[];
}

const COLORS = {
  vine: Color.fromCssColorString("#7A3B5C"),
  field_crop: Color.fromCssColorString("#D9A441"),
  grassland: Color.fromCssColorString("#6FB08E"),
  none: Color.fromCssColorString("#8A948E"),
  building: Color.fromCssColorString("#DDE8DF"),
  room: Color.fromCssColorString("#3B5A78"),
  context: Color.fromCssColorString("#C9CEC8"),
  tankShell: Color.fromCssColorString("#F6F4EE"),
  wine: Color.fromCssColorString("#7A3B5C"),
  selected: Color.fromCssColorString("#D9A441"),
  work: Color.fromCssColorString("#E85D04"),
  transport: Color.fromCssColorString("#3B5A78"),
};

const IGN_ORTHO = new WebMapTileServiceImageryProvider({
  url: "https://data.geopf.fr/wmts",
  layer: "ORTHOIMAGERY.ORTHOPHOTOS",
  style: "normal",
  format: "image/jpeg",
  tileMatrixSetID: "PM",
  tilingScheme: new WebMercatorTilingScheme(),
  maximumLevel: 19,
  credit: "© IGN — Géoplateforme",
});

const safeRing = (ring: Pt[]) => {
  if (ring.length < 3) throw new Error("anneau de moins de 3 sommets");
  return ringPositions(ring);
};

// Longitude, latitude seulement : les emprises BD TOPO sont en 3D (x, y, z).
const ringPositions = (ring: Pt[]) => Cartesian3.fromDegreesArray(ring.flatMap((p) => [p[0], p[1]]));

export interface FarmSceneOptions {
  /** Charge une tuile de relief (authentifiée) : grille 65 × 65, et sa source. */
  loadTerrainTile: (level: number, x: number, y: number) => Promise<{ heights: Float32Array; source: string }>;
  onTankClick: (tankId: string | null) => void;
  onGroundClick: (lonLat: Pt) => void;
  onTerrainFallback: () => void;
  onClockTick?: (iso: string) => void;
}

export class FarmScene {
  readonly viewer: Viewer;
  private planEntities: Entity[] = [];
  private trackEntities: Entity[] = [];
  private selectedTank: string | null = null;
  private plan: PlanData | null = null;
  private framed = false;
  /** Géométries ignorées au dernier affichage (invalides). */
  skipped = 0;
  private readonly handler: ScreenSpaceEventHandler;

  constructor(container: HTMLElement, private readonly opts: FarmSceneOptions) {
    this.viewer = new Viewer(container, {
      baseLayer: false,
      terrainProvider: new CustomHeightmapTerrainProvider({
        width: 65,
        height: 65,
        tilingScheme: new GeographicTilingScheme(),
        callback: (x, y, level) =>
          opts.loadTerrainTile(level, x, y).then(({ heights, source }) => {
            if (source === "fallback") opts.onTerrainFallback();
            return heights;
          }),
      }),
      geocoder: false,
      baseLayerPicker: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });
    this.viewer.imageryLayers.addImageryProvider(IGN_ORTHO);
    this.viewer.scene.globe.depthTestAgainstTerrain = true; // clic sur le relief, cuves masquées par les collines
    this.viewer.clock.onTick.addEventListener((clock) => opts.onClockTick?.(JulianDate.toIso8601(clock.currentTime, 0)));

    this.handler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => {
      const picked = this.viewer.scene.pick(e.position);
      const id = defined(picked) && picked.id instanceof Entity ? (picked.id.id as string) : null;
      if (id?.startsWith("tank:")) {
        opts.onTankClick(id.split(":")[1]!);
        return;
      }
      const position = this.viewer.scene.pickPosition(e.position);
      if (defined(position)) {
        const c = Cartographic.fromCartesian(position);
        opts.onGroundClick([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
      }
      opts.onTankClick(null);
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  /** Remplace le plan (parcelles, bâtiments, cuves) — appelé à chaque date de la frise. */
  setPlan(plan: PlanData) {
    this.plan = plan;
    for (const e of this.planEntities) this.viewer.entities.remove(e);
    this.planEntities = [];
    // Une géométrie invalide est ignorée (et comptée), jamais fatale à la vue.
    this.skipped = 0;
    const add = (e: Entity.ConstructorOptions) => {
      try {
        this.planEntities.push(this.viewer.entities.add(e));
      } catch (err) {
        this.skipped++;
        console.warn("Géométrie ignorée dans le plan 3D", e.id ?? e.name, err);
      }
    };
    // Construction protégée de bout en bout (calcul des positions compris).
    const safe = (make: () => Entity.ConstructorOptions) => {
      let options: Entity.ConstructorOptions;
      try {
        options = make();
      } catch (err) {
        this.skipped++;
        console.warn("Géométrie ignorée dans le plan 3D", err);
        return;
      }
      add(options);
    };

    for (const p of plan.parcels) {
      const ring = outerRing(p.shape);
      if (!ring) continue;
      safe(() => ({
        id: `parcel:${p.id}`,
        name: p.name,
        polygon: {
          hierarchy: safeRing(ring),
          material: (COLORS[(p.nature ?? "none") as keyof typeof COLORS] ?? COLORS.none).withAlpha(0.4),
          classificationType: ClassificationType.TERRAIN,
        },
      }));
    }
    for (const b of plan.context) {
      const ring = outerRing(b.footprint as GeoJsonGeometry);
      if (!ring) continue;
      safe(() => ({
        polygon: {
          hierarchy: safeRing(ring),
          height: 0,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          extrudedHeight: b.heightM,
          extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
          material: COLORS.context.withAlpha(0.85),
        },
      }));
    }
    for (const b of plan.buildings) {
      const ring = outerRing(b.footprint);
      if (!ring) continue;
      const room = b.kind === "room";
      safe(() => ({
        id: `building:${b.id}`,
        name: b.name,
        polygon: {
          hierarchy: safeRing(ring),
          height: 0,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          extrudedHeight: room ? 0.3 : b.heightM,
          extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
          // Translucide : on voit les cuves à l'intérieur.
          material: (room ? COLORS.room : COLORS.building).withAlpha(room ? 0.35 : 0.3),
        },
      }));
    }
    for (const t of plan.tanks) this.addTank(t, add);
    this.viewer.scene.requestRender();
    if (!this.framed && plan.extent) {
      const v = initialView(plan.extent);
      this.viewer.camera.setView({
        destination: Cartesian3.fromDegrees(v.lon, v.lat, v.altitude),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(v.pitchDeg), roll: 0 },
      });
      this.framed = true;
    }
  }

  private addTank(t: PlanData["tanks"][number], add: (e: Entity.ConstructorOptions) => void) {
    const selected = t.id === this.selectedTank;
    const liquid = Math.max(t.height * t.fill, 0);
    add({
      id: `tank:${t.id}`,
      name: t.name,
      position: Cartesian3.fromDegrees(t.lon, t.lat, t.height / 2),
      cylinder: {
        length: t.height,
        topRadius: t.radius,
        bottomRadius: t.radius,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        material: (selected ? COLORS.selected : COLORS.tankShell).withAlpha(selected ? 0.55 : 0.35),
        outline: true,
        outlineColor: selected ? COLORS.selected : Color.fromCssColorString("#8A948E"),
      },
    });
    // Étiquette au sommet de la cuve, visible seulement de près.
    add({
      id: `tank:${t.id}:label`,
      position: Cartesian3.fromDegrees(t.lon, t.lat, t.height + 0.3),
      label: {
        text: `${t.name} · ${Math.round(t.fill * 100)} %`,
        font: "600 12px 'IBM Plex Sans', sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString("#1E2421"),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 80),
        scaleByDistance: new NearFarScalar(10, 1.1, 80, 0.7),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    if (liquid > 0.02) {
      add({
        id: `tank:${t.id}:liquid`,
        position: Cartesian3.fromDegrees(t.lon, t.lat, liquid / 2),
        cylinder: {
          length: liquid,
          topRadius: t.radius * 0.97,
          bottomRadius: t.radius * 0.97,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          material: COLORS.wine.withAlpha(0.9),
        },
      });
    }
  }

  selectTank(id: string | null) {
    this.selectedTank = id;
    if (this.plan) this.setPlan(this.plan);
  }

  flyToTanks() {
    const tanks = this.planEntities.filter((e) => /^tank:[^:]+$/.test(String(e.id)));
    if (tanks.length) void this.viewer.flyTo(tanks, { duration: 1.2, offset: { heading: 0, pitch: CesiumMath.toRadians(-30), range: 25 } });
  }

  /**
   * Trace d'un matériel pour la journée : lignes drapées (travail / transport)
   * et point mobile posé sur le relief, animé par l'horloge Cesium.
   */
  async setTrack(samples: Sample[], label: string) {
    this.clearTrack();
    if (samples.length < 2) return;
    const add = (e: Entity.ConstructorOptions) => this.trackEntities.push(this.viewer.entities.add(e));
    for (const run of splitRuns(samples)) {
      add({
        polyline: {
          positions: Cartesian3.fromDegreesArray(run.coords.flat()),
          clampToGround: true,
          width: run.working ? 4 : 2,
          material: run.working ? COLORS.work : COLORS.transport.withAlpha(0.8),
        },
      });
    }
    // Altitudes du relief aux points de la trace (niveau 15 : ~5 m).
    const cartos = samples.map(([, lon, lat]) => Cartographic.fromDegrees(lon, lat));
    const grounded = await sampleTerrain(this.viewer.terrainProvider, 15, cartos).catch(() => cartos);
    const position = new SampledPositionProperty();
    samples.forEach(([t], i) => {
      const c = grounded[i]!;
      position.addSample(JulianDate.fromIso8601(t), Cartesian3.fromRadians(c.longitude, c.latitude, (c.height ?? 0) + 2));
    });
    const start = JulianDate.fromIso8601(samples[0]![0]);
    const stop = JulianDate.fromIso8601(samples.at(-1)![0]);
    add({
      id: "track:vehicle",
      name: label,
      availability: new TimeIntervalCollection([new TimeInterval({ start, stop })]),
      position,
      point: { pixelSize: 14, color: COLORS.work, outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: {
        text: label,
        font: "600 13px 'IBM Plex Sans', sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString("#1E2421"),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const clock = this.viewer.clock;
    clock.startTime = start.clone();
    clock.stopTime = stop.clone();
    clock.currentTime = start.clone();
    clock.clockRange = ClockRange.CLAMPED;
    clock.multiplier = 60;
    clock.shouldAnimate = false;
    // Cadrage sur l'emprise de la trace (incliné, face au nord).
    const lons = samples.map((s) => s[1]);
    const lats = samples.map((s) => s[2]);
    const v = initialView({ west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) });
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(v.lon, v.lat, v.altitude),
      orientation: { heading: 0, pitch: CesiumMath.toRadians(v.pitchDeg), roll: 0 },
      duration: 1.2,
    });
  }

  clearTrack() {
    for (const e of this.trackEntities) this.viewer.entities.remove(e);
    this.trackEntities = [];
    this.viewer.clock.shouldAnimate = false;
  }

  play(on: boolean, multiplier?: number) {
    if (multiplier) this.viewer.clock.multiplier = multiplier;
    this.viewer.clock.shouldAnimate = on;
  }

  destroy() {
    this.handler.destroy();
    this.viewer.destroy();
  }
}
