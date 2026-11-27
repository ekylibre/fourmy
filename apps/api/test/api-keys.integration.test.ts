import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { consume, pendingLogs, RATE_LIMITS, resetRateLimits } from "../src/external/audit.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Clés d'API (lot AM4, conception_api_mcp.md §6.2) : création, appel limité à
 * la ferme, aux modules et aux activités, journal, révocation et expiration,
 * plafond des droits de l'auteur, débit.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe("débit des accès externes", () => {
  it("120 appels par minute, puis attente ; la minute suivante repart", () => {
    resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.perMinute; i++) expect(consume("a", t)).toBeNull();
    expect(consume("a", t + 1000)).toBe(59);
    expect(consume("b", t + 1000)).toBeNull();
    expect(consume("a", t + 60_000)).toBeNull();
  });
});

describe.skipIf(!url)("clés d'API (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  let other: Awaited<ReturnType<typeof setupFarm>>;
  let reader: Awaited<ReturnType<typeof addMember>>;
  const vigne = crypto.randomUUID();
  const ble = crypto.randomUUID();
  const base = (f = farm.farmId) => `/api/v1/farms/${f}`;
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = farm.headers) =>
    app.request(`${base()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const withKey = (key: string, path: string, f = farm.farmId, method = "GET") => app.request(`${base(f)}${path}`, { method, headers: { "x-api-key": key } });

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme clés d'API");
    other = await setupFarm(sql, "Ferme voisine (clés)");
    reader = await addMember(sql, farm.farmId, "reader");
    // Le responsable est aussi membre de la ferme voisine : sa clé ne doit pas l'ouvrir.
    await sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (${crypto.randomUUID()}, ${other.farmId}, ${farm.userId}, 'owner')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${vigne}, ${farm.farmId}, 'Vigne', 'vine_farming'), (${ble}, ${farm.farmId}, 'Blé', 'plant_farming')`;
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${crypto.randomUUID()}, ${farm.farmId}, 'Paul')`;
  });
  beforeEach(() => resetRateLimits());
  afterAll(async () => {
    await sql`DELETE FROM auth_api_keys WHERE reference_id IN ${sql([farm.userId, reader.userId])}`;
    await sql`DELETE FROM farms WHERE id = ${other.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId, reader.userId, other.userId]);
    await sql.end();
  });

  const create = async (body: unknown, headers = farm.headers) => {
    const res = await send("POST", "/accesses", body, headers);
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { access: { id: string; keyStart: string; grant: unknown; reduced?: string[] }; key: string };
  };

  it("création : clé montrée une fois, préfixe fmy_, seul le haché est stocké", async () => {
    const { access, key } = await create({ name: "Export compta", grant: { modules: { interventions: "read", activities: "read" }, activities: [vigne] }, expiresInDays: 90 });
    expect(key).toMatch(/^fmy_/);
    expect(key.startsWith(access.keyStart)).toBe(true);
    const [stored] = await sql`SELECT k.key FROM auth_api_keys k JOIN farm_accesses a ON a.api_key_id = k.id WHERE a.id = ${access.id}`;
    expect(stored!.key).not.toContain(key.slice(4));
    const list = await (await send("GET", "/accesses")).json();
    expect(JSON.stringify(list)).not.toContain(key);
    expect(list.items[0]).toMatchObject({ name: "Export compta", kind: "api_key", revokedAt: null });
  });

  it("appel : sa ferme, ses modules, ses activités ; ni écriture, ni compte, ni autre ferme", async () => {
    const { key } = await create({ name: "Script vigne", grant: { modules: { interventions: "read", activities: "read", people: "read" }, activities: [vigne] } });
    expect((await withKey(key, "/interventions?campaign=2026")).status).toBe(200);
    const bearer = await app.request(`${base()}/activities`, { headers: { authorization: `Bearer ${key}` } });
    expect(bearer.status).toBe(200);
    expect(((await bearer.json()).items as { id: string }[]).map((a) => a.id)).toEqual([vigne]);
    expect((await withKey(key, "/stock")).status).toBe(403);
    expect((await withKey(key, "/members")).status).toBe(404);
    expect((await withKey(key, "/accesses")).status).toBe(404);
    expect((await withKey(key, "/interventions", farm.farmId, "POST")).status).toBe(404);
    expect((await app.request("/api/v1/me/farms", { headers: { "x-api-key": key } })).status).toBe(403);
    expect((await withKey(key, "/interventions?campaign=2026", other.farmId)).status).toBe(403);
    expect((await withKey("fmy_cle-inventee-0000000000000000", "/activities")).status).toBe(401);
    // Clé du responsable : jamais ses privilèges (données privées des personnes).
    const people = await (await withKey(key, "/people")).json();
    const paul = people.items.find((p: { name: string }) => p.name === "Paul");
    const sheet = await (await withKey(key, `/people/${paul.id}`)).json();
    expect(sheet.private).toBeUndefined();
  });

  it("journal et dernière utilisation", async () => {
    const { access, key } = await create({ name: "Journal", grant: { modules: { activities: "read" }, activities: "all" } });
    await withKey(key, "/activities");
    await withKey(key, "/stock");
    await Promise.all([...pendingLogs]);
    const log = await (await send("GET", `/accesses/${access.id}/log`)).json();
    expect(log.items.map((l: { operation: string; status: number }) => [l.operation, l.status])).toEqual([
      ["GET /stock", 403],
      ["GET /activities", 200],
    ]);
    const list = await (await send("GET", "/accesses")).json();
    expect(list.items.find((a: { id: string }) => a.id === access.id).lastUsedAt).not.toBeNull();
  });

  it("révocation : refusée à l'appel suivant ; expiration : refusée", async () => {
    const a = await create({ name: "À révoquer", grant: { modules: { activities: "read" }, activities: "all" } });
    expect((await withKey(a.key, "/activities")).status).toBe(200);
    expect((await send("DELETE", `/accesses/${a.access.id}`)).status).toBe(204);
    expect((await withKey(a.key, "/activities")).status).toBe(401);
    const b = await create({ name: "Expirée", grant: { modules: { activities: "read" }, activities: "all" } });
    await sql`UPDATE farm_accesses SET expires_at = now() - interval '1 minute' WHERE id = ${b.access.id}`;
    expect((await withKey(b.key, "/activities")).status).toBe(403);
  });

  it("plafond : un lecteur ne crée qu'une clé en lecture ; il ne voit que les siennes", async () => {
    const r = await create({ name: "Clé du lecteur", grant: { modules: { interventions: "write", stocks: "read" }, activities: "all" } }, reader.headers);
    expect(r.access.grant).toEqual({ modules: { interventions: "read", stocks: "read" }, activities: "all" });
    expect(r.access.reduced).toEqual(["interventions"]);
    const mine = await (await send("GET", "/accesses", undefined, reader.headers)).json();
    expect(mine.items.every((a: { user: { id: string } }) => a.user.id === reader.userId)).toBe(true);
    const all = await (await send("GET", "/accesses")).json();
    expect(all.items.some((a: { user: { id: string } }) => a.user.id === reader.userId)).toBe(true);
    // Activité d'une autre ferme : refusée.
    expect((await send("POST", "/accesses", { name: "x", grant: { modules: { activities: "read" }, activities: [crypto.randomUUID()] } })).status).toBe(400);
  });

  it("auteur retiré de la ferme : ses clés ne fonctionnent plus", async () => {
    const r = await create({ name: "Lecteur parti", grant: { modules: { activities: "read" }, activities: "all" } }, reader.headers);
    expect((await withKey(r.key, "/activities")).status).toBe(200);
    await sql`UPDATE memberships SET role = 'reader' WHERE user_id = ${reader.userId}`;
    await sql`DELETE FROM memberships WHERE farm_id = ${farm.farmId} AND user_id = ${reader.userId}`;
    expect((await withKey(r.key, "/activities")).status).toBe(403);
  });
});
