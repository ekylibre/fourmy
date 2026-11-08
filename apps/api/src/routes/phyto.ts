import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withFarm } from "@fourmy/db";
import { interventionPlanWrite, phytoArticleCreate, phytoArticleLink } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { checkComplianceFor, farmWater, parcelDelays, phytoArticles, phytoStatus, searchProducts, syncFarmWater } from "../repos/phyto.js";
import { readIntervention } from "../repos/interventions.js";
import { computeInterventionIft, iftBalance } from "../repos/ift.js";
import { interventionWeather, sprayingForecast } from "../repos/weather.js";
import { workPeriod, interventionTarget } from "@fourmy/contracts";
import { BadRequest, NotFound, problem, uuidParam } from "./helpers.js";

const checkWrite = interventionPlanWrite.extend({ interventionId: z.string().uuid().optional() });
const weatherWrite = z.object({
  periods: z.array(workPeriod).default([]),
  plannedAt: z.string().datetime({ offset: true }).optional(),
  targets: z.array(interventionTarget).default([]),
});

/**
 * Réglementation phytosanitaire (lot 2) : contrôle à la demande (formulaire),
 * état du référentiel et de l'eau, recherche de produits E-Phy, articles
 * créés ou rattachés depuis le référentiel.
 */
export const phytoRoutes = new Hono<Env>()
  .post("/phyto/check", async (c) => {
    const parsed = checkWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const { interventionId, ...body } = parsed.data;
    return c.json(await checkComplianceFor(db(), c.get("farmId"), body, interventionId ?? null));
  })
  // Contrôle d'une intervention enregistrée, à sa date (reprises d'Ekylibre comprises).
  .get("/interventions/:id/compliance", async (c) => {
    const id = uuidParam(c, "id");
    const farmId = c.get("farmId");
    const i = await withFarm(db(), farmId, (tx) => readIntervention(tx, id));
    const stored = i.compliance ?? null;
    const live = await checkComplianceFor(
      db(),
      farmId,
      {
        procedure: i.procedure,
        periods: i.periods,
        targets: i.targets,
        inputs: i.inputs,
        plannedAt: i.startedAt ?? undefined,
        compliance: { usages: Object.fromEntries((stored?.checks ?? []).filter((k) => k.usageId).map((k) => [k.articleId, k.usageId!])) },
      },
      id,
    );
    return c.json({ ...live, reason: stored?.reason ?? null });
  })
  // IFT d'une intervention réalisée, calculé maintenant (sinon le worker s'en charge).
  .post("/interventions/:id/ift", async (c) => c.json(await computeInterventionIft(db(), c.get("farmId"), uuidParam(c, "id"))))
  .get("/phyto/ift", async (c) => {
    const year = Number(c.req.query("campaign"));
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new BadRequest("campaign : année attendue (ex. 2025)");
    return c.json(await iftBalance(db(), c.get("farmId"), year));
  })
  .get("/phyto/articles", async (c) => c.json({ items: await phytoArticles(db(), c.get("farmId")) }))
  .get("/phyto/parcels/:id/delays", async (c) => {
    const at = c.req.query("at") ? new Date(c.req.query("at")!) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequest("at : date ISO attendue");
    return c.json(await parcelDelays(db(), c.get("farmId"), uuidParam(c, "id"), at.toISOString()));
  })
  // Météo (lot 3) : pré-remplissage d'une intervention, créneaux de pulvérisation.
  .post("/weather/intervention", async (c) => {
    const parsed = weatherWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    try {
      return c.json({ weather: await interventionWeather(db(), c.get("farmId"), parsed.data) });
    } catch (e) {
      return problem(c, 502, "Météo indisponible", e instanceof Error ? e.message : String(e));
    }
  })
  .get("/weather/spraying", async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 3) || 3, 1), 5);
    try {
      return c.json(await sprayingForecast(db(), c.get("farmId"), days));
    } catch (e) {
      return problem(c, 502, "Météo indisponible", e instanceof Error ? e.message : String(e));
    }
  })
  .get("/phyto/status", async (c) => c.json(await phytoStatus(db(), c.get("farmId"))))
  .get("/phyto/products", async (c) => c.json({ items: await searchProducts(db(), c.get("farmId"), c.req.query("q") ?? "") }))
  .get("/phyto/water", async (c) => c.json(await farmWater(db(), c.get("farmId"))))
  .post("/phyto/water/sync", requireOwner, async (c) => {
    const r = await syncFarmWater(db(), c.get("farmId"));
    if (r.error) return problem(c, 502, "Données d'eau indisponibles", r.error);
    return c.json(r);
  })
  // Créer un article phyto depuis le référentiel (nom, n° AMM).
  .post("/articles/phyto", requireOwner, async (c) => {
    const parsed = phytoArticleCreate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const farmId = c.get("farmId");
    const article = await withFarm(db(), farmId, async (tx) => {
      const [p] = (await tx.execute(sql`SELECT amm, name FROM phyto_products WHERE id = ${parsed.data.productId}`)) as unknown as { amm: string; name: string }[];
      if (!p) throw new NotFound("Produit absent du référentiel.");
      const id = crypto.randomUUID();
      const rows = (await tx.execute(sql`
        INSERT INTO articles (id, farm_id, lexicon_ref, name, kind, unit, amm)
        VALUES (${id}, ${farmId}, ${`phyto:${parsed.data.productId}`}, ${parsed.data.name ?? p.name}, 'phyto', ${parsed.data.unit}, ${p.amm})
        RETURNING id, name, kind, unit, amm`)) as unknown as Record<string, unknown>[];
      return rows[0];
    });
    return c.json(article, 201);
  })
  // Rattacher un article existant à son n° AMM (articles repris sans AMM ou avec un AMM erroné).
  .patch("/articles/:id/amm", requireOwner, async (c) => {
    const parsed = phytoArticleLink.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.message);
    const id = uuidParam(c, "id");
    const updated = await withFarm(db(), c.get("farmId"), async (tx) => {
      const [p] = (await tx.execute(sql`SELECT id FROM phyto_products WHERE amm = ${parsed.data.amm} LIMIT 1`)) as unknown as { id: number }[];
      if (!p) throw new BadRequest(`n° AMM ${parsed.data.amm} absent du référentiel E-Phy.`);
      return (await tx.execute(sql`
        UPDATE articles SET amm = ${parsed.data.amm}, lexicon_ref = ${`phyto:${p.id}`}, updated_at = now()
        WHERE id = ${id} AND kind = 'phyto' RETURNING id, name, kind, unit, amm`)) as unknown as Record<string, unknown>[];
    });
    if (!updated.length) throw new NotFound("Article phyto introuvable.");
    return c.json(updated[0]);
  });
