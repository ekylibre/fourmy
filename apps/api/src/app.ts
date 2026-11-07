import { Hono } from "hono";
import { DomainError } from "@fourmy/domain";
import { auth, farmScope, type Env } from "./context.js";
import { farmRoutes } from "./routes/farm.js";
import { meRoutes } from "./routes/me.js";
import { BadRequest, NotFound, Conflict } from "./routes/helpers.js";

/**
 * Application Fourmy API. Garde : authentification, puis appartenance à la
 * ferme (rôle owner/worker). Erreurs typées converties en problem+json.
 */
export function createApp() {
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ status: "ok", service: "fourmy-api" }));

  app.route("/api/v1/me", new Hono<Env>().use(auth).route("/", meRoutes));
  app.route("/api/v1/farms/:farmId", new Hono<Env>().use(auth).use(farmScope).route("/", farmRoutes));

  const problem = (status: number, title: string, detail?: string) =>
    new Response(JSON.stringify({ type: "about:blank", title, status, detail }), {
      status,
      headers: { "content-type": "application/problem+json" },
    });

  app.onError((err) => {
    if (err instanceof BadRequest) return problem(400, "Requête invalide", err.message);
    if (err instanceof NotFound) return problem(404, "Introuvable", err.message);
    if (err instanceof Conflict) return problem(409, "Conflit", err.message);
    if (err instanceof DomainError) return problem(422, "Règle métier", err.message);
    console.error(err);
    return problem(500, "Erreur interne");
  });

  app.notFound(() => problem(404, "Not Found"));

  return app;
}
