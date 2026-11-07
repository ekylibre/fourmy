import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import { autoPlaceTanks, fromLocal, outerRing, pointInPolygon, ringCentroid, tankDimensions, toLocal, type DomainCtx, type Pt } from "@fourmy/domain";
import { expand, fetchBuildings, Lru, type Bounds, type IgnBuilding } from "@fourmy/geo-ign";
import type { GeoJsonGeometry } from "@fourmy/contracts";
import { listContainersAt } from "./containers.js";
import { listParcelsAt } from "./parcels.js";
import { listPlacesAt } from "./places.js";

/**
 * Plan 3D de la ferme à une date (ADR-8/10) : emprise, parcelles, bâtiments
 * avec hauteur, cuves positionnées (placement manuel, sinon automatique dans
 * l'emprise) et remplies selon leur volume à la date.
 */

const DEFAULT_BUILDING_HEIGHT_M = 6;

const extents = new Lru<string, { bounds: Bounds; at: number }>(200);

/** Emprise de la ferme (parcelles + bâtiments, toutes dates), en cache 10 min. */
export async function farmExtent(db: Database, farmId: string): Promise<Bounds | null> {
  const cached = extents.get(farmId);
  if (cached && Date.now() - cached.at < 600_000) return cached.bounds;
  const [r] = (await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      SELECT ST_XMin(e) AS west, ST_YMin(e) AS south, ST_XMax(e) AS east, ST_YMax(e) AS north FROM (
        SELECT ST_Extent(g) AS e FROM (
          SELECT v.shape AS g FROM land_parcel_versions v JOIN land_parcels p ON p.id = v.land_parcel_id
          UNION ALL
          SELECT v.footprint FROM place_versions v JOIN places p ON p.id = v.place_id WHERE v.footprint IS NOT NULL
        ) s
      ) x`),
  )) as unknown as { west: number | null; south: number; east: number; north: number }[];
  if (!r || r.west === null) return null;
  const bounds = { west: r.west, south: r.south, east: r.east, north: r.north };
  extents.set(farmId, { bounds, at: Date.now() });
  return bounds;
}

/** Bâtiments BD TOPO autour de la ferme, en cache 1 h (contexte et hauteurs). */
const ignBuildings = new Lru<string, { items: IgnBuilding[]; at: number }>(100);
export async function ignBuildingsAround(farmId: string, bounds: Bounds, fetchImpl?: typeof fetch): Promise<IgnBuilding[]> {
  const cached = ignBuildings.get(farmId);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.items;
  const items = await fetchBuildings(expand(bounds, 300), fetchImpl);
  ignBuildings.set(farmId, { items, at: Date.now() });
  return items;
}

export interface Plan3d {
  at: string;
  extent: Bounds | null;
  center: [number, number] | null;
  parcels: { id: string; name: string; nature: string | null; areaM2: number; shape: GeoJsonGeometry }[];
  buildings: {
    id: string;
    name: string;
    kind: string;
    footprint: GeoJsonGeometry;
    heightM: number;
    heightSource: "ign" | "ekylibre" | "manual" | "estimated";
  }[];
  tanks: {
    id: string;
    name: string;
    placeId: string;
    lon: number;
    lat: number;
    radius: number;
    height: number;
    capacityL: number;
    volumeL: number;
    fill: number;
    placement: "auto" | "manual";
  }[];
  unplaced: { id: string; name: string; reason: string }[];
  context: { id: string; footprint: IgnBuilding["geometry"]; heightM: number }[];
}

export async function plan3dAt(
  db: Database,
  farmId: string,
  at: string,
  opts: { context?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<Plan3d> {
  const [parcels, places, containers, extent] = await Promise.all([
    listParcelsAt(db, farmId, at),
    listPlacesAt(db, farmId, at),
    listContainersAt(db, farmId, at),
    farmExtent(db, farmId),
  ]);
  const natures = (await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      SELECT p.land_parcel_id AS id, p.nature FROM productions p JOIN campaigns c ON c.id = p.campaign_id
      WHERE c.year = extract(year FROM ${at}::timestamptz)::int`),
  )) as unknown as { id: string; nature: string }[];
  const natureOf = new Map(natures.map((n) => [n.id, n.nature]));

  const buildings: Plan3d["buildings"] = places
    .filter((p) => p.version.footprint)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.version.kind,
      footprint: p.version.footprint!,
      heightM: p.version.heightM ?? DEFAULT_BUILDING_HEIGHT_M,
      // Ekylibre ne stocke aucune hauteur : sur un bâtiment migré, une hauteur
      // présente vient forcément de l'enrichissement BD TOPO.
      heightSource: p.version.heightM ? (p.version.source === "ekylibre" ? "ign" : p.version.source) : "estimated",
    }));
  const placeById = new Map(buildings.map((b) => [b.id, b]));

  // Cuves : placement manuel conservé ; sinon placement automatique par bâtiment.
  const tanks: Plan3d["tanks"] = [];
  const unplaced: Plan3d["unplaced"] = [];
  const byPlace = new Map<string, typeof containers>();
  for (const c of containers) byPlace.set(c.placeId, [...(byPlace.get(c.placeId) ?? []), c]);
  for (const [placeId, list] of byPlace) {
    const building = placeById.get(placeId);
    const ring = outerRing(building?.footprint);
    if (!building || !ring) {
      for (const c of list) unplaced.push({ id: c.id, name: c.name, reason: "bâtiment sans emprise connue" });
      continue;
    }
    const origin = ringCentroid(ring);
    const local = ring.map((p) => toLocal(p, origin));
    const maxH = Math.max(building.heightM - 0.5, 1);
    const dims = new Map(list.map((c) => [c.id, c.version.shape3d ?? { ...tankDimensions(c.version.capacityL, maxH), x: 0, y: 0, z: 0 }]));
    const auto = autoPlaceTanks(
      local,
      list.filter((c) => !c.version.shape3d).map((c) => ({ id: c.id, radius: dims.get(c.id)!.radius })),
    );
    const autoPos = new Map(auto.placed.map((p) => [p.id, p]));
    for (const c of list) {
      const d = dims.get(c.id)!;
      const pos = c.version.shape3d ? { x: c.version.shape3d.x, y: c.version.shape3d.y } : autoPos.get(c.id);
      if (!pos) {
        unplaced.push({ id: c.id, name: c.name, reason: "ne tient pas dans le bâtiment (placement manuel requis)" });
        continue;
      }
      const [lon, lat] = fromLocal([pos.x, pos.y], origin);
      tanks.push({
        id: c.id,
        name: c.name,
        placeId,
        lon,
        lat,
        radius: d.radius,
        height: d.height,
        capacityL: c.version.capacityL,
        volumeL: c.volumeL,
        fill: c.version.capacityL > 0 ? Math.min(Math.max(c.volumeL / c.version.capacityL, 0), 1) : 0,
        placement: c.version.shape3d ? "manual" : "auto",
      });
    }
  }

  let context: Plan3d["context"] = [];
  if (opts.context && extent) {
    try {
      // Contexte = bâtiments IGN qui ne sont PAS ceux de la ferme (sinon un
      // volume gris opaque recouvrirait le chai et cacherait les cuves).
      const farmRings = buildings.map((b) => outerRing(b.footprint)).filter((r): r is Pt[] => !!r);
      const overlapsFarm = (ring: Pt[]) =>
        farmRings.some((f) => pointInPolygon(ringCentroid(ring), f) || pointInPolygon(ringCentroid(f), ring) || f.some((p) => pointInPolygon(p, ring)));
      context = (await ignBuildingsAround(farmId, extent, opts.fetchImpl))
        .filter((b) => b.heightM !== null)
        .filter((b) => {
          const ring = outerRing(b.geometry as GeoJsonGeometry)?.map((p) => [p[0], p[1]] as Pt);
          return ring ? !overlapsFarm(ring) : false;
        })
        .map((b) => ({ id: b.id, footprint: b.geometry, heightM: b.heightM! }));
    } catch {
      context = []; // contexte facultatif : la vue reste utilisable sans l'IGN
    }
  }

  return {
    at,
    extent,
    center: extent ? [(extent.west + extent.east) / 2, (extent.south + extent.north) / 2] : null,
    parcels: parcels.map((p) => ({ id: p.id, name: p.name, nature: natureOf.get(p.id) ?? null, areaM2: p.version.areaM2, shape: p.version.shape })),
    buildings,
    tanks,
    unplaced,
    context,
  };
}

