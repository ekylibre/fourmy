import { Hono } from "hono";
import { intersects, expand, tileBounds } from "@fourmy/geo-ign";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { farmExtent, plan3dAt, enrichHeightsFromIgn } from "../repos/plan3d.js";
import { atOrNow, BadRequest, domainCtx } from "./helpers.js";
import { HEIGHTMAP_SIZE, terrainTile } from "../terrain.js";

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
