import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { apiResource, mcpResource } from "../src/auth.js";
import { resetRateLimits } from "../src/external/audit.js";
import { declaredClients, syncDeclaredClients } from "../src/external/declared-clients.js";
import { db } from "../src/db.js";
import { addGuest, addMember, setupFarm, teardown } from "./helpers.js";

/**
 * OAuth (lot AM5, conception_api_mcp.md §7.1) : enregistrement dynamique,
 * autorisation avec PKCE, choix de la ferme, consentement avec droits, jeton,
 * appel de l'API, rafraîchissement, révocation.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const REDIRECT = "https://assistant.exemple.test/callback";

type Who = { userId: string; headers: Record<string, string> };

describe.skipIf(!url)("OAuth (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  let other: Awaited<ReturnType<typeof setupFarm>>;
  const vigne = crypto.randomUUID();
  const ble = crypto.randomUUID();
  const clients: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme OAuth");
    other = await setupFarm(sql, "Ferme voisine (OAuth)");
    // Le responsable est aussi membre de la ferme voisine : un consentement n'ouvre qu'une ferme.
    await sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (${crypto.randomUUID()}, ${other.farmId}, ${farm.userId}, 'owner')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${vigne}, ${farm.farmId}, 'Vigne', 'vine_farming'), (${ble}, ${farm.farmId}, 'Blé', 'plant_farming')`;
  });
  beforeEach(() => resetRateLimits());
  afterAll(async () => {
    if (clients.length) await sql`DELETE FROM auth_oauth_clients WHERE client_id IN ${sql(clients)}`;
    await sql`DELETE FROM farms WHERE id = ${other.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId, other.userId, ...users]);
    await sql.end();
  });

  const auth = (path: string, init: RequestInit = {}) => app.request(`/api/auth${path}`, { redirect: "manual", ...init });
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  async function register(scope = "fourmy:read offline_access") {
    const res = await auth("/oauth2/register", json({ client_name: "Assistant d'essai", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope }));
    expect(res.status, await res.clone().text()).toBe(201);
    const c = (await res.json()) as { client_id: string };
    clients.push(c.client_id);
    return c.client_id;
  }

  /** Parcours du navigateur jusqu'au code, puis échange contre les jetons. */
  async function authorize(who: Who, clientId: string, farmId: string, grant: unknown, opts: { scope?: string; resource?: string } = {}) {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const resource = opts.resource ?? apiResource();
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: opts.scope ?? "fourmy:read offline_access", state: "etat", code_challenge: challenge, code_challenge_method: "S256", resource });
    const az = await auth(`/oauth2/authorize?${q}`, { headers: who.headers });
    const toFarm = new URL(az.headers.get("location") ?? "", "http://x");
    expect(toFarm.pathname, `autorisation : ${az.status} ${toFarm.search}`).toBe("/oauth/ferme");
    const oauthQuery = toFarm.search.slice(1);

    const info = await app.request(`/api/v1/oauth/request?q=${encodeURIComponent(oauthQuery)}`, { headers: who.headers });
    expect(info.status, await info.clone().text()).toBe(200);
    const request = await info.json();

    const chosen = await app.request("/api/v1/oauth/farm", json({ farmId, oauthQuery }, who.headers));
    expect(chosen.status, await chosen.clone().text()).toBe(200);
    const toConsent = new URL((await chosen.json()).url, "http://x");
    if (toConsent.pathname !== "/oauth/consentement") return { request, code: toConsent.searchParams.get("code"), verifier, resource, skipped: true };
    const consentQuery = toConsent.search.slice(1);
    const consent = await app.request("/api/v1/oauth/consent", json({ accept: true, grant, oauthQuery: consentQuery }, who.headers));
    expect(consent.status, await consent.clone().text()).toBe(200);
    const back = new URL((await consent.json()).url);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    return { request, code: back.searchParams.get("code"), verifier, resource, skipped: false };
  }

  async function token(clientId: string, a: { code: string | null; verifier: string; resource: string }) {
    const res = await auth("/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: a.code ?? "", redirect_uri: REDIRECT, client_id: clientId, code_verifier: a.verifier, resource: a.resource }).toString(),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { access_token: string; refresh_token: string; scope: string };
  }

  const call = (accessToken: string, path: string, farmId = farm.farmId) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });

  it("métadonnées : serveur d'autorisation et ressource protégée /mcp à la racine", async () => {
    const as = await app.request("/.well-known/oauth-authorization-server/api/auth");
    expect(as.status).toBe(200);
    const meta = await as.json();
    expect(meta.code_challenge_methods_supported).toContain("S256");
    expect(meta.scopes_supported).toEqual(expect.arrayContaining(["fourmy:read", "fourmy:write"]));
    const prm = await app.request("/.well-known/oauth-protected-resource/mcp");
    expect(prm.status).toBe(200);
    expect((await prm.json()).resource).toBe(mcpResource());
  });

  it("parcours complet : ferme, consentement réduit, jeton, appel limité, autre ferme refusée, rafraîchissement", async () => {
    const clientId = await register();
    const a = await authorize(farm, clientId, farm.farmId, { modules: { activities: "read", interventions: "write" }, activities: [vigne] });
    expect(a.request.client.name).toBe("Assistant d'essai");
    expect(a.request.write).toBe(false);
    expect(a.request.farms.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining([farm.farmId, other.farmId]));
    const t = await token(clientId, a);
    expect(t.access_token.split(".")).toHaveLength(3);
    const [, payload] = t.access_token.split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString()).fourmy_farm).toBe(farm.farmId);

    const acts = await call(t.access_token, "/activities");
    expect(acts.status, await acts.clone().text()).toBe(200);
    expect(((await acts.json()).items as { id: string }[]).map((x) => x.id)).toEqual([vigne]);
    expect((await call(t.access_token, "/stock")).status).toBe(403);
    expect((await call(t.access_token, "/activities", other.farmId)).status).toBe(403);
    expect((await app.request("/api/v1/me/farms", { headers: { authorization: `Bearer ${t.access_token}` } })).status).toBe(403);
    // Écriture demandée au consentement : ramenée à la lecture (pas d'écriture avant AM8).
    const [stored] = await sql`SELECT access_grant FROM farm_accesses WHERE oauth_client_id = ${clientId}`;
    expect(stored!.access_grant).toEqual({ modules: { activities: "read", interventions: "read" }, activities: [vigne] });

    const r = await auth("/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId, resource: apiResource() }).toString(),
    });
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await call((await r.json()).access_token, "/activities")).status).toBe(200);
  });

  it("sans session : page de connexion, puis reprise de l'autorisation après connexion", async () => {
    const clientId = await register();
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "fourmy:read", code_challenge: "x".repeat(43), code_challenge_method: "S256", resource: apiResource() });
    const toLogin = new URL((await auth(`/oauth2/authorize?${q}`)).headers.get("location") ?? "", "http://x");
    expect(toLogin.pathname).toBe("/login");
    expect(toLogin.searchParams.get("sig")).toBeTruthy();
    // Ce que fait la page de connexion (oauthResume) : les paramètres d'origine, sans la signature.
    const resume = new URLSearchParams([...toLogin.searchParams].filter(([k]) => k !== "sig" && !k.startsWith("ba_")));
    const again = await auth(`/oauth2/authorize?${resume}`, { headers: farm.headers });
    expect(new URL(again.headers.get("location") ?? "", "http://x").pathname).toBe("/oauth/ferme");
  });

  it("jeton altéré ou pour une autre audience : 401", async () => {
    const clientId = await register();
    const t = await token(clientId, await authorize(farm, clientId, farm.farmId, { modules: { activities: "read" }, activities: "all" }));
    const bad = t.access_token.slice(0, -4) + (t.access_token.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect((await call(bad, "/activities")).status).toBe(401);
  });

  it("révocation dans Accès externes : refus immédiat, rafraîchissement refusé, nouveau consentement demandé", async () => {
    const clientId = await register();
    const a = await authorize(farm, clientId, farm.farmId, { modules: { activities: "read" }, activities: "all" });
    const t = await token(clientId, a);
    expect((await call(t.access_token, "/activities")).status).toBe(200);
    const list = await (await app.request(`/api/v1/farms/${farm.farmId}/accesses`, { headers: farm.headers })).json();
    const access = list.items.find((x: { kind: string; name: string }) => x.kind === "oauth" && x.name === "Assistant d'essai" && !("revokedAt" in x && x.revokedAt));
    expect(access).toBeTruthy();
    expect((await app.request(`/api/v1/farms/${farm.farmId}/accesses/${access.id}`, { method: "DELETE", headers: farm.headers })).status).toBe(204);
    expect((await call(t.access_token, "/activities")).status).toBe(403);
    const r = await auth("/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: clientId }).toString(),
    });
    expect(r.status).toBe(400);
    // Nouvelle autorisation : l'écran de consentement revient.
    const again = await authorize(farm, clientId, farm.farmId, { modules: { activities: "read" }, activities: "all" });
    expect(again.skipped).toBe(false);
  });

  it("un invité consent dans la limite de ses droits ; ferme dont il n'est pas membre : refusée", async () => {
    const guest = await addGuest(sql, farm.farmId, { modules: { activities: "read" }, activities: [ble] });
    users.push(guest.userId);
    const clientId = await register();
    const a = await authorize(guest, clientId, farm.farmId, { modules: { activities: "read", stocks: "read" }, activities: "all" });
    const t = await token(clientId, a);
    const acts = await call(t.access_token, "/activities");
    expect(((await acts.json()).items as { id: string }[]).map((x) => x.id)).toEqual([ble]);
    expect((await call(t.access_token, "/stock")).status).toBe(403);
    // Choisir une ferme dont on n'est pas membre : 404.
    const verifier = randomBytes(32).toString("base64url");
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "fourmy:read", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: apiResource() });
    const loc = new URL((await auth(`/oauth2/authorize?${q}`, { headers: guest.headers })).headers.get("location") ?? "", "http://x");
    expect((await app.request("/api/v1/oauth/farm", json({ farmId: other.farmId, oauthQuery: loc.search.slice(1) }, guest.headers))).status).toBe(404);
  });

  it("refus : l'application reçoit access_denied, aucun accès créé", async () => {
    const worker = await addMember(sql, farm.farmId, "worker");
    users.push(worker.userId);
    const clientId = await register();
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "fourmy:read", state: "s", code_challenge: createHash("sha256").update("v".repeat(43)).digest("base64url"), code_challenge_method: "S256", resource: apiResource() });
    const loc = new URL((await auth(`/oauth2/authorize?${q}`, { headers: worker.headers })).headers.get("location") ?? "", "http://x");
    const chosen = await app.request("/api/v1/oauth/farm", json({ farmId: farm.farmId, oauthQuery: loc.search.slice(1) }, worker.headers));
    const consentQuery = new URL((await chosen.json()).url, "http://x").search.slice(1);
    const denied = await app.request("/api/v1/oauth/consent", json({ accept: false, oauthQuery: consentQuery }, worker.headers));
    expect(new URL((await denied.json()).url).searchParams.get("error")).toBe("access_denied");
    expect(await sql`SELECT 1 FROM farm_accesses WHERE oauth_client_id = ${clientId}`).toHaveLength(0);
  });

  it("requête de consentement altérée : refusée, aucun accès ne reste", async () => {
    const clientId = await register();
    const verifier = randomBytes(32).toString("base64url");
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, scope: "fourmy:read", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: apiResource() });
    const loc = new URL((await auth(`/oauth2/authorize?${q}`, { headers: farm.headers })).headers.get("location") ?? "", "http://x");
    const chosen = await app.request("/api/v1/oauth/farm", json({ farmId: farm.farmId, oauthQuery: loc.search.slice(1) }, farm.headers));
    const consentQuery = new URL((await chosen.json()).url, "http://x").search.slice(1).replace(/sig=[^&]+/, "sig=falsifiee");
    const res = await app.request("/api/v1/oauth/consent", json({ accept: true, grant: { modules: { activities: "read" }, activities: "all" }, oauthQuery: consentQuery }, farm.headers));
    expect(res.status).toBe(400);
    expect(await sql`SELECT 1 FROM farm_accesses WHERE oauth_client_id = ${clientId}`).toHaveLength(0);
  });

  it("applications déclarées d'avance (FOURMY_OAUTH_CLIENTS)", async () => {
    const id = `test-${crypto.randomUUID().slice(0, 8)}`;
    clients.push(id);
    const list = declaredClients(JSON.stringify([{ clientId: id, name: "Service maison", redirectUris: [REDIRECT] }]));
    expect(await syncDeclaredClients(db(), list)).toBe(1);
    expect(await syncDeclaredClients(db(), list)).toBe(1);
    const a = await authorize(farm, id, farm.farmId, { modules: { activities: "read" }, activities: "all" });
    expect(a.request.client.name).toBe("Service maison");
    expect((await call((await token(id, a)).access_token, "/activities")).status).toBe(200);
    expect(() => declaredClients('[{"clientId":"X","name":"x","redirectUris":[]}]')).toThrow(/FOURMY_OAUTH_CLIENTS/);
  });
});
