import { Hono } from "hono";
import { DomainError } from "@fourmy/domain";
import { ImportFileError } from "@fourmy/importers";
import { auth, externalGuard, farmScope, type Env } from "./context.js";
import { externalAudit } from "./external/audit.js";
import { getAuth } from "./auth.js";
import { contactRoutes } from "./contact.js";
import { farmRoutes } from "./routes/farm.js";
import { meRoutes } from "./routes/me.js";
import { invitationRoutes } from "./routes/invitations.js";
import { oauthRoutes } from "./routes/oauth.js";
import { mcpHandler } from "./mcp/server.js";
import { readPicture } from "./repos/activities.js";
import { db } from "./db.js";
import { BadRequest, NotFound, Conflict } from "./routes/helpers.js";
import { openApiDocument } from "./external/openapi.js";
import { narrowRegistration } from "./external/registration.js";

/**
 * Application Fourmy API. Garde : authentification, puis appartenance à la
 * ferme (rôle owner/worker). Erreurs typées converties en problem+json.
 */
export function createApp() {
  const app = new Hono<Env>();

  // Version calculée depuis l'historique (packages/release), injectée à la construction.
  app.get("/health", (c) => c.json({ status: "ok", service: "fourmy-api", version: process.env.FOURMY_VERSION ?? "dev" }));

  // Points d'entrée publics du site fourmy.org (sans session).
  app.route("/api/public", contactRoutes);

  // Connexion, déconnexion, session (better-auth), et serveur d'autorisation OAuth (lot AM5).
  // Enregistrement dynamique d'un client : sans écriture s'il ne l'a pas demandée (lot AM7).
  app.post("/api/auth/oauth2/register", (c) => narrowRegistration(c.req.raw, (r) => getAuth().handler(r)));
  app.on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw));
  // Métadonnées OAuth à la racine du site (RFC 8414, RFC 9728) : servies par better-auth.
  app.get("/.well-known/*", (c) => getAuth().handler(c.req.raw));
  // Serveur MCP (lot AM6) : ses outils appellent /api/v1 par cette même application.
  const mcp = mcpHandler((request) => Promise.resolve(app.fetch(request)));
  app.all("/mcp", (c) => mcp(c.req.raw));

  // Images du référentiel Lexicon (activités, variétés) : données publiques, sans session.
  app.get("/api/v1/lexicon/pictures/:domain/:name", async (c) => {
    const { domain, name } = c.req.param();
    if (!/^(varieties|activity_families)$/.test(domain) || !/^[a-z0-9_]{1,80}$/.test(name)) return c.notFound();
    const pic = await readPicture(db(), domain, name);
    if (!pic) return c.notFound();
    return c.body(pic.bytes as unknown as ArrayBuffer, 200, { "content-type": pic.type, "cache-control": "public, max-age=604800" });
  });
  // Description OpenAPI de l'API ouverte (lot AM7) : publique, lisible par tout outil.
  app.get("/api/v1/openapi.json", (c) => c.json(openApiDocument(), 200, { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" }));
  // Invitations (lot P3) : lues et acceptées par leur jeton, avant toute ferme.
  app.route("/api/v1/invitations", invitationRoutes);
  app.route("/api/v1/me", new Hono<Env>().use(auth).route("/", meRoutes));
  app.route("/api/v1/oauth", new Hono<Env>().use(auth).route("/", oauthRoutes));
  app.route("/api/v1/farms/:farmId", new Hono<Env>().use(auth).use(farmScope).use(externalAudit).use(externalGuard).route("/", farmRoutes));

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
    if (err instanceof ImportFileError) return problem(422, "Fichier refusé", err.message);
    // Contrainte d'unicité (ex. un compte déjà rattaché à une autre personne).
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return problem(409, "Conflit", "Cet élément existe déjà.");
    console.error(err);
    return problem(500, "Erreur interne");
  });

  app.notFound(() => problem(404, "Not Found"));

  return app;
}
