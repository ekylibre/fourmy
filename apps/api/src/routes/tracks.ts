import { Hono } from "hono";
import { trackAttachRequest, trackDraftRequest, trackSessionKind, trackSessionState, trackSettings } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { trackReplay, trackCoverage, toCzml } from "../repos/tracks.js";
import { hitches, latestPositions } from "../repos/avatar.js";
import {
  computeTrackSessions,
  draftTrackSessions,
  getTrackSession,
  getTrackSettings,
  interventionTrackSessions,
  listTrackSessions,
  putTrackSettings,
  trackSummary,
} from "../repos/track-sessions.js";
import { attachTrackSessions } from "../repos/interventions.js";
import { atOrNow, BadRequest, domainCtx, problem, uuidParam, window } from "./helpers.js";

const DAY = 86_400_000;
/** Option de requête validée par un schéma (absente : undefined). */
const optional = <T>(value: string | undefined, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, name: string): T | undefined => {
  if (value === undefined || value === "") return undefined;
  const r = schema.safeParse(value);
  if (!r.success) throw new BadRequest(`${name} invalide`);
  return r.data;
};

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
  })
  // Synthèse des parcours de la ferme (tableau de bord, retours du 10/11/2026) :
  // [from, to[, au plus 31 jours ; un parcours à cheval compte entier.
  .get("/tracks/summary", async (c) => {
    const f = Date.parse(c.req.query("from") ?? "");
    const t = Date.parse(c.req.query("to") ?? "");
    if (Number.isNaN(f) || Number.isNaN(t) || t <= f) throw new BadRequest("from/to : dates ISO, from < to");
    if (t - f > 31 * DAY) throw new BadRequest("fenêtre limitée à 31 jours");
    return c.json(await trackSummary(db(), c.get("farmId"), new Date(f).toISOString(), new Date(t).toISOString()));
  })
  // Parcours GPS (lot O3, FR-GPS-10 à 17).
  .get("/equipments/:id/track-sessions", async (c) => {
    // Période : les 30 derniers jours par défaut (FR-GPS-13), au plus 400 jours.
    const t = Date.parse(c.req.query("to") ?? new Date().toISOString());
    const f = c.req.query("from") ? Date.parse(c.req.query("from")!) : t - 30 * DAY;
    if (Number.isNaN(f) || Number.isNaN(t) || t <= f) throw new BadRequest("from/to : dates ISO, from < to");
    if (t - f > 400 * DAY) throw new BadRequest("fenêtre limitée à 400 jours");
    const range = { from: new Date(f).toISOString(), to: new Date(t).toISOString() };
    const parcel = c.req.query("parcel");
    if (parcel) uuidParam(c, "parcel", "query");
    const limit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new BadRequest("limit : entier de 1 à 200");
    return c.json(
      await listTrackSessions(db(), c.get("farmId"), {
        equipmentId: uuidParam(c, "id"),
        ...range,
        kind: optional(c.req.query("kind"), trackSessionKind, "kind"),
        state: optional(c.req.query("state"), trackSessionState, "state"),
        parcelId: parcel || undefined,
        cursor: c.req.query("cursor") || undefined,
        limit,
      }),
    );
  })
  .get("/track-sessions/:id", async (c) => {
    const viewer = c.req.query("equipment");
    return c.json(await getTrackSession(db(), c.get("farmId"), uuidParam(c, "id"), viewer ? uuidParam(c, "equipment", "query") : undefined));
  })
  // Parcours → intervention (lot P, FR-GPS-20 à 24).
  .post("/track-sessions/draft", async (c) => {
    const parsed = trackDraftRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", "sessionIds : 1 à 50 identifiants de parcours");
    return c.json(await draftTrackSessions(db(), c.get("farmId"), parsed.data.sessionIds));
  })
  .get("/interventions/:id/track-sessions", async (c) =>
    c.json({ items: await interventionTrackSessions(db(), c.get("farmId"), uuidParam(c, "id")) }),
  )
  .post("/interventions/:id/track-sessions", async (c) => {
    const parsed = trackAttachRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", "sessionIds : 1 à 50 identifiants de parcours ; crewId facultatif");
    return c.json(
      await attachTrackSessions(db(), c.get("farmId"), domainCtx(c), uuidParam(c, "id"), parsed.data.sessionIds, parsed.data.crewId),
    );
  })
  .post("/track-sessions/recompute", requireOwner, async (c) => c.json(await computeTrackSessions(db(), c.get("farmId"))))
  .get("/settings/tracks", async (c) => c.json(await getTrackSettings(db(), c.get("farmId"))))
  .put("/settings/tracks", requireOwner, async (c) => {
    const parsed = trackSettings.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
    return c.json(await putTrackSettings(db(), c.get("farmId"), parsed.data));
  });
