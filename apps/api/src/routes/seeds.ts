import { Hono } from "hono";
import { lotSeedWrite, seedSheetSave } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { getSeed, listSeeds, saveLotSeed, saveSeed, seedSpecies } from "../repos/seeds.js";
import { atOrNow, problem, uuidParam } from "./helpers.js";

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ");

/**
 * Semences (lot SE3, claudedocs/conception_semences.md §4) : liste et fiche
 * pour les membres ; fiche et PMG des lots écrits par le responsable. Le
 * statut bio et le traitement passent par PUT /articles/:id/organic.
 */
export const seedRoutes = new Hono<Env>()
  .get("/seeds", async (c) => c.json({ items: await listSeeds(db(), c.get("farmId"), atOrNow(c)) }))
  .get("/seeds/species", async (c) => c.json({ items: await seedSpecies(db(), c.get("farmId")) }))
  .get("/articles/:id/seed", async (c) => c.json(await getSeed(db(), c.get("farmId"), uuidParam(c, "id"), atOrNow(c))))
  .put("/articles/:id/seed", requireOwner, async (c) => {
    const parsed = seedSheetSave.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveSeed(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data, atOrNow(c)));
  })
  .put("/lots/:id/seed", requireOwner, async (c) => {
    const parsed = lotSeedWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveLotSeed(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data, atOrNow(c)));
  })
  .delete("/lots/:id/seed", requireOwner, async (c) => c.json(await saveLotSeed(db(), c.get("farmId"), uuidParam(c, "id"), null, atOrNow(c))));
