import { Hono } from "hono";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { trackReplay, trackCoverage, toCzml } from "../repos/tracks.js";
import { hitches, latestPositions } from "../repos/avatar.js";
import { atOrNow, uuidParam, window } from "./helpers.js";

/** Traces GPS : rejeu (JSON / CZML) et couverture par parcelle (US-1, US-3). */
export const trackRoutes = new Hono<Env>()
  .get("/tracks", async (c) => {
    const q = { equipmentId: uuidParam(c, "equipment", "query"), ...window(c, 31) };
    const track = await trackReplay(db(), c.get("farmId"), { ...q, toleranceM: Number(c.req.query("tolerance") ?? 2) });
    if ((c.req.query("format") ?? "json") === "czml") return c.json(toCzml(track, c.req.query("name") ?? "Matériel"));
    return c.json(track);
  })
  // Vue 3D (lot M) : dernière position de chaque matériel suivi, outils attelés.
  .get("/tracks/latest", async (c) => c.json({ items: await latestPositions(db(), c.get("farmId"), atOrNow(c)) }))
  .get("/tracks/hitches", async (c) => {
    const q = { equipmentId: uuidParam(c, "equipment", "query"), ...window(c, 31) };
    return c.json({ items: await hitches(db(), c.get("farmId"), q.equipmentId, q.from, q.to) });
  })
  .get("/tracks/coverage", async (c) => {
    const q = { equipmentId: uuidParam(c, "equipment", "query"), ...window(c, 31) };
    return c.json(
      await trackCoverage(db(), c.get("farmId"), {
        ...q,
        defaultWidthM: Number(c.req.query("width") ?? 3),
        maxGapS: Number(c.req.query("maxGap") ?? 30),
      }),
    );
  });
