import { Hono } from "hono";
import { INTEGRATION_PROVIDERS, integrationProvider, integrationWrite } from "@fourmy/contracts";
import { requireOwner, type Env } from "../context.js";
import { db } from "../db.js";
import {
  configureIntegration,
  listIntegrations,
  removeIntegration,
  syncIntegration,
} from "../integrations/repo.js";
import { BadRequest, problem, uuidParam } from "./helpers.js";

/** Synchros lancées depuis l'API (les tests attendent leur fin). */
export const pendingSyncs = new Set<Promise<unknown>>();

/**
 * Intégrations de la ferme — réservées au responsable : elles portent des
 * accès à des services externes. Le secret n'est jamais renvoyé.
 */
export const integrationRoutes = new Hono<Env>()
  .use("/integrations/*", requireOwner)
  .use("/integrations", requireOwner)
  .get("/integrations", async (c) =>
    c.json({ providers: INTEGRATION_PROVIDERS, items: await listIntegrations(db(), c.get("farmId")) }),
  )
  .put("/integrations/:provider", async (c) => {
    const provider = integrationProvider.safeParse(c.req.param("provider"));
    if (!provider.success) throw new BadRequest("Fournisseur d'intégration inconnu.");
    const parsed = integrationWrite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues.map((i) => i.message).join(" "));
    return c.json(await configureIntegration(db(), c.get("farmId"), provider.data, parsed.data));
  })
  .post("/integrations/:id/sync", async (c) => {
    const id = uuidParam(c, "id");
    const farmId = c.get("farmId");
    const run = syncIntegration(db(), farmId, id);
    pendingSyncs.add(run);
    void run.catch(() => undefined).finally(() => pendingSyncs.delete(run));
    // Verrou, conflit et erreurs de configuration arrivent tout de suite (rejet
    // relayé en problem+json) ; une longue reprise d'historique continue en
    // arrière-plan et l'état se suit par GET /integrations.
    const first = await Promise.race([
      run.then(() => "done" as const),
      new Promise<"running">((resolve) => setTimeout(() => resolve("running"), 300)),
    ]);
    const items = await listIntegrations(db(), farmId);
    return c.json(items.find((i) => i.id === id), first === "done" ? 200 : 202);
  })
  .delete("/integrations/:id", async (c) => {
    await removeIntegration(db(), c.get("farmId"), uuidParam(c, "id"));
    return c.body(null, 204);
  });
