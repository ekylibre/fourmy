import type { Map as MlMap, GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type HexColor,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { areaM2, CartoError, measure, mergeAreas, splitArea, validateArea, type Measure } from "@fourmy/carto";

/**
 * Éditeur carto commun (exigence CARTO-1), indépendant de React et de
 * l'écran : il se branche sur n'importe quelle carte MapLibre et édite une
 * collection de surfaces. Outils : modifier (déplacer, sommets),
 * dessiner, découper, fusionner, mesurer ; annuler. Les opérations
 * géométriques viennent de @fourmy/carto (pures, testées) ; terra-draw ne
 * sert qu'au dessin et aux poignées.
 */

export type CartoTool = "select" | "draw" | "cut" | "merge" | "measure-line" | "measure-area";

export interface CartoEditorEvents {
  /** Les surfaces ont changé (dessin, déplacement, découpe, fusion, suppression, annulation). */
  onChange?: (features: Feature<Polygon>[]) => void;
  /** Surfaces sélectionnées (identifiants). */
  onSelection?: (ids: string[]) => void;
  /** Mesure en cours (outil mesure) ou de la sélection ; null sinon. */
  onMeasure?: (m: Measure | null) => void;
  /** Opération refusée : message pour l'utilisateur. */
  onError?: (message: string) => void;
}

// Contrastes pensés pour la photo aérienne (champs verts et bruns).
const COLORS = {
  shape: "#FFF8E7" as HexColor,
  cut: "#C0392B" as HexColor,
  measure: "#4FC3F7" as HexColor,
};
const SELECTION_SOURCE = "carto-selection";

type StoreFeature = GeoJSONStoreFeatures;

export class CartoEditor {
  private readonly draw: TerraDraw;
  private tool: CartoTool = "select";
  private selected = new Set<string>();
  /** Propriétés métier des surfaces (identifiant de parcelle, nom…), hors terra-draw. */
  private readonly props = new Map<string, Record<string, unknown>>();
  private history: Feature<Polygon>[][] = [];
  private last: Feature<Polygon>[] = [];
  private readonly onClick = (e: MapMouseEvent) => this.handleClick(e);

  constructor(
    private readonly map: MlMap,
    private readonly events: CartoEditorEvents = {},
  ) {
    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPolygonMode({
          styles: { fillColor: COLORS.shape, outlineColor: COLORS.shape, fillOpacity: 0.12, outlineWidth: 2.5, closingPointColor: COLORS.shape },
        }),
        new TerraDrawSelectMode({
          flags: {
            polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
          },
          styles: {
            selectedPolygonColor: "#E8B500" as HexColor,
            selectedPolygonOutlineColor: "#E8B500" as HexColor,
            selectedPolygonFillOpacity: 0.25,
            selectedPolygonOutlineWidth: 3,
          },
        }),
        new TerraDrawLineStringMode({ modeName: "cut", styles: { lineStringColor: COLORS.cut, lineStringWidth: 3 } }),
        new TerraDrawLineStringMode({ modeName: "measure-line", styles: { lineStringColor: COLORS.measure, lineStringWidth: 3 } }),
        new TerraDrawPolygonMode({
          modeName: "measure-area",
          styles: { fillColor: COLORS.measure, outlineColor: COLORS.measure, fillOpacity: 0.15, outlineWidth: 2 },
        }),
      ],
    });
    this.draw.start();
    this.draw.on("finish", (id, ctx) => this.handleFinish(String(id), ctx.mode, ctx.action));
    this.draw.on("change", (ids) => this.handleChange(ids.map(String)));
    this.draw.on("select", (id) => this.setSelection([String(id)]));
    this.draw.on("deselect", () => this.tool === "select" && this.setSelection([]));
    map.addSource(SELECTION_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: SELECTION_SOURCE, type: "line", source: SELECTION_SOURCE, paint: { "line-color": "#E8B500", "line-width": 4 } });
    map.on("click", this.onClick);
    this.setTool("select");
  }

  /** Remplace les surfaces éditées (ex. parcelles à la date). */
  load(features: Feature<Polygon>[]): void {
    this.draw.clear();
    this.props.clear();
    const { rejected } = this.add(features);
    if (rejected.length) {
      const names = rejected.map((f) => String(f.properties?.name ?? f.id)).join(", ");
      this.events.onError?.(`Surface(s) non modifiables avec ces outils (trou ou contour invalide) : ${names}.`);
    }
    this.history = [];
    this.last = this.features();
    this.setSelection([]);
  }

  /** Surfaces éditées, avec leurs propriétés métier. */
  features(): Feature<Polygon>[] {
    return this.draw
      .getSnapshot()
      .filter((f) => f.properties.mode === "polygon" && f.geometry.type === "Polygon")
      .map((f) => ({
        type: "Feature",
        id: String(f.id),
        properties: { ...(this.props.get(String(f.id)) ?? {}) },
        geometry: f.geometry as Polygon,
      }));
  }

  getTool(): CartoTool {
    return this.tool;
  }

  setTool(tool: CartoTool): void {
    this.clearTemporary();
    this.tool = tool;
    const mode = { select: "select", draw: "polygon", cut: "cut", merge: "static", "measure-line": "measure-line", "measure-area": "measure-area" }[tool];
    this.draw.setMode(mode);
    // La sélection est gardée pour découper ou fusionner ; ailleurs, on repart de rien.
    if (tool !== "merge" && tool !== "cut") this.setSelection([]);
    this.events.onMeasure?.(this.selectionMeasure());
  }

  /** Sélectionne des surfaces depuis l'extérieur (liste, écran) ; en modification, avec les poignées. */
  select(ids: string[]): void {
    if (this.tool === "select" && ids.length === 1) {
      for (const id of this.selected) if (id !== ids[0]) this.draw.deselectFeature(id);
      this.draw.selectFeature(ids[0]!);
    }
    this.setSelection(ids);
  }

  /** Fusionne les surfaces sélectionnées (au moins deux, qui se touchent). */
  mergeSelected(): void {
    const chosen = this.features().filter((f) => this.selected.has(String(f.id)));
    this.attempt(() => {
      const merged = mergeAreas(chosen.map((f) => f.geometry));
      const keep = chosen[0]!;
      this.commit(() => {
        const ids = this.replace(chosen, [{ type: "Feature", properties: { ...(keep.properties ?? {}) }, geometry: merged }]);
        this.setSelection(ids ?? []);
      });
    });
  }

  /** Supprime les surfaces sélectionnées. */
  deleteSelected(): void {
    if (this.selected.size === 0) return;
    const ids = [...this.selected];
    this.commit(() => {
      this.draw.removeFeatures(ids);
      ids.forEach((id) => this.props.delete(id));
      this.setSelection([]);
    });
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Revient à l'état précédent la dernière opération. */
  undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.draw.clear();
    this.props.clear();
    this.add(previous);
    this.last = this.features();
    this.setSelection([]);
    this.events.onChange?.(this.last);
  }

  destroy(): void {
    this.map.off("click", this.onClick);
    this.draw.stop();
    if (this.map.getLayer(SELECTION_SOURCE)) this.map.removeLayer(SELECTION_SOURCE);
    if (this.map.getSource(SELECTION_SOURCE)) this.map.removeSource(SELECTION_SOURCE);
  }

  // --- interne ----------------------------------------------------------------

  /**
   * Ajoute des surfaces à terra-draw. Renvoie les identifiants acceptés et
   * les surfaces refusées (terra-draw n'accepte ni trou ni contour invalide).
   */
  private add(features: Feature<Polygon>[]): { ids: string[]; rejected: Feature<Polygon>[] } {
    const store = features.map(
      (f) =>
        ({
          type: "Feature",
          id: typeof f.id === "string" ? f.id : crypto.randomUUID(),
          geometry: normalize(f.geometry),
          properties: { mode: "polygon" },
        }) as StoreFeature,
    );
    const results = this.draw.addFeatures(store);
    const ids: string[] = [];
    const rejected: Feature<Polygon>[] = [];
    results.forEach((r, i) => {
      if (!r.valid) {
        rejected.push(features[i]!);
        return;
      }
      const id = String(r.id);
      ids.push(id);
      this.props.set(id, { ...(features[i]!.properties ?? {}) });
    });
    return { ids, rejected };
  }

  /**
   * Remplace des surfaces par d'autres, tout ou rien : les nouvelles sont
   * ajoutées et vérifiées AVANT de retirer les anciennes. Un refus ne perd
   * aucune surface.
   */
  private replace(removed: Feature<Polygon>[], added: Feature<Polygon>[]): string[] | null {
    const { ids, rejected } = this.add(added);
    if (rejected.length) {
      this.draw.removeFeatures(ids);
      ids.forEach((id) => this.props.delete(id));
      this.events.onError?.("Le résultat n'est pas une surface éditable (trou ou contour invalide) : opération annulée.");
      return null;
    }
    this.draw.removeFeatures(removed.map((f) => String(f.id)));
    removed.forEach((f) => this.props.delete(String(f.id)));
    return ids;
  }

  /** Exécute une opération qui modifie les surfaces : historique, puis notification. */
  private commit(change: () => void): void {
    const before = this.last;
    change();
    const after = this.features();
    if (JSON.stringify(after) === JSON.stringify(before)) return; // opération refusée : rien à annuler
    this.history.push(before);
    this.last = after;
    this.events.onChange?.(this.last);
  }

  private attempt(op: () => void): void {
    try {
      op();
    } catch (e) {
      this.events.onError?.(e instanceof CartoError ? e.message : "Opération impossible sur cette géométrie.");
    }
  }

  private setSelection(ids: string[]): void {
    this.selected = new Set(ids);
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: this.features().filter((f) => this.selected.has(String(f.id))),
    };
    (this.map.getSource(SELECTION_SOURCE) as GeoJSONSource | undefined)?.setData(fc);
    this.events.onSelection?.(ids);
    this.events.onMeasure?.(this.selectionMeasure());
  }

  private selectionMeasure(): Measure | null {
    const chosen = this.features().filter((f) => this.selected.has(String(f.id)));
    if (chosen.length === 0) return null;
    if (chosen.length === 1) return measure(chosen[0]!.geometry);
    return { areaM2: chosen.reduce((t, f) => t + areaM2(f.geometry), 0) };
  }

  /** Outil fusion (et choix de la surface à découper) : un clic ajoute ou retire une surface. */
  private handleClick(e: MapMouseEvent): void {
    if (this.tool !== "merge") return;
    const hit = this.draw
      .getFeaturesAtLngLat({ lng: e.lngLat.lng, lat: e.lngLat.lat }, { ignoreSelectFeatures: true })
      .find((f) => f.properties.mode === "polygon");
    if (!hit) return;
    const id = String(hit.id);
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.setSelection([...next]);
  }

  private handleChange(ids: string[]): void {
    if (this.tool !== "measure-line" && this.tool !== "measure-area") return;
    const f = ids.map((id) => this.draw.getSnapshotFeature(id)).find((x) => x && x.properties.mode === this.tool);
    if (!f) return;
    try {
      this.events.onMeasure?.(measure(f.geometry as Polygon | LineString));
    } catch {
      // Géométrie en cours de tracé (pas encore mesurable).
    }
  }

  private handleFinish(id: string, mode: string, action: string): void {
    if (mode === "polygon" && action === "draw") {
      const f = this.draw.getSnapshotFeature(id);
      const problems = f ? validateArea(f.geometry as Polygon) : ["Surface introuvable."];
      if (problems.length) {
        this.draw.removeFeatures([id]);
        this.events.onError?.(problems.join(" "));
        return;
      }
      this.history.push(this.last);
      this.last = this.features();
      this.events.onChange?.(this.last);
      return;
    }
    if (mode === "select" && action !== "draw") {
      const f = this.draw.getSnapshotFeature(id);
      const problems = f && f.geometry.type === "Polygon" ? validateArea(f.geometry as Polygon) : [];
      if (problems.length) {
        // Retour à la forme d'avant : pas de contour invalide enregistré.
        this.events.onError?.(problems.join(" "));
        const before = this.last.find((x) => x.id === id);
        if (before) this.draw.updateFeatureGeometry(id, before.geometry);
        return;
      }
      this.history.push(this.last);
      this.last = this.features();
      this.events.onChange?.(this.last);
      this.events.onMeasure?.(this.selectionMeasure());
      return;
    }
    if (mode === "cut") {
      const line = this.draw.getSnapshotFeature(id)?.geometry as LineString | undefined;
      this.draw.removeFeatures([id]);
      if (!line) return;
      this.cutWith(line);
    }
  }

  /** Découpe la surface sélectionnée, sinon celles que la ligne traverse de part en part. */
  private cutWith(line: LineString): void {
    const all = this.features();
    const targets = this.selected.size ? all.filter((f) => this.selected.has(String(f.id))) : all;
    const results: { source: Feature<Polygon>; pieces: Polygon[] }[] = [];
    let lastError: string | null = null;
    for (const f of targets) {
      try {
        results.push({ source: f, pieces: splitArea(f.geometry, line) });
      } catch (e) {
        lastError = e instanceof CartoError ? e.message : "Découpe impossible.";
      }
    }
    if (results.length === 0) {
      this.events.onError?.(this.selected.size ? (lastError ?? "Découpe impossible.") : "La ligne ne traverse aucune surface de part en part.");
      return;
    }
    this.commit(() => {
      const created: string[] = [];
      for (const { source, pieces } of results) {
        const ids = this.replace([source], pieces.map((geometry) => ({ type: "Feature", properties: { ...(source.properties ?? {}) }, geometry })));
        if (ids) created.push(...ids);
      }
      this.setSelection(created);
    });
  }

  /** Les tracés de mesure ne sont pas des surfaces : retirés en changeant d'outil. */
  private clearTemporary(): void {
    const temp = this.draw
      .getSnapshot()
      .filter((f) => f.properties.mode !== "polygon")
      .map((f) => String(f.id));
    if (temp.length) this.draw.removeFeatures(temp);
  }
}

/**
 * Coordonnées arrondies à 1e-9 degré (≈ 0,1 mm, précision acceptée par
 * terra-draw), sans points consécutifs confondus, anneaux fermés. Les
 * calculs de découpe et de fusion produisent plus de décimales.
 */
function normalize(geometry: Polygon): Polygon {
  const round = (v: number) => Math.round(v * 1e9) / 1e9;
  return {
    type: "Polygon",
    coordinates: geometry.coordinates.map((ring) => {
      const out: number[][] = [];
      for (const p of ring) {
        const q = [round(p[0]!), round(p[1]!)];
        const prev = out[out.length - 1];
        if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
      }
      const first = out[0]!;
      const last = out[out.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) out.push([...first]);
      return out;
    }),
  };
}
