import { Hono } from "hono";
import { fertilizerWrite, productAnalysisWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import { addProductAnalysis, clearFertilizer, getFertilizer, listFertilizers, removeProductAnalysis, saveFertilizer } from "../repos/fertilizers.js";
import { problem, uuidParam } from "./helpers.js";

const invalid = (issues: { message: string; path: PropertyKey[] }[]) => issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ");

/**
 * Fertilisants (lot AE) : composition et analyses. Lecture pour les membres
 * (la saisie d'un apport affiche l'azote apporté) ; écriture pour le responsable.
 */
export const fertilizerRoutes = new Hono<Env>()
  .get("/fertilizers", async (c) => c.json({ items: await listFertilizers(db(), c.get("farmId")) }))
  .get("/articles/:id/fertilizer", async (c) => c.json(await getFertilizer(db(), c.get("farmId"), uuidParam(c, "id"))))
  .put("/articles/:id/fertilizer", requireOwner, async (c) => {
    const parsed = fertilizerWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await saveFertilizer(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data));
  })
  .delete("/articles/:id/fertilizer", requireOwner, async (c) => c.json(await clearFertilizer(db(), c.get("farmId"), uuidParam(c, "id"))))
  .post("/articles/:id/analyses", requireOwner, async (c) => {
    const parsed = productAnalysisWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", invalid(parsed.error.issues));
    return c.json(await addProductAnalysis(db(), c.get("farmId"), c.get("userId"), uuidParam(c, "id"), parsed.data), 201);
  })
  .delete("/articles/:id/analyses/:analysisId", requireOwner, async (c) =>
    c.json(await removeProductAnalysis(db(), c.get("farmId"), uuidParam(c, "id"), uuidParam(c, "analysisId"))),
  );
