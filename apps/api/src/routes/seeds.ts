import { Hono } from "hono";
import { lotSeedWrite, mixtureComponentsSave, seedAttachWrite, seedCreate, seedSheetSave, seedUnitRewriteWrite, seedUsageBy } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { attachSeeds, createSeed, searchCatalog, seedAttachProposals } from "../repos/seed-catalog.js";
import { getSeed, listSeeds, saveLotSeed, saveMixtureComponents, saveSeed, seedMixture, seedSpecies } from "../repos/seeds.js";
import { seedUsage, seedUsageCsv } from "../repos/seed-usage.js";
import { rewriteSeedUnits, seedUnitRewrites } from "../repos/seed-units.js";
import { atOrNow, BadRequest, problem, uuidParam } from "./helpers.js";

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ");

/**
 * Semences (lot SE3, claudedocs/conception_semences.md §4) : liste et fiche
 * pour les membres ; fiche et PMG des lots écrits par le responsable. Le
 * statut bio et le traitement passent par PUT /articles/:id/organic.
 * Lot SE4 : recherche au catalogue GNIS, création, rattachement proposé.
 */
export const seedRoutes = new Hono<Env>()
  .get("/seeds", async (c) => c.json({ items: await listSeeds(db(), c.get("farmId"), atOrNow(c)) }))
  // Utilisation par campagne (lot SE7) : réalisé et prévu, par semence ou par espèce ; JSON ou CSV.
  .get("/seeds/usage", async (c) => {
    const campaign = Number(c.req.query("campaign") ?? new Date().getFullYear());
    if (!Number.isInteger(campaign) || campaign < 2000 || campaign > 2100) throw new BadRequest("campaign : année attendue.");
    const by = seedUsageBy.safeParse(c.req.query("by") ?? "article");
    if (!by.success) throw new BadRequest("by : article ou species.");
    const usage = await seedUsage(db(), c.get("farmId"), campaign, by.data);
    if (c.req.query("format") === "csv") {
      return c.body(seedUsageCsv(usage), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="semences-${campaign}${by.data === "species" ? "-par-espece" : ""}.csv"`,
      });
    }
    return c.json(usage);
  })
  .get("/seeds/species", async (c) => c.json({ items: await seedSpecies(db(), c.get("farmId")) }))
  .get("/seeds/catalog", async (c) => c.json({ items: await searchCatalog(db(), c.get("farmId"), c.req.query("q") ?? "", c.req.query("species") || undefined) }))
  .post("/seeds", requireOwner, async (c) => {
    const parsed = seedCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await createSeed(db(), c.get("farmId"), c.get("userId"), parsed.data, atOrNow(c)), 201);
  })
  // Unités reprises (issue #130) : propositions pour les membres, réécriture par le responsable.
  .get("/seeds/units", async (c) => c.json({ items: await seedUnitRewrites(db(), c.get("farmId")) }))
  .post("/seeds/units", requireOwner, async (c) => {
    const parsed = seedUnitRewriteWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await rewriteSeedUnits(db(), c.get("farmId"), c.get("userId"), parsed.data));
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
  // Mélanges (lot SE6) : espèces, et doses du dernier semis proposées à la saisie.
  .put("/articles/:id/seed/components", requireOwner, async (c) => {
    const parsed = mixtureComponentsSave.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveMixtureComponents(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data.components, atOrNow(c)));
  })
  .get("/articles/:id/seed/mixture", async (c) => c.json(await seedMixture(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/lots/:id/seed", requireOwner, async (c) => {
    const parsed = lotSeedWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveLotSeed(db(), c.get("farmId"), uuidParam(c, "id"), parsed.data, atOrNow(c)));
  })
  .delete("/lots/:id/seed", requireOwner, async (c) => c.json(await saveLotSeed(db(), c.get("farmId"), uuidParam(c, "id"), null, atOrNow(c))));
