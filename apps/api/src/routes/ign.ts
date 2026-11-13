import { Hono } from "hono";
import { farmIgnSettings, type IgnLayer } from "@fourmy/contracts";
import { validTile } from "@fourmy/geo-ign";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { cacheManifest, cancelJob, ConfirmationRequired, createJob, getCacheState, putIgnSettings } from "../ign/cache.js";
import { getTile, IGN_LAYERS, IgnUnavailable } from "../ign/store.js";
import { BadRequest, domainCtx, problem, uuidParam } from "./helpers.js";

/**
 * Tuiles IGN relayées et mises en cache par le serveur, préchargement autour
 * des sites (« Ma ferme », lot F4, claudedocs/conception_ma_ferme.md §5.1,
 * §5.3). Les tuiles se lisent par tout membre ; les réglages et le
 * préchargement sont réservés au responsable.
 */

const MAX_AGE_S = 7 * 86_400;

export const ignRoutes = new Hono<Env>()
  .get("/ign/tiles/:layer/:z/:x/:y", async (c) => {
    const layer = c.req.param("layer");
    const [z, x, y] = ["z", "x", "y"].map((k) => Number(c.req.param(k)));
    // Le relais ne sert que les fonds de carte ; relief et bâtiments passent par la 3D.
    if (!IGN_LAYERS[layer as IgnLayer]?.raster || !validTile(z!, x!, y!)) return problem(c, 404, "Tuile inconnue");
    let tile;
    try {
      tile = await getTile(db(), layer as IgnLayer, z!, x!, y!);
    } catch (e) {
      if (e instanceof IgnUnavailable) return problem(c, 502, "IGN indisponible", "La tuile n'est pas encore en cache et l'IGN ne répond pas.");
      throw e;
    }
    // Hors couverture de l'IGN : rien à afficher, et inutile de redemander tout de suite.
    if (!tile) return c.body(null, 404, { "cache-control": "private, max-age=86400" });
    const etag = `"${tile.sha1}"`;
    const headers = {
      etag,
      "last-modified": tile.fetchedAt.toUTCString(),
      "cache-control": `private, max-age=${MAX_AGE_S}`,
      "x-ign-cache": tile.cache,
    };
    const inm = c.req.header("if-none-match");
    const ims = c.req.header("if-modified-since");
    if ((inm && inm.split(",").some((t) => t.trim() === etag)) || (!inm && ims && new Date(ims).getTime() >= Math.floor(tile.fetchedAt.getTime() / 1000) * 1000)) {
      return c.body(null, 304, headers);
    }
    return c.body(new Uint8Array(tile.bytes), 200, { ...headers, "content-type": IGN_LAYERS[layer as IgnLayer].contentType });
  })
  // Copie hors ligne du navigateur (F5) : ouverte à tout membre, comme les tuiles.
  .get("/ign/cache/manifest", async (c) => c.json(await cacheManifest(db(), c.get("farmId"))))
  .get("/ign/cache", async (c) => c.json(await getCacheState(db(), c.get("farmId"), c.get("role") === "owner")))
  .put("/settings/ign", requireOwner, async (c) => {
    const parsed = farmIgnSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new BadRequest(parsed.error.issues.map((i) => i.message).join(" ; "));
    return c.json(await putIgnSettings(db(), c.get("farmId"), domainCtx(c), parsed.data));
  })
  .post("/ign/cache/jobs", requireOwner, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: unknown };
    try {
      return c.json(await createJob(db(), c.get("farmId"), domainCtx(c), { confirm: body?.confirm === true }), 202);
    } catch (e) {
      if (!(e instanceof ConfirmationRequired)) throw e;
      return c.json(
        { type: "about:blank", title: "Confirmation demandée", status: 409, detail: e.message, confirmationRequired: true, estimateBytes: e.estimateBytes, tiles: e.tiles },
        409,
        { "content-type": "application/problem+json" },
      );
    }
  })
  .delete("/ign/cache/jobs/:id", requireOwner, async (c) => {
    await cancelJob(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
