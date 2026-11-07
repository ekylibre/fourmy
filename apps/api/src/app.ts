import { Hono } from "hono";
import { auth, farmScope, type Env } from "./context.js";
import { farmRoutes } from "./routes/farm.js";

/**
 * Application Fourmy API. Montée OpenAPI complète (@hono/zod-openapi) à
 * brancher par l'agent 0 sur les schémas de @fourmy/contracts ; ici le
 * squelette expose santé + arbre de routes métier sous garde d'auth + ferme.
 */
export function createApp() {
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ status: "ok", service: "fourmy-api" }));

  app.route(
    "/api/v1/farms/:farmId",
    new Hono<Env>().use(auth).use(farmScope).route("/", farmRoutes),
  );

  app.notFound((c) =>
    c.json({ type: "about:blank", title: "Not Found", status: 404 }, 404, {
      "content-type": "application/problem+json",
    }),
  );

  return app;
}
