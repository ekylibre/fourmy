import { Hono } from "hono";
import { priceKind, pricesWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { addPrices, articleSuggestions, deletePrice, ecoContext, listPrices, productSuggestions } from "../repos/prices.js";
import { realizedFacts } from "../repos/eco-previous.js";
import { domainCtx, problem, uuidParam } from "./helpers.js";

/** Prix de la ferme (temps 3, lot E1) : lecture pour les membres, saisie par le responsable. */
export const priceRoutes = new Hono<Env>()
  .get("/prices", async (c) => {
    const kind = c.req.query("kind");
    const parsedKind = kind ? priceKind.safeParse(kind) : null;
    if (parsedKind && !parsedKind.success) return problem(c, 400, "Nature de prix inconnue");
    const at = c.req.query("at") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) return problem(c, 400, "Date au format AAAA-MM-JJ");
    return c.json({ items: await listPrices(db(), c.get("farmId"), { kind: parsedKind?.data, at, history: c.req.query("history") === "1" }) });
  })
  // Repères Lexicon (lot E2) : prix de vente proposés et rendements Agreste, par activité.
  // Prix de référence des intrants (point 142, jeux Lexicon réservés aux adhérents).
  .get("/prices/suggestions/articles", async (c) => c.json(await articleSuggestions(db(), c.get("farmId"))))
  .get("/prices/suggestions/products", async (c) => c.json(await productSuggestions(db(), c.get("farmId"))))
  // Contexte économique d'une campagne d'assolement (lot E3) : défauts de rendement et de prix par activité.
  .get("/crop-plans/:year/eco-context", async (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return problem(c, 400, "Campagne invalide");
    return c.json(await ecoContext(db(), c.get("farmId"), year));
  })
  // Faits réalisés de la campagne précédente (lot E5) : récoltes, interventions, intrants, heures.
  .get("/crop-plans/:year/eco-previous", async (c) => {
    const year = Number(c.req.param("year"));
    if (!Number.isInteger(year) || year < 2001 || year > 2100) return problem(c, 400, "Campagne invalide");
    return c.json(await realizedFacts(db(), c.get("farmId"), year - 1));
  })
  .post("/prices", requireOwner, async (c) => {
    const parsed = pricesWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" "));
    const ctx = domainCtx(c);
    return c.json({ items: await addPrices(db(), c.get("farmId"), parsed.data.items, c.get("userId"), ctx.newId) }, 201);
  })
  .delete("/prices/:id", requireOwner, async (c) => {
    await deletePrice(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
