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

  it("le responsable ajoute un compte existant par e-mail ; le salarié ne gère pas les membres", async () => {
    newcomer.email = `${crypto.randomUUID()}@test.fourmy`;
    newcomer.userId = await upsertLocalUser(db(), { email: newcomer.email, password: TEST_PASSWORD });
    const post = (headers: Record<string, string>, body: unknown) =>
      app.request(`${base()}/members`, { method: "POST", headers, body: JSON.stringify(body) });

    expect((await post(worker.headers, { email: newcomer.email, role: "worker" })).status).toBe(403);
    expect((await post(owner.headers, { email: "inconnu@test.fourmy", role: "worker" })).status).toBe(404);
    const res = await post(owner.headers, { email: newcomer.email.toUpperCase(), role: "worker" });
    expect(res.status).toBe(201);
    expect((await res.json()).items.map((m: { email: string }) => m.email)).toContain(newcomer.email);
    expect((await post(owner.headers, { email: newcomer.email, role: "worker" })).status).toBe(409);

    // Le nouveau membre se connecte et voit la ferme.
    const token = await signIn(newcomer.email);
    const me = await (await app.request("/api/v1/me/farms", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(me.user.email).toBe(newcomer.email);
    expect(me.items.map((f: { id: string }) => f.id)).toContain(farmId);
  });

  it("une personne se rattache à un compte membre (un seul par ferme), jamais à un compte extérieur", async () => {
    const people = (body: unknown) => app.request(`${base()}/people`, { method: "POST", headers: owner.headers, body: JSON.stringify(body) });
    expect((await people({ name: "Voisin", userId: outsider.userId })).status).toBe(400);
    const res = await people({ name: "Nouvelle recrue", userId: newcomer.userId });
    expect(res.status).toBe(201);
    expect((await res.json()).userId).toBe(newcomer.userId);
    expect((await people({ name: "Doublon", userId: newcomer.userId })).status).toBe(409);
  });

  it("la ferme garde toujours un responsable ; retirer un membre détache sa personne", async () => {
    const del = (userId: string) => app.request(`${base()}/members/${userId}`, { method: "DELETE", headers: owner.headers });
    const patch = (userId: string, role: string) =>
      app.request(`${base()}/members/${userId}`, { method: "PATCH", headers: owner.headers, body: JSON.stringify({ role }) });
    expect((await patch(owner.userId, "worker")).status).toBe(409);
    expect((await del(owner.userId)).status).toBe(409);
    expect((await del(newcomer.userId)).status).toBe(200);
    const [p] = await sql`SELECT user_id FROM people WHERE farm_id = ${farmId} AND name = 'Nouvelle recrue'`;
    expect(p?.user_id).toBeNull();
    const token = await signIn(newcomer.email);
    expect((await app.request(`${base()}/snapshot`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  });

  it("la déconnexion révoque le jeton", async () => {
    const token = await signIn(newcomer.email);
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.request("/api/v1/me/farms", { headers })).status).toBe(200);
    const out = await app.request("/api/auth/sign-out", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
    expect(out.status).toBe(200);
    expect((await app.request("/api/v1/me/farms", { headers })).status).toBe(401);
  });
});
