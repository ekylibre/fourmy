import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, signIn, teardown } from "./helpers.js";

/**
 * Membre restreint de bout en bout (lot AM3, conception_api_mcp.md §3.2, §9) :
 * le responsable invite un conseiller « Vigne », qui accepte, voit ses droits
 * dans « Mes fermes » et n'accède qu'à son périmètre ; le responsable change
 * ses droits, puis son rôle.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const PASSWORD = "mot-de-passe-solide";

describe.skipIf(!url)("membres restreints (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  const vigne = crypto.randomUUID();
  const ble = crypto.randomUUID();
  const base = () => `/api/v1/farms/${farm.farmId}`;
  const send = (method: string, path: string, body?: unknown, headers = farm.headers) =>
    app.request(`${base()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme invités restreints");
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${vigne}, ${farm.farmId}, 'Vigne', 'vine_farming'), (${ble}, ${farm.farmId}, 'Blé', 'plant_farming')`;
  });
  afterAll(async () => {
    const users = (await sql<{ user_id: string }[]>`SELECT user_id FROM memberships WHERE farm_id = ${farm.farmId}`).map((r) => r.user_id);
    await teardown(sql, farm.farmId, [...new Set([...users, farm.userId])]);
    await sql.end();
  });

  const vigneRead = { modules: { activities: "read", interventions: "read", phyto: "read", parcels: "read" }, activities: [vigne] };

  it("droits exigés pour un invité, refusés pour un autre rôle, activités de la ferme seulement", async () => {
    const id = ((await (await send("POST", "/people", { name: "Conseiller" })).json()) as { id: string }).id;
    const email = `c-${crypto.randomUUID()}@test.fourmy`;
    expect((await send("POST", `/people/${id}/invitations`, { email, role: "guest" })).status).toBe(400);
    expect((await send("POST", `/people/${id}/invitations`, { email, role: "reader", grant: vigneRead })).status).toBe(400);
    const foreign = { ...vigneRead, activities: [crypto.randomUUID()] };
    expect((await send("POST", `/people/${id}/invitations`, { email, role: "guest", grant: foreign })).status).toBe(400);
  });

  it("invitation, acceptation, droits dans « Mes fermes », périmètre appliqué ; changement de droits puis de rôle", async () => {
    const id = ((await (await send("POST", "/people", { firstName: "Hélène", lastName: "Conseil" })).json()) as { id: string }).id;
    const email = `helene-${crypto.randomUUID()}@test.fourmy`;
    const inv = await send("POST", `/people/${id}/invitations`, { email, role: "guest", grant: vigneRead });
    expect(inv.status, await inv.clone().text()).toBe(201);
    const sheet = await (await send("GET", `/people/${id}`)).json();
    expect(sheet.invitation).toMatchObject({ role: "guest", grant: vigneRead });

    const token = ((await inv.json()) as { link: string }).link.split("/invitation/")[1]!;
    const ok = await app.request(`/api/v1/invitations/${token}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
    expect(ok.status).toBe(200);
    const guest = { authorization: `Bearer ${await signIn(email, PASSWORD)}`, "content-type": "application/json" };

    // « Mes fermes » : rôle et droits effectifs, pour la navigation du web.
    const me = await (await app.request("/api/v1/me/farms", { headers: guest })).json();
    const f = me.items.find((x: { id: string }) => x.id === farm.farmId);
    expect(f.role).toBe("guest");
    expect(f.grant.modules).toMatchObject({ activities: "read", interventions: "read", phyto: "read", parcels: "read", stocks: "none" });
    expect(f.grant.activities).toEqual([vigne]);
    const ownerMe = await (await app.request("/api/v1/me/farms", { headers: farm.headers })).json();
    expect(ownerMe.items.find((x: { id: string }) => x.id === farm.farmId).grant.activities).toBe("all");

    // Périmètre et modules appliqués ; le snapshot perd les matériels.
    const acts = await (await send("GET", "/activities", undefined, guest)).json();
    expect((acts.items ?? acts).map((a: { id: string }) => a.id)).toEqual([vigne]);
    expect((await send("GET", "/stock", undefined, guest)).status).toBe(403);
    const snap = await (await send("GET", "/snapshot", undefined, guest)).json();
    expect(snap.equipments).toEqual([]);

    // Le responsable voit les droits sur la fiche, les élargit, puis change le rôle.
    expect((await (await send("GET", `/people/${id}`)).json()).account).toMatchObject({ status: "active", role: "guest", grant: vigneRead });
    expect((await send("PATCH", `/people/${id}/account`, { role: "guest", grant: { modules: { stocks: "read" }, activities: "all" } })).status).toBe(204);
    expect((await send("GET", "/stock", undefined, guest)).status).toBe(200);
    expect((await send("GET", "/activities", undefined, guest)).status).toBe(403);
    expect((await send("PATCH", `/people/${id}/account`, { role: "reader" })).status).toBe(204);
    const [m] = await sql<{ role: string; access_grant: unknown }[]>`SELECT m.role, m.access_grant FROM memberships m JOIN people p ON p.user_id = m.user_id WHERE p.id = ${id}`;
    expect(m).toEqual({ role: "reader", access_grant: null });
    expect((await send("GET", "/activities", undefined, guest)).status).toBe(200);
  });

  it("un invité restreint ne voit pas les données privées des personnes", async () => {
    const id = ((await (await send("POST", "/people", { firstName: "Paul", lastName: "Privé", private: { phone: "0600000000" } })).json()) as { id: string }).id;
    const guestId = ((await (await send("POST", "/people", { name: "Invité" })).json()) as { id: string }).id;
    const email = `g-${crypto.randomUUID()}@test.fourmy`;
    const inv = await send("POST", `/people/${guestId}/invitations`, { email, role: "guest", grant: { modules: { people: "read" }, activities: "all" } });
    const token = ((await inv.json()) as { link: string }).link.split("/invitation/")[1]!;
    await app.request(`/api/v1/invitations/${token}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
    const guest = { authorization: `Bearer ${await signIn(email, PASSWORD)}` };
    const sheet = await (await send("GET", `/people/${id}`, undefined, guest)).json();
    expect(sheet.private).toBeUndefined();
    expect(JSON.stringify(sheet)).not.toContain("0600000000");
  });
});
