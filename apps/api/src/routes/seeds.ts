import { Hono } from "hono";
import { lotSeedWrite, seedAttachWrite, seedCreate, seedSheetSave } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { attachSeeds, createSeed, searchCatalog, seedAttachProposals } from "../repos/seed-catalog.js";
import { getSeed, listSeeds, saveLotSeed, saveSeed, seedSpecies } from "../repos/seeds.js";
import { atOrNow, problem, uuidParam } from "./helpers.js";

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ");

/**
 * Semences (lot SE3, claudedocs/conception_semences.md §4) : liste et fiche
 * pour les membres ; fiche et PMG des lots écrits par le responsable. Le
 * statut bio et le traitement passent par PUT /articles/:id/organic.
 * Lot SE4 : recherche au catalogue GNIS, création, rattachement proposé.
 */
export const seedRoutes = new Hono<Env>()
  .get("/seeds", async (c) => c.json({ items: await listSeeds(db(), c.get("farmId"), atOrNow(c)) }))
  .get("/seeds/species", async (c) => c.json({ items: await seedSpecies(db(), c.get("farmId")) }))
  .get("/seeds/catalog", async (c) => c.json({ items: await searchCatalog(db(), c.get("farmId"), c.req.query("q") ?? "", c.req.query("species") || undefined) }))
  .post("/seeds", requireOwner, async (c) => {
    const parsed = seedCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await createSeed(db(), c.get("farmId"), c.get("userId"), parsed.data, atOrNow(c)), 201);
  })
  .get("/seeds/attach", async (c) => c.json({ items: await seedAttachProposals(db(), c.get("farmId")) }))
  .post("/seeds/attach", requireOwner, async (c) => {
    const parsed = seedAttachWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json({ items: await attachSeeds(db(), c.get("farmId"), c.get("userId"), parsed.data.articleIds) });
  })
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
