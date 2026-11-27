import { Hono } from "hono";
import { oauthConsent, oauthFarmChoice } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { getAuth, publicOrigin } from "../auth.js";
import { db } from "../db.js";
import { appMailer } from "../mail.js";
import { chooseOAuthFarm, clearOAuthFarm, dropOAuthAccess, notifyOwnersOfNewApp, oauthRequestInfo, recordOAuthConsent } from "../repos/oauth.js";
import { BadRequest, problem } from "./helpers.js";

/**
 * Pages web de l'autorisation OAuth (lot AM5) : `/oauth/ferme` puis
 * `/oauth/consentement`. Réservé à une session : ni clé ni jeton OAuth.
 */
const session = (c: { get: (k: "userId" | "sessionId") => string | null }) => {
  const sessionId = c.get("sessionId");
  return sessionId ? { userId: c.get("userId")!, sessionId } : null;
};

/**
 * Appel d'un point du plugin par son gestionnaire HTTP, avec la session de la
 * requête (cookie ou jeton) : ses points attendent une vraie requête.
 * Renvoie l'adresse suivante, relative ou absolue, que le web suit telle quelle.
 */
async function plugin(from: Headers, path: "/oauth2/continue" | "/oauth2/consent", body: Record<string, unknown>) {
  const headers = new Headers({ "content-type": "application/json", origin: publicOrigin() });
  for (const h of ["cookie", "authorization"]) if (from.get(h)) headers.set(h, from.get(h)!);
  const res = await getAuth().handler(new Request(`${publicOrigin()}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  const data = (await res.json().catch(() => null)) as { url?: string; error_description?: string; message?: string } | null;
  if (!res.ok || !data?.url) throw new BadRequest(data?.error_description ?? data?.message ?? "Autorisation interrompue : recommencez depuis l'application.");
  return { url: data.url };
}

export const oauthRoutes = new Hono<Env>()
  .get("/request", async (c) => {
    const s = session(c);
    if (!s) return problem(c, 403, "Accès refusé", "Connexion par le navigateur requise.");
    const q = c.req.query("q");
    if (!q) return problem(c, 400, "Requête invalide", "Paramètre q manquant.");
    return c.json(await oauthRequestInfo(db(), s, q));
  })
  .post("/farm", async (c) => {
    const s = session(c);
    if (!s) return problem(c, 403, "Accès refusé", "Connexion par le navigateur requise.");
    const parsed = oauthFarmChoice.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    await chooseOAuthFarm(db(), s, parsed.data.farmId);
    return c.json(await plugin(c.req.raw.headers, "/oauth2/continue", { postLogin: true, oauth_query: parsed.data.oauthQuery }));
  })
  .post("/consent", async (c) => {
    const s = session(c);
    if (!s) return problem(c, 403, "Accès refusé", "Connexion par le navigateur requise.");
    const parsed = oauthConsent.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 400, "Corps invalide", parsed.error.issues[0]?.message);
    const body = parsed.data;
    const headers = c.req.raw.headers;
    if (!body.accept) {
      const r = await plugin(headers, "/oauth2/consent", { accept: false, oauth_query: body.oauthQuery });
      await clearOAuthFarm(db(), s);
      return c.json(r);
    }
    const rec = await recordOAuthConsent(db(), s, body.oauthQuery, body.grant);
    let r: { url: string };
    try {
      r = await plugin(headers, "/oauth2/consent", { accept: true, oauth_query: body.oauthQuery });
    } catch (e) {
      if (rec.created) await dropOAuthAccess(db(), rec.farmId, rec.created);
      throw e;
    }
    await clearOAuthFarm(db(), s);
    if (rec.first) {
      const user = c.get("user");
      const appUrl = process.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
      void notifyOwnersOfNewApp(db(), appMailer(), { farmId: rec.farmId, appName: rec.app.name, grant: rec.grant, userName: user.name ?? user.email, appUrl }).catch(
        (e: unknown) => console.error("[oauth] e-mail :", e),
      );
    }
    return c.json(r);
  });
