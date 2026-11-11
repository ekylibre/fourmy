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
import { agrirouterConfig, completeAgrirouterConnect, startAgrirouterConnect } from "../integrations/agrirouter.js";
import { BadRequest, problem, uuidParam } from "./helpers.js";

/** Catalogue avec la disponibilité des fournisseurs connectés par consentement (configuration du serveur). */
const catalogue = () =>
  INTEGRATION_PROVIDERS.map((p) => (p.connect === "oauth" ? { ...p, available: p.provider === "agrirouter" && agrirouterConfig() !== null } : p));

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
    c.json({ providers: catalogue(), items: await listIntegrations(db(), c.get("farmId")) }),
  )
  // agrirouter : consentement dans le compte agrirouter de la ferme, puis retour sur le web.
  .post("/integrations/agrirouter/connect", async (c) => c.json(await startAgrirouterConnect(db(), c.get("farmId"))))
  .post("/integrations/agrirouter/complete", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { state?: unknown; tenantId?: unknown };
    if (typeof body.state !== "string" || body.state.length > 512 || typeof body.tenantId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.tenantId)) {
      throw new BadRequest("state et tenantId attendus.");
    }
    const farmId = c.get("farmId");
    await completeAgrirouterConnect(db(), farmId, { state: body.state, tenantId: body.tenantId });
    // Première lecture des destinataires dans la foulée (en arrière-plan).
    const [integ] = (await listIntegrations(db(), farmId)).filter((i) => i.provider === "agrirouter");
    if (integ) {
      const run = syncIntegration(db(), farmId, integ.id);
      pendingSyncs.add(run);
      void run.catch(() => undefined).finally(() => pendingSyncs.delete(run));
    }
    return c.json({ items: await listIntegrations(db(), farmId) });
  })
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
    const { remoteError } = await removeIntegration(db(), c.get("farmId"), uuidParam(c, "id"));
    return remoteError ? c.json({ remoteError }) : c.body(null, 204);
  });
