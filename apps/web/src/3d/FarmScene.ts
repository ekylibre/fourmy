import "./cesium-base";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  CallbackProperty,
  ConstantProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClassificationType,
  ClockRange,
  HeadingPitchRange,
  Matrix4,
  HeadingPitchRoll,
  Material,
  PolylineCollection,
  Quaternion,
  SampledProperty,
  Transforms,
  Axis,
  Color,
  ColorMaterialProperty,
  Model,
  PostProcessStage,
  ShadowMode,
  CustomHeightmapTerrainProvider,
  ImageryLayer,
  Rectangle,
  SingleTileImageryProvider,
  DistanceDisplayCondition,
  Entity,
  GeographicTilingScheme,
  HeightmapTerrainData,
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
  UrlTemplateImageryProvider,
  WebMapTileServiceImageryProvider,
  WebMercatorTilingScheme,
  sampleTerrain,
  defined,
} from "cesium";
import { outerRing, type Pt } from "@fourmy/domain";
import type { GeoJsonGeometry } from "@fourmy/contracts";
import { behind, cesiumHeading, densify, headings, initialView, runIndexes, splitRuns, type Sample } from "./geometry";
import { localFrame, rowPieces } from "@fourmy/domain";
import type { ParcelVegetation } from "@fourmy/contracts";
import { instancedBoxGlb, type BoxInstance } from "./vegetation-glb";
import { vegetationStyle } from "./vegetation";
import type { WeatherLook } from "./weather-look";

/** Pluie ou neige en post-traitement : traits (ou flocons) qui tombent devant la scène. */
const PRECIPITATION_GLSL = `
uniform sampler2D colorTexture;
uniform float u_time;
uniform float u_intensity;
uniform float u_snow;
in vec2 v_textureCoordinates;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  float cols = mix(110.0, 70.0, u_snow);
  float col = floor(uv.x * cols);
  float speed = mix(1.8, 0.22, u_snow) * (0.8 + 0.4 * hash(col));
  float phase = uv.y * mix(3.0, 2.0, u_snow) + u_time * speed + hash(col * 1.7);
  float y = fract(phase);
  float len = mix(0.07, 0.015, u_snow);
  float drop = smoothstep(0.0, len * 0.3, y) * (1.0 - smoothstep(len * 0.3, len, y));
  drop *= step(0.9 - 0.35 * u_intensity, hash(col * 3.7 + floor(phase)));
  float xw = abs(fract(uv.x * cols) - 0.5);
  drop *= 1.0 - smoothstep(mix(0.04, 0.18, u_snow), mix(0.1, 0.32, u_snow), xw);
  vec3 tint = mix(vec3(0.74, 0.79, 0.87), vec3(1.0), u_snow);
  out_FragColor = vec4(mix(color.rgb * (1.0 - 0.1 * u_intensity), tint, drop * mix(0.35, 0.85, u_snow)), color.a);
}`;

/** Avatar 3D d'un rejeu (lot M) : modèle, logo, outils attelés. */
export interface TrackAvatar {
  modelUrl?: string;
  logoUrl?: string;
  hitches?: { name: string; url: string; offsetM: number; from: string; to: string }[];
}

/** Échantillons par côté d'une tuile de relief (API /terrain/heightmap). */
const TERRAIN_SIZE = 65;
export const TERRAIN_TILE_BYTES = TERRAIN_SIZE * TERRAIN_SIZE * 4;
/**
 * Niveau le plus fin servi par l'API (au-delà : 400). Sans cette limite,
 * Cesium demande des niveaux toujours plus fins quand on zoome au plus près.
 * Plus loin, il agrandit la tuile de ce niveau (déjà interpolée au-delà de 16).
 */
export const TERRAIN_MAX_LEVEL = 22;

