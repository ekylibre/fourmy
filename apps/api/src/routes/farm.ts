import { Hono } from "hono";
import type { Env } from "../context.js";

/**
 * Routes métier sous `/api/v1/farms/:farmId` (architecture §5.1).
 * Déclarées et typées ici, renvoient **501** jusqu'à leur implémentation :
 *   - snapshot, land-parcels, places, containers, stock → agent D
 *   - interventions, registers, sync, imports → agent D (domaine agent A)
 *   - tracks → agent C · terrain → agent F
 * L'agent 0 fige les chemins ; chaque agent remplit les siens dans sa PR.
 */
const notImplemented = (what: string) => (c: import("hono").Context<Env>) =>
  c.json(
    {
      type: "about:blank",
      title: "Not Implemented",
      status: 501,
      detail: `${what} — à implémenter (voir docs/workflow.md)`,
    },
    501,
    { "content-type": "application/problem+json" },
  );

export const farmRoutes = new Hono<Env>()
  // État consolidé
  .get("/snapshot", notImplemented("GET /snapshot"))
  // Parcellaire
  .get("/land-parcels", notImplemented("GET /land-parcels"))
  .post("/land-parcels", notImplemented("POST /land-parcels"))
  .patch("/land-parcels/:id", notImplemented("PATCH /land-parcels/:id"))
  // Bâtiments et cuves
  .get("/places", notImplemented("GET /places"))
  .get("/containers", notImplemented("GET /containers"))
  .patch("/containers/:id/placement", notImplemented("PATCH /containers/:id/placement"))
  .get("/containers/:id/contents", notImplemented("GET /containers/:id/contents"))
  // Stocks
  .get("/stock", notImplemented("GET /stock"))
  // Interventions
  .get("/interventions", notImplemented("GET /interventions"))
  .post("/interventions", notImplemented("POST /interventions"))
  .post("/interventions/:id/complete", notImplemented("POST /interventions/:id/complete"))
  // Registres
  .get("/registers/phyto", notImplemented("GET /registers/phyto"))
  // Traces (agent C)
  .get("/tracks", notImplemented("GET /tracks"))
  .get("/tracks/coverage", notImplemented("GET /tracks/coverage"))
  // Terrain 3D (agent F)
  .get("/terrain/heightmap/:z/:x/:y", notImplemented("GET /terrain/heightmap"))
  // Synchro mobile (agent D / G)
  .get("/sync/pull", notImplemented("GET /sync/pull"))
  .post("/sync/push", notImplemented("POST /sync/push"))
  // Migration (admin, agent B)
  .post("/imports/ekylibre", notImplemented("POST /imports/ekylibre"))
  .get("/imports/:id", notImplemented("GET /imports/:id"));