/**
 * Hauteurs des bâtiments depuis la BD TOPO : pour chaque bâtiment ou local
 * (division d'un bâtiment, ex. le chai) sans hauteur, le bâtiment IGN qui
 * recouvre le plus son emprise (≥ 30 %) donne sa hauteur.
 * Mise à jour en place, tracée dans l'audit (action « enriched »).
 */
export async function enrichHeightsFromIgn(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  fetchImpl?: typeof fetch,
): Promise<{ updated: { placeId: string; name: string; heightM: number; ign: string; overlap: number }[]; unmatched: string[] }> {
  const extent = await farmExtent(db, farmId);
  if (!extent) return { updated: [], unmatched: [] };
  const candidates = (await ignBuildingsAround(farmId, extent, fetchImpl)).filter((b) => b.heightM !== null);
  return withFarm(db, farmId, async (tx) => {
    const targets = (await tx.execute(sql`
      SELECT p.id, p.name, v.id AS version_id, ST_AsGeoJSON(v.footprint) AS footprint
      FROM places p JOIN place_versions v ON v.place_id = p.id AND upper(v.valid) IS NULL
      WHERE v.footprint IS NOT NULL AND v.height_m IS NULL AND v.kind IN ('building', 'room')`)) as unknown as {
      id: string;
      name: string;
      version_id: string;
      footprint: string;
    }[];
    const updated: { placeId: string; name: string; heightM: number; ign: string; overlap: number }[] = [];
    const unmatched: string[] = [];
    for (const t of targets) {
      let best: { b: IgnBuilding; overlap: number } | null = null;
      for (const b of candidates) {
        const [r] = (await tx.execute(sql`
          SELECT CASE WHEN ST_Intersects(f, g)
                      THEN ST_Area(ST_Intersection(f, g)::geography) / NULLIF(ST_Area(f::geography), 0) ELSE 0 END AS overlap
          FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${t.footprint}), 4326) AS f,
                       ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(b.geometry)}), 4326)) AS g) s`)) as unknown as { overlap: number }[];
        const overlap = Number(r?.overlap ?? 0);
        if (overlap > (best?.overlap ?? 0)) best = { b, overlap };
      }
      if (!best || best.overlap < 0.3) {
        unmatched.push(t.name);
        continue;
      }
      await tx.execute(sql`UPDATE place_versions SET height_m = ${best.b.heightM} WHERE id = ${t.version_id}`);
      await tx.execute(sql`
        INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
        VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'place_versions', ${t.version_id}, 'enriched',
                ${JSON.stringify({ source: "BD TOPO", ign: best.b.id, rnb: best.b.rnbIds, heightM: best.b.heightM, overlap: Math.round(best.overlap * 100) / 100 })}::jsonb,
                ${ctx.now}::timestamptz)`);
      updated.push({ placeId: t.id, name: t.name, heightM: best.b.heightM!, ign: best.b.id, overlap: Math.round(best.overlap * 100) / 100 });
    }
    return { updated, unmatched };
  });
}
