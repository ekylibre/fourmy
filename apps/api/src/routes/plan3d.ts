import { Hono } from "hono";
import { intersects, expand, tileBounds } from "@fourmy/geo-ign";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { farmExtent, plan3dAt, enrichHeightsFromIgn } from "../repos/plan3d.js";
import { atOrNow, BadRequest, domainCtx, problem } from "./helpers.js";
import { HEIGHTMAP_SIZE, terrainTile } from "../terrain.js";
import { setParcelRows, vegetationAt } from "../repos/vegetation3d.js";
import { dayWeather } from "../repos/weather.js";
import { cropModelAt } from "../repos/crop-model.js";
import { CROP_MODELS, canopyFromModel } from "@fourmy/domain";
import { uuidParam } from "./helpers.js";
import { landscapeAt } from "../repos/landscape3d.js";
import { IgnUnavailable } from "../ign/store.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Point d'injection pour les tests (pas d'appel réseau vers Open-Meteo). */
export const weatherDeps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

/** En deçà, une tuile couvre des centaines de km : relief plat, l'IGN n'est pas sollicité. */
const MIN_TERRAIN_LEVEL = 10;

const FLAT = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE);

/** Point d'injection pour les tests (pas d'appel réseau vers l'IGN). */
export const terrainDeps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

const binary = (data: Float32Array, source: "ign" | "flat" | "fallback") =>
  new Response(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": source === "fallback" ? "no-store" : "private, max-age=86400",
      "x-terrain-source": source,
    },
  });

/** Relief (ADR-9, révisée) et plan 3D (ADR-8/10) — agent F. */
export const plan3dRoutes = new Hono<Env>()
  // Paysage (arbres, haies, pylônes, lignes électriques) de la BD TOPO autour de la ferme, à la date (parcelles exclues).
  .get("/landscape3d", async (c) => {
    const at = c.req.query("at") ?? new Date().toISOString().slice(0, 10);
    if (!DAY.test(at) || Number.isNaN(Date.parse(at))) throw new BadRequest("at : date AAAA-MM-JJ attendue.");
    // Emprise facultative (zone d'un rejeu) : ouest, sud, est, nord en degrés.
    const raw = c.req.query("bbox");
    let bbox: { west: number; south: number; east: number; north: number } | undefined;
    if (raw) {
      const [west, south, east, north] = raw.split(",").map(Number);
      if ([west, south, east, north].some((v) => v === undefined || !Number.isFinite(v)) || west! >= east! || south! >= north!) throw new BadRequest("bbox : ouest,sud,est,nord attendus.");
      bbox = { west: west!, south: south!, east: east!, north: north! };
    }
    try {
      // `canopy=0` : sans le LiDAR HD (hauteurs par nature de la BD TOPO seulement).
      return c.json(await landscapeAt(db(), c.get("farmId"), at, terrainDeps.fetch, bbox, { canopy: c.req.query("canopy") !== "0" }));
    } catch (e) {
      if (e instanceof IgnUnavailable) console.warn(`[landscape3d] IGN indisponible : ${e.message}`);
      if (e instanceof IgnUnavailable) return problem(c, 502, "IGN indisponible", "Le paysage n'est pas encore en cache et l'IGN ne répond pas.");
      throw e;
    }
  })
  // Végétation et météo du plan 3D (lot AA). La météo est facultative : une panne d'Open-Meteo n'empêche pas la végétation.
  .get("/vegetation3d", async (c) => {
    const at = c.req.query("at") ?? new Date().toISOString().slice(0, 10);
    if (!DAY.test(at) || Number.isNaN(Date.parse(at))) throw new BadRequest("at : date AAAA-MM-JJ attendue.");
    const farmId = c.get("farmId");
    const [parcels, weather, model] = await Promise.all([
      vegetationAt(db(), farmId, at),
      dayWeather(db(), farmId, at, weatherDeps.fetch).catch((e: unknown) => {
        console.warn(`[vegetation3d] météo indisponible : ${e instanceof Error ? e.message : e}`);
        return null;
      }),
      // Modèle de croissance (lot AB) : relaie le NDVI quand il manque (nuages, date à venir).
      cropModelAt(db(), farmId, at, weatherDeps.fetch).catch((e: unknown) => {
        console.warn(`[vegetation3d] modèle de croissance indisponible : ${e instanceof Error ? e.message : e}`);
        return null;
      }),
    ]);
    const states = new Map((model?.items ?? []).map((s) => [s.parcelId, s]));
    const merged = parcels.map((p) => {
      const s = states.get(p.parcelId);
      if (p.canopy.phase !== "unknown" || !s) return p;
      const def = CROP_MODELS[s.model];
      return {
        ...p,
        canopy: canopyFromModel({
          species: p.species,
          nature: p.nature,
          gdd: s.gdd,
          stages: s.stages,
          floweringCode: def.flowering,
          maturityCode: def.maturity,
          ended: s.stage?.code === "ended",
        }),
      };
    });
    return c.json({ at, parcels: merged, weather });
  })
  .put("/land-parcels/:id/rows", requireOwner, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { bearingDeg?: unknown; spacingM?: unknown };
    const bearing = Number(body.bearingDeg);
    const spacing = Number(body.spacingM);
    if (!Number.isFinite(bearing) || !Number.isFinite(spacing)) throw new BadRequest("bearingDeg et spacingM attendus.");
    if (spacing < 0.1 || spacing > 10) throw new BadRequest("Inter-rang entre 0,1 et 10 m.");
    // Un rang n'a pas de sens : 190° = 10°.
    const bearingDeg = Math.round((((bearing % 180) + 180) % 180) * 10) / 10;
    await setParcelRows(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), { bearingDeg, spacingM: spacing });
    return c.body(null, 204);
  })
  .delete("/land-parcels/:id/rows", requireOwner, async (c) => {
    await setParcelRows(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), null);
    return c.body(null, 204);
  })
  .get("/terrain/heightmap/:z/:x/:y", async (c) => {
    const [z, x, y] = ["z", "x", "y"].map((k) => Number(c.req.param(k)));
    let bounds;
    try {
      bounds = tileBounds(z!, x!, y!);
    } catch (e) {
      throw new BadRequest(String((e as Error).message));
    }
    const extent = await farmExtent(db(), c.get("farmId"));
    if (z! < MIN_TERRAIN_LEVEL || !extent || !intersects(bounds, expand(extent, 5000))) return binary(FLAT, "flat");
    const { grid, source } = await terrainTile(c.get("farmId"), z!, x!, y!, terrainDeps.fetch);
    return binary(grid, source);
  })
  .get("/plan3d", async (c) =>
    c.json(await plan3dAt(db(), c.get("farmId"), atOrNow(c), { context: c.req.query("context") === "1", fetchImpl: terrainDeps.fetch })),
  )
  .post("/places/ign-heights", requireOwner, async (c) =>
    c.json(await enrichHeightsFromIgn(db(), c.get("farmId"), domainCtx(c), terrainDeps.fetch)),
  );
