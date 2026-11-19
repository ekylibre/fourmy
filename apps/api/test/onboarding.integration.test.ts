import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { geocodeDeps } from "../src/geocode.js";
import { upsertLocalUser } from "../src/users.js";
import { signIn, TEST_PASSWORD } from "./helpers.js";

/**
 * Assistant de premier démarrage, lot IM6 : création de sa ferme par un
 * compte « à embarquer » (quota), identité lue dans un fichier, état de
 * l'assistant.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const fixtures = join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures");

describe.skipIf(!url)("assistant de premier démarrage (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const users: string[] = [];
  const created: string[] = [];
  const realFetch = geocodeDeps.fetch;

  const account = async (quota: number) => {
    const email = `${crypto.randomUUID()}@test.fourmy`;
    const id = await upsertLocalUser(db(), { email, name: "Exploitant Test", password: TEST_PASSWORD });
    users.push(id);
    await sql`UPDATE users SET farm_creation_quota = ${quota} WHERE id = ${id}`;
    const headers = { authorization: `Bearer ${await signIn(email)}`, "content-type": "application/json" };
    return { id, headers };
  };
  const post = (path: string, headers: Record<string, string>, body: unknown) =>
    app.request(`/api/v1${path}`, { method: "POST", headers, body: JSON.stringify(body) });

  beforeAll(() => {
    // Géocodage du siège sans réseau : une adresse trouvée.
    geocodeDeps.fetch = async () =>
      new Response(
        JSON.stringify({
          features: [
            {
              geometry: { coordinates: [1.18, 46.14] },
              properties: { label: "Le Bourg 00000 Commune test", name: "Le Bourg", postcode: "00000", city: "Commune test", citycode: "00000", score: 0.9, type: "locality" },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
  });
  afterAll(async () => {
    geocodeDeps.fetch = realFetch;
    if (created.length) await sql`DELETE FROM farms WHERE id IN ${sql(created)}`;
    if (users.length) await sql`DELETE FROM users WHERE id IN ${sql(users)}`;
    await sql.end();
  });

  it("sans droit : aucune ferme, création refusée", async () => {
    const u = await account(0);
    const me = await (await app.request("/api/v1/me/farms", { headers: u.headers })).json();
    expect(me).toMatchObject({ canCreateFarm: false, items: [] });
    const res = await post("/me/farms", u.headers, { name: "Ferme refusée" });
    expect(res.status).toBe(403);
  });

  it("avec droit : ferme, responsable, campagne, personne, siège géocodé ; le droit est consommé", async () => {
    const u = await account(1);
    expect((await (await app.request("/api/v1/me/farms", { headers: u.headers })).json()).canCreateFarm).toBe(true);
    const res = await post("/me/farms", u.headers, {
      name: "GAEC Pilote Test",
      legalName: "GAEC PILOTE TEST",
      siret: "40000000000003",
      pacage: "040000003",
      address: { line1: "Le Bourg", postalCode: "00000", city: "Commune test" },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = await res.json();
    created.push(id);

    const me = await (await app.request("/api/v1/me/farms", { headers: u.headers })).json();
    expect(me.canCreateFarm).toBe(false);
    expect(me.items).toEqual([{ id, name: "GAEC Pilote Test", role: "owner", onboarding: { step: "files", completedAt: null } }]);
    const [farm] = await sql`SELECT siret, pacage, legal_name FROM farms WHERE id = ${id}`;
    expect(farm).toEqual({ siret: "40000000000003", pacage: "040000003", legal_name: "GAEC PILOTE TEST" });
    const [state] = await sql`
      SELECT (SELECT count(*) FROM campaigns WHERE farm_id = ${id} AND year = extract(year FROM now())::int)::int AS campaigns,
             (SELECT count(*) FROM people WHERE farm_id = ${id} AND user_id = ${u.id})::int AS people,
             (SELECT location_source FROM farm_sites WHERE farm_id = ${id} AND is_headquarters) AS hq`;
    expect(state).toEqual({ campaigns: 1, people: 1, hq: "geocoded" });

    // Une seconde ferme : refusée (le droit était d'une ferme).
    expect((await post("/me/farms", u.headers, { name: "Seconde" })).status).toBe(403);

    // État de l'assistant : étape, puis fin.
    const put = (body: unknown) => app.request(`/api/v1/farms/${id}/farm/onboarding`, { method: "PUT", headers: u.headers, body: JSON.stringify(body) });
    expect(await (await put({ step: "matching" })).json()).toEqual({ step: "matching", completedAt: null });
    const done = await (await put({ step: "done", completed: true })).json();
    expect(done.step).toBe("done");
    expect(done.completedAt).toBeTruthy();
  });

  it("double envoi : une seule ferme", async () => {
    const u = await account(1);
    const results = await Promise.all([post("/me/farms", u.headers, { name: "Double 1" }), post("/me/farms", u.headers, { name: "Double 2" })]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 403]);
    for (const r of results.filter((x) => x.status === 201)) created.push((await r.json()).id);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM memberships WHERE user_id = ${u.id}`;
    expect(n).toBe(1);
  });

  it("identité lue dans chacun des trois formats, sans rien garder", async () => {
    const u = await account(1);
    const identity = async (file: string) => {
      const form = new FormData();
      form.set("file", new File([readFileSync(join(fixtures, file))], file));
      const res = await app.request("/api/v1/me/onboarding/identity", { method: "POST", headers: { authorization: u.headers.authorization }, body: form });
      expect(res.status, await res.clone().text()).toBe(200);
      return res.json();
    };
    expect(await identity("telepac-pilote.xml")).toMatchObject({ format: "telepac", identity: { siret: "40000000000003", pacage: "040000003", name: "GAEC PILOTE TEST" } });
    expect(await identity("geofolia-pilote.zip")).toMatchObject({ format: "geofolia", identity: { siret: "40000000000003" } });
    expect(await identity("daplos-pilote.dap")).toMatchObject({
      format: "daplos",
      identity: { siret: "40000000000003", pacage: "040000003", address: { line1: "LE BOURG", postalCode: "00000", city: "Commune test" } },
    });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM import_files f JOIN memberships m ON m.farm_id = f.farm_id WHERE m.user_id = ${u.id}`;
    expect(n).toBe(0);
  });
});
