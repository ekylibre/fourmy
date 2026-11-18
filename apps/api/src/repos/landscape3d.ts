import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import { inPolygon, landscapeTrees, pylonHeightM, refineWithCanopy, type Pt, type TreeInstance } from "@fourmy/domain";
import { CANOPY_SIZE, canopyAt, canopyPeaks, expand, IGN_LAYER_ZOOMS, Lru, mercatorTileBounds, tilesInBox, type Bounds, type CanopyGrid, type LandscapeFeature } from "@fourmy/geo-ign";
import type { Landscape3dAt } from "@fourmy/contracts";
import { db as appDb } from "../db.js";
import { getTile, IgnUnavailable } from "../ign/store.js";
import { farmExtent, ignBuildingsAround } from "./plan3d.js";

/**
 * Paysage du plan 3D (claudedocs/conception_rejeu_3d_outils_paysage.md §4.3, §7) :
 * arbres placés d'après les haies et zones de végétation de la BD TOPO,
 * pylônes et lignes électriques, autour de la ferme. Tuiles de zoom 14 lues
 * dans le cache disque (préchargées avec « Ma ferme »), sinon demandées à
 * l'IGN ; réponse gardée 1 h en mémoire par ferme et par date.
 */

const ZOOM = IGN_LAYER_ZOOMS.landscape.zone![0];
/** Marge autour des parcelles et bâtiments de la ferme (m). */
const MARGIN_M = 500;
/** Côté maximal de l'emprise (m) : au-delà, recentrée sur la ferme. */
const MAX_SIDE_M = 8_000;
const M_PER_DEG = 111_320;

/** Types d'arbres, dans l'ordre de l'index de `trees.items`. */
export const TREE_KINDS: TreeInstance["kind"][] = ["deciduous", "conifer", "hedge", "orchard"];

export type Landscape3d = Landscape3dAt;

const cache = new Lru<string, { value: Landscape3d; at: number }>(50);

/** Emprise bornée à MAX_SIDE_M de côté, autour du centre. */
export function clampBounds(b: Bounds, maxSideM = MAX_SIDE_M): Bounds {
  const lat = (b.south + b.north) / 2;
  const halfLat = maxSideM / 2 / M_PER_DEG;
  const halfLon = maxSideM / 2 / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  const [cx, cy] = [(b.west + b.east) / 2, lat];
  return {
    west: Math.max(b.west, cx - halfLon),
    east: Math.min(b.east, cx + halfLon),
    south: Math.max(b.south, cy - halfLat),
    north: Math.min(b.north, cy + halfLat),
  };
}

const outer = (g: { type: string; coordinates: unknown }): Pt[][][] =>
  g.type === "Polygon" ? [g.coordinates as Pt[][]] : g.type === "MultiPolygon" ? (g.coordinates as Pt[][][]) : [];

/**
 * Paysage d'une emprise (`bbox`, par exemple la zone d'un rejeu), sinon des
 * abords de la ferme (parcelles et bâtiments, plus 500 m). Côté borné à 8 km.
 */
