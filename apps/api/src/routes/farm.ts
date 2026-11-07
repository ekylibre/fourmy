import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../context.js";
import { parcelRoutes } from "./parcels.js";
import { inventoryRoutes } from "./inventory.js";
import { registerRoutes } from "./registers.js";
import { trackRoutes } from "./tracks.js";
import { interventionRoutes } from "./interventions.js";
import { syncRoutes } from "./sync.js";
import { importRoutes } from "./imports.js";
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
  .route("/", interventionRoutes)
  .route("/", syncRoutes)
  .route("/", importRoutes)
  .get("/terrain/heightmap/:z/:x/:y", notImplemented("GET /terrain/heightmap (agent F)"));
