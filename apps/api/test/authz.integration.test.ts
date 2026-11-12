import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown, signIn, TEST_PASSWORD } from "./helpers.js";
import { db } from "../src/db.js";
import { upsertLocalUser } from "../src/users.js";

/** Appartenance et rôles : qui peut entrer dans une ferme, et y faire quoi. */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("autorisations (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let outsider: { farmId: string; userId: string; email: string; headers: Record<string, string> };
  let newcomer = { userId: "", email: "" };
  const parcel = {
    name: "Pièce du haut",
    shape: { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.501, 44.8], [0.501, 44.801], [0.5, 44.8]]]] },
  };

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme autorisations", "owner");
    farmId = o.farmId;
    owner = o;
    worker = await addMember(sql, farmId, "worker");
    outsider = await setupFarm(sql, "Ferme voisine", "owner");
  });
  afterAll(async () => {
    await teardown(sql, farmId, [owner.userId, worker.userId, newcomer.userId]);
    await teardown(sql, outsider.farmId, [outsider.userId]);
    await sql.end();
  });

  const base = () => `/api/v1/farms/${farmId}`;

  it("un non-membre est refusé, même avec une identité valide", async () => {
    const res = await app.request(`${base()}/snapshot`, { headers: outsider.headers });
    expect(res.status).toBe(403);
  });

  it("un salarié (worker) lit, mais ne modifie pas le parcellaire", async () => {
    expect((await app.request(`${base()}/snapshot`, { headers: worker.headers })).status).toBe(200);
    const res = await app.request(`${base()}/land-parcels`, {
      method: "POST",
      headers: worker.headers,
      body: JSON.stringify(parcel),
    });
    expect(res.status).toBe(403);
  });

  it("le responsable (owner) modifie le parcellaire", async () => {
    const res = await app.request(`${base()}/land-parcels`, {
      method: "POST",
      headers: owner.headers,
      body: JSON.stringify(parcel),
    });
    expect(res.status).toBe(201);
  });

  it("400 si la ferme n'est pas un UUID", async () => {
    expect((await app.request("/api/v1/farms/f1/snapshot", { headers: owner.headers })).status).toBe(400);
  });

  it("le responsable invite un compte existant ; le salarié ne gère pas les accès", async () => {
    newcomer.email = `${crypto.randomUUID()}@test.fourmy`;
    newcomer.userId = await upsertLocalUser(db(), { email: newcomer.email, password: TEST_PASSWORD });
    const created = await app.request(`${base()}/people`, { method: "POST", headers: owner.headers, body: JSON.stringify({ name: "Nouvelle recrue" }) });
    const personId = ((await created.json()) as { id: string }).id;
    const invite = (headers: Record<string, string>) =>
      app.request(`${base()}/people/${personId}/invitations`, { method: "POST", headers, body: JSON.stringify({ email: newcomer.email.toUpperCase(), role: "worker" }) });
    expect((await invite(worker.headers)).status).toBe(403);
    const res = await invite(owner.headers);
    expect(res.status).toBe(201);
    const token = ((await res.json()) as { link: string }).link.split("/invitation/")[1]!;

    // Le compte existant se connecte et accepte : même email, il rejoint la ferme sur cette fiche.
    const bearer = await signIn(newcomer.email);
    const auth = { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
    expect((await app.request(`/api/v1/invitations/${token}/accept`, { method: "POST", headers: auth, body: "{}" })).status).toBe(200);
    const me = await (await app.request("/api/v1/me/farms", { headers: auth })).json();
    expect(me.user.email).toBe(newcomer.email);
    expect(me.items.map((f: { id: string }) => f.id)).toContain(farmId);
    const [p] = await sql`SELECT user_id FROM people WHERE id = ${personId}`;
    expect(p!.user_id).toBe(newcomer.userId);
  });

  it("une personne par compte sur la ferme ; jamais de compte extérieur", async () => {
    const people = (body: unknown) => app.request(`${base()}/people`, { method: "POST", headers: owner.headers, body: JSON.stringify(body) });
    expect((await people({ name: "Voisin", userId: outsider.userId })).status).toBe(400);
    expect((await people({ name: "Doublon", userId: newcomer.userId })).status).toBe(409);
  });

  it("la ferme garde toujours un responsable ; retirer un accès garde la personne", async () => {
    const personOf = async (userId: string) => (await sql<{ id: string }[]>`SELECT id FROM people WHERE farm_id = ${farmId} AND user_id = ${userId}`)[0]!.id;
    await app.request(`${base()}/people`, { headers: owner.headers }); // tout membre a sa personne (créée à la lecture)
    const ownerPerson = await personOf(owner.userId);
    const newcomerPerson = await personOf(newcomer.userId);
    const account = (id: string, method: "PATCH" | "DELETE", body?: unknown) =>
      app.request(`${base()}/people/${id}/account`, { method, headers: owner.headers, body: body ? JSON.stringify(body) : undefined });
    expect((await account(ownerPerson, "PATCH", { role: "worker" })).status).toBe(409);
    expect((await account(ownerPerson, "DELETE")).status).toBe(409);
    expect((await account(newcomerPerson, "DELETE")).status).toBe(204);
    const [p] = await sql`SELECT user_id FROM people WHERE id = ${newcomerPerson}`;
    expect(p?.user_id).toBeNull();
    const token = await signIn(newcomer.email);
    expect((await app.request(`${base()}/snapshot`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
    // Les anciennes routes d'écriture des membres n'existent plus (lot P5).
    expect((await app.request(`${base()}/members`, { method: "POST", headers: owner.headers, body: "{}" })).status).toBe(404);
  });

  it("la déconnexion révoque le jeton", async () => {
    const token = await signIn(newcomer.email);
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.request("/api/v1/me/farms", { headers })).status).toBe(200);
    const out = await app.request("/api/auth/sign-out", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
    expect(out.status).toBe(200);
    expect((await app.request("/api/v1/me/farms", { headers })).status).toBe(401);
  });

  it("l'application mobile se reconnecte malgré un cookie resté sur le téléphone ; une origine étrangère est refusée", async () => {
    const signIn = (headers: Record<string, string>) =>
      app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "better-auth.session_token=ancien", ...headers },
        body: JSON.stringify({ email: newcomer.email, password: TEST_PASSWORD }),
      });
    expect((await signIn({})).status).toBe(403); // cookie sans origine : refus CSRF de better-auth
    const mobile = await signIn({ origin: "zeromobile://" });
    expect(mobile.status).toBe(200);
    expect(mobile.headers.get("set-auth-token")).toMatch(/\./); // jeton signé pour le Bearer
    expect((await signIn({ origin: "https://evil.example" })).status).toBe(403);
  });
});