/** Relief sur mesure, plafonné à TERRAIN_MAX_LEVEL. */
class FarmTerrainProvider extends CustomHeightmapTerrainProvider {
  constructor(private readonly load: (x: number, y: number, level: number) => Promise<Float32Array>) {
    super({ width: TERRAIN_SIZE, height: TERRAIN_SIZE, tilingScheme: new GeographicTilingScheme(), callback: () => undefined });
  }
  override requestTileGeometry(x: number, y: number, level: number) {
    return this.load(x, y, level).then(
      (buffer) =>
        new HeightmapTerrainData({
          buffer,
          width: TERRAIN_SIZE,
          height: TERRAIN_SIZE,
          // Pas d'enfants au niveau maximal : Cesium agrandit cette tuile.
          childTileMask: level >= TERRAIN_MAX_LEVEL ? 0 : 15,
        }),
    );
  }
  override getTileDataAvailable(_x: number, _y: number, level: number) {
    return level <= TERRAIN_MAX_LEVEL;
  }
}

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

/**
 * Orthophotos IGN : par le relais de l'API quand on lui donne son modèle
 * d'URL (cache du serveur, « Ma ferme » F4 bis), sinon directement en WMTS.
 */
const ignOrtho = (template?: string) =>
  template
    ? new UrlTemplateImageryProvider({ url: template, tilingScheme: new WebMercatorTilingScheme(), maximumLevel: 19, credit: "© IGN — Géoplateforme" })
    : new WebMapTileServiceImageryProvider({
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
  /** Modèle d'URL des orthophotos ({z}/{x}/{y}) ; sans lui, l'IGN directement. */
  orthoTiles?: string;
  /** Charge une tuile de relief (authentifiée) : grille 65 × 65, et sa source. */
  loadTerrainTile: (level: number, x: number, y: number) => Promise<{ heights: Float32Array; source: string }>;
  onTankClick: (tankId: string | null) => void;
  onGroundClick: (lonLat: Pt) => void;
  onTerrainFallback: () => void;
  onClockTick?: (iso: string) => void;
  /** Erreur de rendu (Cesium s'arrête) : affichée par la page, en français, à la place du dialogue de Cesium. */
  onRenderError?: (error: unknown) => void;
}

/** Caméra du rejeu d'une trace. */
export type TrackCamera = "overview" | "drone" | "follow";

export class FarmScene {
  readonly viewer: Viewer;
  private planEntities: Entity[] = [];
  private trackEntities: Entity[] = [];
  private fleetEntities: Entity[] = [];
  private trackLines: PolylineCollection | null = null;
  /** Cap boussole (degrés) du matériel le long de la trace, pour la caméra qui le suit. */
  private trackHeading: SampledProperty | null = null;
  private cameraMode: TrackCamera = "overview";
  /** Vue d'ensemble de la trace chargée. */
  private trackView: (() => void) | null = null;
  /** Vue drone : centre et taille de la zone travaillée, début du rejeu. */
  private droneFrame: { center: Cartesian3; size: number; start: JulianDate } | null = null;
  private readonly followRange = 25;
  private selectedTank: string | null = null;
  private plan: PlanData | null = null;
  private framed = false;
  /** Image satellite drapée (télédétection) et style des parcelles (teinte NDVI, opacité). */
  private satLayer: ImageryLayer | null = null;
  private satKey: string | null = null;
  private parcelTint: Map<string, string> | null = null;
  private parcelAlpha = 0.4;
  /** Végétation (un modèle instancié par parcelle) et météo du jour (lot AA). */
  private vegModels: Model[] = [];
  private vegUrls: string[] = [];
  private vegKey = "";
  private vegGeneration = 0;
  private precipitation: PostProcessStage | null = null;
  private ortho: ImageryLayer | null = null;
  private defaultFog = 2e-4;
  /** Géométries ignorées au dernier affichage (invalides). */
  skipped = 0;
  private readonly handler: ScreenSpaceEventHandler;

  constructor(container: HTMLElement, private readonly opts: FarmSceneOptions) {
    this.viewer = new Viewer(container, {
      baseLayer: false,
      terrainProvider: new FarmTerrainProvider((x, y, level) =>
        opts.loadTerrainTile(level, x, y).then(({ heights, source }) => {
          if (source === "fallback") opts.onTerrainFallback();
          return heights;
        }),
      ),
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
      showRenderLoopErrors: false,
    });
    this.viewer.scene.renderError.addEventListener((_scene, error) => {
      console.error("[vue 3D]", error);
      opts.onRenderError?.(error);
    });
    this.ortho = this.viewer.imageryLayers.addImageryProvider(ignOrtho(opts.orthoTiles));
    this.defaultFog = this.viewer.scene.fog.density;
    this.viewer.scene.globe.depthTestAgainstTerrain = true; // clic sur le relief, cuves masquées par les collines
    this.viewer.clock.onTick.addEventListener((clock) => {
      opts.onClockTick?.(JulianDate.toIso8601(clock.currentTime, 0));
      this.cameraTick();
    });

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
    // La végétation dépend des formes du plan : à reconstruire au prochain setVegetation.
    this.vegKey = "";
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
          material: this.parcelColor(p),
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

  private parcelColor(p: PlanData["parcels"][number]): Color {
    const tint = this.parcelTint?.get(p.id);
    const base = tint ? Color.fromCssColorString(tint) : (COLORS[(p.nature ?? "none") as keyof typeof COLORS] ?? COLORS.none);
    return base.withAlpha(this.parcelAlpha);
  }

  /**
   * Teinte des parcelles (NDVI par parcelle) et opacité (faible sous une image
   * satellite). Met à jour les parcelles affichées sans reconstruire le plan.
   */
  setParcelStyle(tint: Map<string, string> | null, alpha: number) {
    this.parcelTint = tint;
    this.parcelAlpha = alpha;
    if (!this.plan) return;
    const byId = new Map(this.plan.parcels.map((p) => [`parcel:${p.id}`, p]));
    for (const e of this.planEntities) {
      const p = byId.get(String(e.id));
      if (p && e.polygon) e.polygon.material = new ColorMaterialProperty(this.parcelColor(p));
    }
  }

  /**
   * Image satellite (PNG transparent hors parcelles) drapée sur le relief,
   * au-dessus de l'orthophoto. `null` la retire.
   */
  async setSatellite(img: { href: string; bbox: [number, number, number, number] } | null) {
    const key = img?.href ?? null;
    if (key === this.satKey) return;
    this.satKey = key;
    if (this.satLayer) {
      this.viewer.imageryLayers.remove(this.satLayer, true);
      this.satLayer = null;
    }
    if (!img) return;
    const [w, s, e, n] = img.bbox;
    const provider = await SingleTileImageryProvider.fromUrl(img.href, { rectangle: Rectangle.fromDegrees(w, s, e, n), credit: "Copernicus Sentinel-2" });
    // Une autre image a pu être demandée pendant le chargement.
    if (this.satKey !== key || this.viewer.isDestroyed()) return;
    this.satLayer = this.viewer.imageryLayers.addImageryProvider(provider);
  }

  /**
   * Végétation du plan 3D (lot AA) : un glTF instancié par parcelle, un pavé
   * par tronçon de rang (≤ 15 m, pour suivre le relief), posé sur le relief,
   * hauteur et couleur selon l'état observé. `null` la retire.
   */
  async setVegetation(items: ParcelVegetation[] | null, frost = false): Promise<{ parcels: number; instances: number }> {
    const key = items ? JSON.stringify([frost, items.map((i) => [i.parcelId, i.rows, i.canopy])]) : "";
    if (key === this.vegKey) return { parcels: this.vegModels.length, instances: 0 };
    this.vegKey = key;
    const generation = ++this.vegGeneration;
    for (const m of this.vegModels) this.viewer.scene.primitives.remove(m);
    this.vegModels = [];
    for (const u of this.vegUrls) URL.revokeObjectURL(u);
    this.vegUrls = [];
    if (!items || !this.plan) return { parcels: 0, instances: 0 };
    const shapes = new Map(this.plan.parcels.map((p) => [p.id, p.shape]));
    let instances = 0;
    for (const item of items) {
      const style = vegetationStyle(item, frost);
      const shape = shapes.get(item.parcelId) as { type: string; coordinates?: unknown } | undefined;
      if (!style || !shape) continue;
      const polygons = (shape.type === "MultiPolygon" ? shape.coordinates : shape.type === "Polygon" ? [shape.coordinates] : []) as [number, number][][][];
      const outer = polygons[0]?.[0];
      if (!outer?.length) continue;
      const lon0 = outer.reduce((a, p) => a + p[0], 0) / outer.length;
      const lat0 = outer.reduce((a, p) => a + p[1], 0) / outer.length;
      const frame = localFrame(lon0, lat0);
      const rings = polygons.flat().map((ring) => ring.map(([lon, lat]) => frame.toLocal(lon, lat)));
      let spacing = style.spacingM;
      let pieces = rowPieces(rings, { bearingDeg: item.rows.bearingDeg, spacingM: spacing, insetM: 1, maxPieceM: 15, limit: 30_000 });
      // Très grande parcelle : on espace les rangs dessinés plutôt que de saturer la carte graphique.
      while (pieces === null) {
        spacing *= 2;
        pieces = rowPieces(rings, { bearingDeg: item.rows.bearingDeg, spacingM: spacing, insetM: 1, maxPieceM: 15, limit: 30_000 });
      }
      if (pieces.length === 0) continue;
      // Altitude aux deux bouts de chaque tronçon : il s'incline avec la pente au lieu de faire des marches.
      const b = CesiumMath.toRadians(item.rows.bearingDeg);
      const [dx, dy] = [Math.sin(b), Math.cos(b)];
      const ends = pieces.flatMap((p) => [
        Cartographic.fromDegrees(...frame.toLonLat(p.x - (dx * p.length) / 2, p.y - (dy * p.length) / 2)),
        Cartographic.fromDegrees(...frame.toLonLat(p.x + (dx * p.length) / 2, p.y + (dy * p.length) / 2)),
      ]);
      const cartos = [Cartographic.fromDegrees(lon0, lat0), ...ends];
      const grounded = await sampleTerrain(this.viewer.terrainProvider, 15, cartos).catch(() => cartos);
      if (generation !== this.vegGeneration || this.viewer.isDestroyed()) return { parcels: 0, instances: 0 };
      const h0 = grounded[0]!.height || 0;
      const yaw = CesiumMath.toRadians(90 - item.rows.bearingDeg);
      const widthM = Math.min(style.widthM * (spacing / style.spacingM), spacing * 0.95);
      const boxes: BoxInstance[] = pieces.map((p, i) => {
        const za = grounded[1 + 2 * i]!.height || h0;
        const zb = grounded[2 + 2 * i]!.height || h0;
        return {
          x: p.x,
          y: p.y,
          z: (za + zb) / 2 - h0 + style.baseM,
          yaw,
          pitch: Math.atan2(zb - za, p.length),
          length: p.length,
          width: widthM,
          height: style.heightM,
        };
      });
      // Model.fromGltfAsync veut une adresse : le glTF généré passe par une URL de blob, libérée avec le modèle.
      const url = URL.createObjectURL(new Blob([instancedBoxGlb(boxes) as BlobPart], { type: "model/gltf-binary" }));
      this.vegUrls.push(url);
      const model = await Model.fromGltfAsync({
        url,
        modelMatrix: Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon0, lat0, h0)),
        upAxis: Axis.Z,
        forwardAxis: Axis.X,
        color: Color.fromCssColorString(style.color),
        shadows: ShadowMode.DISABLED,
        id: `vegetation:${item.parcelId}`,
      });
      if (generation !== this.vegGeneration || this.viewer.isDestroyed()) {
        model.destroy();
        return { parcels: 0, instances: 0 };
      }
      this.viewer.scene.primitives.add(model);
      this.vegModels.push(model);
      instances += boxes.length;
    }
    return { parcels: this.vegModels.length, instances };
  }

  /** Ambiance du jour (FR-TWIN-4) : ciel, brume, pluie ou neige, sol mouillé. `null` : ciel neutre. */
  setWeather(look: WeatherLook | null) {
    const scene = this.viewer.scene;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.brightnessShift = look?.brightness ?? 0;
      scene.skyAtmosphere.saturationShift = look?.saturation ?? 0;
    }
    scene.atmosphere.brightnessShift = (look?.brightness ?? 0) * 0.6;
    scene.atmosphere.saturationShift = (look?.saturation ?? 0) * 0.6;
    scene.fog.density = look?.fogDensity ?? this.defaultFog;
    if (this.ortho) {
      // Sol mouillé : photographie aérienne assombrie, plus contrastée.
      this.ortho.brightness = look?.wetSoil ? 0.78 : look && look.brightness < -0.2 ? 0.9 : 1;
      this.ortho.contrast = look?.wetSoil ? 1.12 : 1;
      this.ortho.saturation = look ? 1 + look.saturation * 0.4 : 1;
    }
    if (this.precipitation) {
      scene.postProcessStages.remove(this.precipitation);
      this.precipitation = null;
    }
    if (look && (look.rain > 0 || look.snow)) {
      const start = performance.now();
      const stage = new PostProcessStage({
        fragmentShader: PRECIPITATION_GLSL,
        uniforms: { u_time: () => (performance.now() - start) / 1000, u_intensity: look.snow ? 0.6 : look.rain, u_snow: look.snow ? 1 : 0 },
      });
      scene.postProcessStages.add(stage);
      this.precipitation = stage;
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
  async setTrack(simplified: Sample[], label: string, avatar: TrackAvatar = {}) {
    this.clearTrack();
    if (simplified.length < 2) return;
    const samples = densify(simplified);
    const add = (e: Entity.ConstructorOptions) => this.trackEntities.push(this.viewer.entities.add(e));
    // Altitudes du relief aux points de la trace (niveau 15 : ~5 m).
    const cartos = samples.map(([, lon, lat]) => Cartographic.fromDegrees(lon, lat));
    const grounded = await sampleTerrain(this.viewer.terrainProvider, 15, cartos).catch(() => cartos);
    // Tracé posé sur ces altitudes (+0,5 m), dans une collection de lignes :
    // ni lignes « drapées » (clampToGround), ni worker de géométrie. Le worker
    // createGroundPolylineGeometry échouait sous certains Firefox avec carte
    // graphique (« d is not a function »), et Cesium arrêtait alors le rendu.
    const heightAt = new Map(samples.map(([, lon, lat], i) => [`${lon},${lat}`, grounded[i]?.height ?? 0]));
    // Toute la journée en trait léger ; le rejeu repasse en couleur ce qui est fait.
    const lines = new PolylineCollection();
    for (const run of splitRuns(samples)) {
      lines.add({
        positions: run.coords.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, (heightAt.get(`${lon},${lat}`) ?? 0) + 0.5)),
        width: run.working ? 3 : 2,
        material: Material.fromType("Color", { color: (run.working ? COLORS.work : COLORS.transport).withAlpha(0.15) }),
      });
    }
    this.trackLines = this.viewer.scene.primitives.add(lines);
    const times = samples.map((x) => Date.parse(x[0]));
    const points = samples.map(([, lon, lat], i) => Cartesian3.fromDegrees(lon, lat, (grounded[i]?.height ?? 0) + 0.6));
    for (const run of runIndexes(samples)) {
      const done = new CallbackProperty((time) => {
        const now = time ? JulianDate.toDate(time).getTime() : 0;
        if (now <= times[run.from]!) return [];
        let k = run.from;
        while (k < run.to && times[k + 1]! <= now) k++;
        const head = points.slice(run.from, k + 1);
        if (k < run.to) {
          const f = (now - times[k]!) / (times[k + 1]! - times[k]! || 1);
          head.push(Cartesian3.lerp(points[k]!, points[k + 1]!, f, new Cartesian3()));
        }
        return head;
      }, false);
      add({
        id: `track:done:${run.from}`,
        polyline: { positions: done, width: run.working ? 4 : 2, material: run.working ? COLORS.work : COLORS.transport.withAlpha(0.8) },
      });
    }
    // Avatar posé sur le relief (sinon point surélevé), orienté selon le cap.
    const lift = avatar.modelUrl ? 0 : 2;
    const position = new SampledPositionProperty();
    const orientation = new SampledProperty(Quaternion);
    const caps = headings(samples);
    this.trackHeading = new SampledProperty(Number);
    samples.forEach(([t], i) => {
      const c = grounded[i]!;
      const when = JulianDate.fromIso8601(t);
      const at = Cartesian3.fromRadians(c.longitude, c.latitude, (c.height ?? 0) + lift);
      position.addSample(when, at);
      orientation.addSample(when, Transforms.headingPitchRollQuaternion(at, new HeadingPitchRoll(cesiumHeading(caps[i]!), 0, 0)));
      this.trackHeading!.addSample(when, caps[i]!);
    });
    const start = JulianDate.fromIso8601(samples[0]![0]);
    const stop = JulianDate.fromIso8601(samples.at(-1)![0]);
    // Outils attelés (interventions) : même trace, reculée de la distance d'attelage le long du cap.
    for (const h of avatar.hitches ?? []) {
      const from = JulianDate.fromIso8601(h.from);
      const to = JulianDate.fromIso8601(h.to);
      const toolPos = new SampledPositionProperty();
      samples.forEach(([t, lon, lat], i) => {
        const [blon, blat] = behind(lon, lat, caps[i]!, h.offsetM);
        toolPos.addSample(JulianDate.fromIso8601(t), Cartesian3.fromDegrees(blon, blat, grounded[i]!.height ?? 0));
      });
      add({
        id: `track:tool:${h.from}`,
        name: h.name,
        availability: new TimeIntervalCollection([new TimeInterval({ start: JulianDate.greaterThan(from, start) ? from : start, stop: JulianDate.lessThan(to, stop) ? to : stop })]),
        position: toolPos,
        orientation,
        model: { uri: h.url, minimumPixelSize: this.cameraMode === "drone" ? 0 : 32, maximumScale: 20, heightReference: HeightReference.CLAMP_TO_GROUND },
      });
    }
    add({
      id: "track:vehicle",
      name: label,
      availability: new TimeIntervalCollection([new TimeInterval({ start, stop })]),
      position,
      ...(avatar.modelUrl
        ? {
            orientation,
            model: { uri: avatar.modelUrl, minimumPixelSize: this.cameraMode === "drone" ? 0 : 48, maximumScale: 20, heightReference: HeightReference.CLAMP_TO_GROUND },
            billboard: avatar.logoUrl
              ? {
                  image: avatar.logoUrl,
                  height: 22,
                  width: 66,
                  verticalOrigin: VerticalOrigin.BOTTOM,
                  pixelOffset: new Cartesian2(0, -40),
                  distanceDisplayCondition: new DistanceDisplayCondition(0, 2000),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }
              : undefined,
          }
        : { point: { pixelSize: 14, color: COLORS.work, outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY } }),
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
    // Vue drone : la zone travaillée (sans le trajet sur route), à son altitude.
    const worked = splitRuns(samples).filter((r) => r.working).flatMap((r) => r.coords);
    const zone = worked.length > 1 ? worked : samples.map((x) => [x[1], x[2]] as [number, number]);
    const [w, e, so, n] = [Math.min(...zone.map((c) => c[0])), Math.max(...zone.map((c) => c[0])), Math.min(...zone.map((c) => c[1])), Math.max(...zone.map((c) => c[1]))];
    const midLat = (so + n) / 2;
    const ground = grounded.reduce((a, c) => a + (c.height ?? 0), 0) / grounded.length;
    this.droneFrame = {
      center: Cartesian3.fromDegrees((w + e) / 2, midLat, ground),
      size: Math.max((e - w) * 111_320 * Math.cos((midLat * Math.PI) / 180), (n - so) * 111_320, 80),
      start: start.clone(),
    };
    this.trackView = () =>
      this.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(v.lon, v.lat, v.altitude),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(v.pitchDeg), roll: 0 },
        duration: 1.2,
      });
    if (this.cameraMode === "overview") this.trackView();
    else this.cameraTick();
  }

  /** Tous les matériels suivis à leur dernière position connue (FR-MAT-86). */
  setFleet(items: { id: string; name: string; lon: number; lat: number; heading: number | null; modelUrl: string }[]) {
    for (const e of this.fleetEntities) this.viewer.entities.remove(e);
    this.fleetEntities = [];
    for (const f of items) {
      const at = Cartesian3.fromDegrees(f.lon, f.lat, 0);
      this.fleetEntities.push(
        this.viewer.entities.add({
          id: `fleet:${f.id}`,
          name: f.name,
          position: at,
          orientation: Transforms.headingPitchRollQuaternion(at, new HeadingPitchRoll(cesiumHeading(f.heading ?? 0), 0, 0)),
          model: { uri: f.modelUrl, minimumPixelSize: 40, maximumScale: 20, heightReference: HeightReference.CLAMP_TO_GROUND },
          label: {
            text: f.name,
            font: "600 12px 'IBM Plex Sans', sans-serif",
            fillColor: Color.WHITE,
            outlineColor: Color.fromCssColorString("#1E2421"),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cartesian2(0, -36),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 5000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
  }

  /**
   * Caméra du rejeu : vue d'ensemble de la trace (libre), drone qui tourne
   * lentement au-dessus de la zone travaillée, ou derrière le matériel.
   */
  setCamera(mode: TrackCamera) {
    const was = this.cameraMode;
    this.cameraMode = mode;
    // Vue drone : l'avatar à sa taille réelle, à l'échelle de la parcelle.
    for (const e of this.trackEntities) {
      if (e.model) e.model.minimumPixelSize = new ConstantProperty(mode === "drone" ? 0 : e.id === "track:vehicle" ? 48 : 32);
    }
    if (mode === "overview") {
      if (was !== "overview") this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      this.trackView?.();
    } else {
      this.viewer.camera.cancelFlight();
      this.cameraTick();
    }
  }

  /**
   * Caméra derrière le matériel, tournée dans son cap (le suivi intégré de
   * Cesium attend le volume englobant du modèle, jamais disponible pour un
   * modèle posé sur le relief) ; ou drone en plongée à 45°, qui tourne d'un
   * degré toutes les deux minutes de rejeu autour de la parcelle entière.
   */
  private cameraTick() {
    const time = this.viewer.clock.currentTime;
    if (this.cameraMode === "drone" && this.droneFrame) {
      const { center, size, start } = this.droneFrame;
      const minutes = JulianDate.secondsDifference(time, start) / 60;
      const heading = CesiumMath.toRadians(200 + minutes * 0.5);
      this.viewer.camera.lookAt(center, new HeadingPitchRange(heading, CesiumMath.toRadians(-45), size * 1.25));
      return;
    }
    if (this.cameraMode !== "follow" || !this.trackHeading) return;
    const vehicle = this.viewer.entities.getById("track:vehicle");
    const at = vehicle?.position?.getValue(time);
    if (!at) return;
    const cap = this.trackHeading.getValue(time) as number | undefined;
    this.viewer.camera.lookAt(at, new HeadingPitchRange(CesiumMath.toRadians(cap ?? 0), CesiumMath.toRadians(-22), this.followRange));
  }

  clearTrack() {
    if (this.cameraMode !== "overview") this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.trackHeading = null;
    this.droneFrame = null;
    for (const e of this.trackEntities) this.viewer.entities.remove(e);
    this.trackEntities = [];
    if (this.trackLines) this.viewer.scene.primitives.remove(this.trackLines);
    this.trackLines = null;
    this.viewer.clock.shouldAnimate = false;
  }

  /** Rejeu : se place à un instant (barre de temps). */
  seek(iso: string) {
    this.viewer.clock.currentTime = JulianDate.fromIso8601(iso);
    this.cameraTick();
  }

  play(on: boolean, multiplier?: number) {
    if (multiplier) this.viewer.clock.multiplier = multiplier;
    this.viewer.clock.shouldAnimate = on;
  }

  destroy() {
    this.vegGeneration++;
    for (const u of this.vegUrls) URL.revokeObjectURL(u);
    this.handler.destroy();
    this.viewer.destroy();
  }
}
