import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../context.js";
import { parcelRoutes } from "./parcels.js";
import { inventoryRoutes } from "./inventory.js";
import { registerRoutes } from "./registers.js";
import { trackRoutes } from "./tracks.js";
import { problem } from "./helpers.js";

/**
 * Routes métier sous `/api/v1/farms/:farmId` (architecture §5.1), découpées
 * par domaine. Les routes encore déclarées en 501 indiquent l'agent attendu.
 */
const notImplemented = (what: string) => (c: Context<Env>) =>
  problem(c, 501, "Not Implemented", `${what} — à implémenter (docs/workflow.md)`);

export const farmRoutes = new Hono<Env>()
  .route("/", parcelRoutes)
  .route("/", inventoryRoutes)
  .route("/", registerRoutes)
  .route("/", trackRoutes)
  .get("/interventions", notImplemented("GET /interventions"))
  .post("/interventions", notImplemented("POST /interventions"))
  .post("/interventions/:id/complete", notImplemented("POST /interventions/:id/complete"))
  .get("/terrain/heightmap/:z/:x/:y", notImplemented("GET /terrain/heightmap (agent F)"))
  .get("/sync/pull", notImplemented("GET /sync/pull"))
  .post("/sync/push", notImplemented("POST /sync/push"))
  .post("/imports/ekylibre", notImplemented("POST /imports/ekylibre"))
  .get("/imports/:id", notImplemented("GET /imports/:id"));
