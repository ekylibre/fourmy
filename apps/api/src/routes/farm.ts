import { Hono } from "hono";
import type { Context } from "hono";
import { landParcelWrite, containerCorrectionWrite } from "@fourmy/contracts";
import type { DomainCtx } from "@fourmy/domain";
import { DomainError } from "@fourmy/domain";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { listParcelsAt, createParcel, versionParcel } from "../repos/parcels.js";
import { listContainersAt, correctContainer, NotFound } from "../repos/containers.js";
import { trackReplay, trackCoverage, toCzml } from "../repos/tracks.js";

/**
 * Routes métier sous `/api/v1/farms/:farmId` (architecture §5.1).
 * Implémentées dans cette tranche : parcellaire versionné + snapshot (parcelles).
 * Les autres restent déclarées en 501 (agents B/C/D/F selon docs/workflow.md).
 */

const problem = (c: Context<Env>, status: number, title: string, detail?: string) =>
  c.json({ type: "about:blank", title, status, detail }, status as 400, {
    "content-type": "application/problem+json",
  });

const notImplemented = (what: string) => (c: Context<Env>) =>
  problem(c, 501, "Not Implemented", `${what} — à implémenter (docs/workflow.md)`);

/** Construit le contexte de domaine à partir de la requête. */
function domainCtx(c: Context<Env>): DomainCtx {
  return {
    now: new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    actor: c.get("userId"),
    origin: "web",
  };
}

const atOrNow = (c: Context<Env>) => c.req.query("at") ?? new Date().toISOString();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paramètres communs des traces : matériel + fenêtre (31 jours max). */
function trackQuery(c: Context<Env>): { equipmentId: string; from: string; to: string } | { error: string } {
  const equipmentId = c.req.query("equipment") ?? "";
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!UUID_RE.test(equipmentId)) return { error: "equipment doit être un UUID" };
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t) || t <= f) return { error: "from/to : dates ISO, from < to" };
  if (t - f > 31 * 86_400_000) return { error: "fenêtre limitée à 31 jours" };
  return { equipmentId, from: new Date(f).toISOString(), to: new Date(t).toISOString() };
}

export const farmRoutes = new Hono<Env>()
  // --- État consolidé -------------------------------------------------------
  .get("/snapshot", async (c) => {
    const at = atOrNow(c);
    const landParcels = await listParcelsAt(db(), c.get("farmId"), at);
    // places / containers / equipments : à compléter (agent D) — snapshot partiel.
    return c.json({
      at,
      landParcels,
      productions: [],
      places: [],
      containers: [],
      equipments: [],
    });
  })

  // --- Parcellaire ----------------------------------------------------------
  .get("/land-parcels", async (c) => {
    const items = await listParcelsAt(db(), c.get("farmId"), atOrNow(c));
    return c.json({ items, nextCursor: null });
  })
  .post("/land-parcels", async (c) => {
    const parsed = landParcelWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const ctx = domainCtx(c);
    const id = parsed.data.id ?? ctx.newId();
    try {
      const version = await createParcel(db(), c.get("farmId"), ctx, { ...parsed.data, id });
      return c.json(version, 201);
    } catch (e) {
      return problem(c, 409, "Création impossible", String(e));
    }
  })
  .patch("/land-parcels/:id", async (c) => {
    const parsed = landParcelWrite.omit({ id: true }).safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    try {
      const version = await versionParcel(
        db(),
        c.get("farmId"),
        domainCtx(c),
        c.req.param("id"),
        parsed.data,
      );
      return c.json(version);
    } catch (e) {
      if (e instanceof DomainError) return problem(c, 422, "Versionnement refusé", e.message);
      return problem(c, 409, "Mise à jour impossible", String(e));
    }
  })

  // --- Déclarées, non encore implémentées ----------------------------------
  .get("/places", notImplemented("GET /places"))
  .get("/containers", async (c) => {
    const items = await listContainersAt(db(), c.get("farmId"), atOrNow(c));
    return c.json({ items, nextCursor: null });
  })
  .post("/containers/:id/corrections", async (c) => {
    const parsed = containerCorrectionWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    try {
      const container = await correctContainer(
        db(), c.get("farmId"), domainCtx(c), c.req.param("id"), parsed.data,
      );
      return c.json(container);
    } catch (e) {
      if (e instanceof NotFound) return problem(c, 404, "Cuve introuvable", e.message);
      if (e instanceof DomainError) return problem(c, 422, "Correction refusée", e.message);
      throw e;
    }
  })
  .patch("/containers/:id/placement", notImplemented("PATCH /containers/:id/placement"))
  .get("/containers/:id/contents", notImplemented("GET /containers/:id/contents"))
  .get("/stock", notImplemented("GET /stock"))
  .get("/interventions", notImplemented("GET /interventions"))
  .post("/interventions", notImplemented("POST /interventions"))
  .post("/interventions/:id/complete", notImplemented("POST /interventions/:id/complete"))
  .get("/registers/phyto", notImplemented("GET /registers/phyto"))
  .get("/tracks", async (c) => {
    const q = trackQuery(c);
    if ("error" in q) return problem(c, 400, "Paramètres invalides", q.error);
    const toleranceM = Number(c.req.query("tolerance") ?? 2);
    const track = await trackReplay(db(), c.get("farmId"), { ...q, toleranceM });
    if ((c.req.query("format") ?? "json") === "czml") {
      return c.json(toCzml(track, c.req.query("name") ?? "Matériel"));
    }
    return c.json(track);
  })
  .get("/tracks/coverage", async (c) => {
    const q = trackQuery(c);
    if ("error" in q) return problem(c, 400, "Paramètres invalides", q.error);
    const coverage = await trackCoverage(db(), c.get("farmId"), {
      ...q,
      defaultWidthM: Number(c.req.query("width") ?? 3),
      maxGapS: Number(c.req.query("maxGap") ?? 30),
    });
    return c.json(coverage);
  })
  .get("/terrain/heightmap/:z/:x/:y", notImplemented("GET /terrain/heightmap"))
  .get("/sync/pull", notImplemented("GET /sync/pull"))
  .post("/sync/push", notImplemented("POST /sync/push"))
  .post("/imports/ekylibre", notImplemented("POST /imports/ekylibre"))
  .get("/imports/:id", notImplemented("GET /imports/:id"));
