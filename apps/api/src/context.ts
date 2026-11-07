import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

/**
 * Variables de contexte posées par les middlewares et lues par les routes.
 */
export type Env = {
  Variables: {
    userId: string;
    farmId: string;
  };
};

/**
 * Authentification — **squelette**. À remplacer par better-auth (ADR-14) :
 * comptes locaux en auto-hébergé, OIDC vers le SSO commun en SaaS.
 * En attendant, lit un en-tête `x-user-id` pour débloquer le développement.
 */
export const auth: MiddlewareHandler<Env> = createMiddleware<Env>(
  async (c, next) => {
    const userId = c.req.header("x-user-id");
    if (!userId) {
      return c.json(
        { type: "about:blank", title: "Unauthorized", status: 401 },
        401,
        { "content-type": "application/problem+json" },
      );
    }
    c.set("userId", userId);
    await next();
  },
);

/**
 * Résout la ferme depuis l'URL (`/farms/:farmId`) et la pose dans le
 * contexte. L'accès réel (appartenance) et le `SET LOCAL fourmy.farm_id`
 * seront ajoutés par l'agent D avec `withFarm()` de @fourmy/db.
 */
export const farmScope: MiddlewareHandler<Env> = createMiddleware<Env>(
  async (c, next) => {
    const farmId = c.req.param("farmId");
    if (!farmId) {
      return c.json(
        { type: "about:blank", title: "farmId manquant", status: 400 },
        400,
        { "content-type": "application/problem+json" },
      );
    }
    c.set("farmId", farmId);
    await next();
  },
);