export async function landscapeAt(db: Database, farmId: string, at: string, fetchImpl?: typeof fetch, bbox?: Bounds, opts: { canopy?: boolean } = {}): Promise<Landscape3d> {
  // Les arbres ne dépendent de la date que par les parcelles exclues : la clé porte sur les
  // versions de parcelles en place, pas sur le jour (le calcul prend plusieurs secondes).
  const versions = await withFarm(db, farmId, async (tx) =>
    (await tx.execute(sql`
      SELECT coalesce(string_agg(v.id::text, ',' ORDER BY v.id), '') AS ids FROM land_parcel_versions v JOIN land_parcels p ON p.id = v.land_parcel_id
      WHERE v.valid @> ${at}::timestamptz`)) as unknown as { ids: string }[],
  );
  const key = `${farmId}:${createHash("sha1").update(versions[0]?.ids ?? "").digest("hex").slice(0, 12)}:${opts.canopy === false ? "bdtopo" : "lidar"}:${bbox ? [bbox.west, bbox.south, bbox.east, bbox.north].map((v) => v.toFixed(4)).join(",") : "ferme"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.value;
  const extent = await farmExtent(db, farmId);
  if (!extent) return { trees: { kinds: TREE_KINDS, items: [] }, pylons: [], lines: [], attribution: [], truncated: false, missingTiles: 0 };
  const area = clampBounds(bbox ?? expand(extent, MARGIN_M));
  const tiles = tilesInBox(area.west, area.south, area.east, area.north, ZOOM);
  const byId = new Map<string, LandscapeFeature>();
  const loaded = await loadTiles("landscape", tiles, fetchImpl);
  if (!loaded.ok && loaded.error) throw loaded.error;
  // Un objet à cheval sur deux tuiles revient deux fois : dédoublonné.
  for (const { bytes } of loaded.tiles) for (const f of JSON.parse(bytes.toString("utf8")) as LandscapeFeature[]) byId.set(f.id, f);
  const missing = loaded.missing;
  const features = [...byId.values()];
  // Aucun arbre dans une parcelle cultivée à la date, ni dans un bâtiment.
  const parcels = await withFarm(db, farmId, async (tx) =>
    (await tx.execute(sql`
      SELECT ST_AsGeoJSON(v.shape)::json AS g FROM land_parcel_versions v JOIN land_parcels p ON p.id = v.land_parcel_id
      WHERE v.valid @> ${at}::timestamptz`)) as unknown as { g: { type: string; coordinates: unknown } }[],
  );
  const buildings = await ignBuildingsAround(farmId, extent, fetchImpl).catch(() => []);
  const exclude = [...parcels.flatMap((p) => outer(p.g)), ...buildings.flatMap((b) => outer(b.geometry as { type: string; coordinates: unknown }))];
  const placed = landscapeTrees(features, { exclude, bbox: [area.west, area.south, area.east, area.north] });
  let trees = placed.trees;
  const truncated = placed.truncated;

  // Hauteurs réelles et cimes isolées (MNH du LiDAR HD), si l'IGN en a sur la zone.
  let canopy: Landscape3d["canopy"] = null;
  if (opts.canopy !== false) {
    const got = await loadTiles("canopy", tiles, fetchImpl);
    const grids: CanopyGrid[] = got.tiles
      .map(({ t, bytes }) => ({ bounds: mercatorTileBounds(t.z, t.x, t.y), size: CANOPY_SIZE, data: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }))
      .filter((g) => g.data.length === CANOPY_SIZE * CANOPY_SIZE && g.data.some((v) => !Number.isNaN(v)));
    if (grids.length) {
      // Cimes : pas dans un bâtiment (le MNH les compte), ni dans une zone boisée déjà dessinée ;
      // 4 m au moins dans une parcelle (maïs ou tournesol sur pied), 3 m ailleurs.
      const zones = [
        ...buildings.flatMap((b) => outer(b.geometry as { type: string; coordinates: unknown })).map((rings) => ({ rings, min: Infinity })),
        ...features.filter((f) => f.kind === "vegetation").flatMap((f) => outer(f.geometry)).map((rings) => ({ rings, min: Infinity })),
        ...parcels.flatMap((p) => outer(p.g)).map((rings) => ({ rings, min: 4 })),
      ].map((z) => ({ ...z, box: boxOf(z.rings[0] ?? []) }));
      const minHeightAt = (lon: number, lat: number) => {
        let min = 3;
        for (const z of zones) {
          if (lon < z.box[0] || lon > z.box[2] || lat < z.box[1] || lat > z.box[3]) continue;
          if (inPolygon([lon, lat], z.rings)) min = Math.max(min, z.min);
        }
        return min;
      };
      const inArea = (p: { lon: number; lat: number }) => p.lon >= area.west && p.lon <= area.east && p.lat >= area.south && p.lat <= area.north;
      const peaks = grids.flatMap((g) => canopyPeaks(g, { minHeightM: 3, radius: 2, minHeightAt })).filter(inArea);
      const refined = refineWithCanopy(trees, (lon, lat) => canopyAt(grids, lon, lat, 1), peaks);
      trees = refined.trees;
      canopy = { tiles: grids.length, removed: refined.removed, added: refined.added };
    }
  }

  const lines = features
    .filter((f) => f.kind === "power_line")
    .flatMap((f) => {
      const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates as [number, number][]] : (f.geometry.coordinates as [number, number][][]);
      return parts.map((coords, k) => ({ id: parts.length > 1 ? `${f.id}:${k}` : f.id, voltageKv: f.voltageKv ?? null, coords }));
    });
  // Tension d'un pylône : celle de la ligne la plus proche (à moins de 50 m).
  const near = (p: [number, number]) => {
    let best: { kv: number | null; d: number } = { kv: null, d: 50 };
    const k = Math.cos((p[1] * Math.PI) / 180);
    for (const l of lines) {
      for (const c of l.coords) {
        const d = Math.hypot((c[0] - p[0]) * M_PER_DEG * k, (c[1] - p[1]) * M_PER_DEG);
        if (d < best.d) best = { kv: l.voltageKv, d };
      }
    }
    return best.kv;
  };
  const inArea = ([lon, lat]: [number, number]) => lon >= area.west && lon <= area.east && lat >= area.south && lat <= area.north;
  const pylons = features
    .filter((f) => f.kind === "pylon" && inArea(f.geometry.coordinates as [number, number]))
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const kv = near([lon, lat]);
      return { id: f.id, lon, lat, heightM: f.heightM ?? pylonHeightM(kv), voltageKv: kv };
    });
  const r7 = (v: number) => Math.round(v * 1e6) / 1e6;
  const value: Landscape3d = {
    trees: { kinds: TREE_KINDS, items: trees.map((t) => [r7(t.lon), r7(t.lat), t.heightM, t.crownM, TREE_KINDS.indexOf(t.kind)]) },
    pylons,
    lines: lines.filter((l) => l.coords.some(inArea)),
    attribution: [...(features.length ? ["IGN – BD TOPO"] : []), ...(canopy ? ["IGN – LiDAR HD"] : [])],
    truncated,
    missingTiles: missing,
    canopy,
  };
  // Incomplet : pas gardé en mémoire, les tuiles manquantes seront redemandées.
  if (!missing) cache.set(key, { value, at: Date.now() });
  return value;
}

/** Emprise [ouest, sud, est, nord] d'un anneau [lon, lat]. */
const boxOf = (ring: Pt[]): [number, number, number, number] => {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/**
 * Tuiles d'une couche, une après l'autre : le service de l'IGN limite le
 * débit (429, repris jusqu'à deux fois). Une tuile en échec n'empêche pas
 * les autres ; `ok` est faux si aucune n'a pu être lue.
 */
async function loadTiles(layer: "landscape" | "canopy", tiles: { z: number; x: number; y: number }[], fetchImpl?: typeof fetch) {
  const out: { t: { z: number; x: number; y: number }; bytes: Buffer }[] = [];
  let missing = 0;
  let error: unknown = null;
  for (const t of tiles) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tile = await getTile(appDb(), layer, t.z, t.x, t.y, fetchImpl);
        if (tile) out.push({ t, bytes: tile.bytes });
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (!(e instanceof IgnUnavailable) || e.status !== 429) break;
        await new Promise((r) => setTimeout(r, Math.min(5, e.retryAfterS ?? 1) * 1000 * (attempt + 1)));
      }
    }
    if (lastError) {
      missing++;
      error = lastError;
    }
  }
  return { tiles: out, missing, error, ok: missing < tiles.length || tiles.length === 0 };
}

/** Vide le cache mémoire (tests). */
export function clearLandscapeCache() {
  cache.clear();
}

export { MARGIN_M as LANDSCAPE_MARGIN_M };
export type { Bounds };
