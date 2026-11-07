import { Hono } from "hono";
import { z } from "zod";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { startImport, getImport, ImportsNotConfigured } from "../repos/imports.js";
import { problem, uuidParam } from "./helpers.js";

const importWrite = z.object({ sourceDatabase: z.string() });

/** Tâches d'import suivies (pour les tests : attendre la fin d'un import). */
export const pendingImports = new Set<Promise<unknown>>();

/** Imports Ekylibre (owner uniquement) : lancement asynchrone et suivi. */
export const importRoutes = new Hono<Env>()
  .post("/imports/ekylibre", requireOwner, async (c) => {
    const parsed = importWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", "sourceDatabase attendu");
    try {
      const run = await startImport(db(), c.get("farmId"), parsed.data, (p) => {
        pendingImports.add(p);
        void p.finally(() => pendingImports.delete(p));
      });
      return c.json(run, 202, { location: `imports/${run.id}` });
    } catch (e) {
      if (e instanceof ImportsNotConfigured) return problem(c, 503, "Service indisponible", e.message);
      throw e;
    }
  })
  .get("/imports/:id", async (c) => c.json(await getImport(db(), c.get("farmId"), uuidParam(c, "id"))));
