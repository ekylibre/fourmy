import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { ignStoreConfig, ignStoreDeps, tilePath } from "../src/ign/store.js";
import { preloadConfig, purgeIgnCache, runIgnJob } from "../src/ign/preload.js";
import { terrainTile } from "../src/terrain.js";
import { ignBuildingsAround } from "../src/repos/plan3d.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * « Ma ferme », lot F4 : relais de tuiles avec cache disque, préchargement
 * par le worker, quota LRU, relance automatique. Aucun appel réseau : l'IGN
 * est simulé, le cache vit dans un dossier temporaire.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

// Un coin isolé (Lozère) pour ne pas croiser d'autres tests dans ign_tiles, table commune.
const HQ = { lat: 44.3, lon: 3.6 };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe.skipIf(!url)("Cache IGN (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let hqId = "";
  const startedAt = new Date();
  const fetched = new Set<string>();
  let ignDown = false;
  const realFetch = ignStoreDeps.fetch;
  const realDir = ignStoreConfig.dir;
  const base = () => `/api/v1/farms/${farmId}`;
  const send = (method: string, path: string, body?: unknown, headers = owner.headers) =>
    app.request(`${base()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const state = async () => (await send("GET", "/ign/cache")).json();
  const hqBody = (radiusM: number, location = HQ) => ({
    name: "Siège",
    address: { line1: null, line2: null, postalCode: null, city: null, inseeCode: null },
    location,
    locationSource: "manual",
    geocode: null,
    radiusM,
  });

  beforeAll(async () => {
    ignStoreConfig.dir = await mkdtemp(join(tmpdir(), "fourmy-ign-"));
    ({ farmId, ...owner } = await setupFarm(sql, "Ferme cache IGN"));
    worker = await addMember(sql, farmId, "worker");
    const [hq] = await sql`SELECT id FROM farm_sites WHERE farm_id = ${farmId} AND is_headquarters`;
    hqId = hq!.id;
    ignStoreDeps.fetch = async (input: string, init?: RequestInit) => {
      if (ignDown) throw new Error("ECONNREFUSED");
      const u = new URL(input);
      if (u.pathname === "/wms-r") {
        fetched.add(`elevation/${u.searchParams.get("BBOX")}`);
        const n = Number(u.searchParams.get("WIDTH"));
        const buf = new ArrayBuffer(n * n * 4);
        new Float32Array(buf).fill(812.5); // little-endian sur nos machines, comme le BIL de l'IGN
        return new Response(buf, { headers: { "content-type": "image/x-bil;bits=32" } });
      }
      if (u.pathname === "/wfs/ows") {
        fetched.add(`buildings/${u.searchParams.get("BBOX")}`);
        // Un bâtiment au siège (s'il est dans la tuile demandée), sinon au centre de la tuile.
        const [south, west, north, east] = u.searchParams.get("BBOX")!.split(",").map(Number) as [number, number, number, number];
        const inTile = HQ.lon >= west && HQ.lon < east && HQ.lat >= south && HQ.lat < north;
        const [lon, lat] = inTile ? [HQ.lon, HQ.lat] : [(west + east) / 2, (south + north) / 2];
        const d = 0.0002;
        const ring = [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
        return Response.json({ features: [{ geometry: { type: "Polygon", coordinates: [ring] }, properties: { cleabs: `BAT_${west}_${south}`, hauteur: 6 } }] });
      }
      const key = `${u.searchParams.get("LAYER")}/${u.searchParams.get("TILEMATRIX")}/${u.searchParams.get("TILECOL")}/${u.searchParams.get("TILEROW")}`;
      if (u.searchParams.get("TILEMATRIX") === "19") return new Response("hors couverture", { status: 404 });
      if ((init?.headers as Record<string, string>)?.["if-none-match"] === '"ign-1"') return new Response(null, { status: 304 });
      fetched.add(key);
      return new Response(PNG, { headers: { "content-type": "image/png", etag: '"ign-1"' } });
    };
  });
  afterEach(() => {
    ignDown = false;
  });
  afterAll(async () => {
    ignStoreDeps.fetch = realFetch;
    // Les tuiles simulées ont toutes la même empreinte : on ne touche pas au reste du cache commun.
    await sql`DELETE FROM ign_tiles WHERE sha1 = ${createHash("sha1").update(PNG).digest("hex")}`;
    // Relief et bâtiments simulés : tuiles écrites pendant ce test dans les couches 3D, autour du siège.
    await sql`DELETE FROM ign_tiles WHERE layer IN ('elevation', 'buildings') AND fetched_at >= ${startedAt}`;
    await rm(ignStoreConfig.dir, { recursive: true, force: true });
    ignStoreConfig.dir = realDir;
    await teardown(sql, farmId, [owner.userId, worker.userId]);
    await sql.end();
  });

  it("sans siège placé : pas de plan, préchargement refusé", async () => {
    const s = await state();
    expect(s).toMatchObject({ plan: null, cached: { tiles: 0 }, lastJob: null, canEdit: true, settings: { layers: ["ortho", "plan", "elevation", "buildings"], detailMarginM: 200, autoRefresh: false } });
    const r = await send("POST", "/ign/cache/jobs", {});
    expect(r.status).toBe(409);
    expect((await r.json()).detail).toMatch(/siège/);
  });

  it("réglages : réservés au responsable, validés", async () => {
    expect((await send("PUT", "/settings/ign", { layers: ["plan"], detailMarginM: 0, autoRefresh: false }, worker.headers)).status).toBe(403);
    expect((await send("PUT", "/settings/ign", { layers: [], detailMarginM: 0, autoRefresh: false })).status).toBe(400);
    expect((await send("PUT", "/settings/ign", { layers: ["plan"], detailMarginM: 5000, autoRefresh: false })).status).toBe(400);
    const r = await send("PUT", "/settings/ign", { layers: ["plan", "plan"], detailMarginM: 0, autoRefresh: false });
    expect(await r.json()).toEqual({ layers: ["plan"], detailMarginM: 0, autoRefresh: false });
  });

  it("précharge la zone du siège, une seule tâche à la fois, puis tout est en cache", async () => {
    expect((await send("PUT", `/farm/sites/${hqId}`, hqBody(1000))).status).toBe(200);
    const before = await state();
    expect(before.plan.tiles).toBeGreaterThan(9);
    expect(before.plan.layers).toEqual({ plan: before.plan.tiles });
    expect(before.cached.tiles).toBe(0);

    const r = await send("POST", "/ign/cache/jobs", {});
    expect(r.status).toBe(202);
    expect(await r.json()).toMatchObject({ status: "pending", layers: ["plan"], tileCount: before.plan.tiles });
    expect((await send("POST", "/ign/cache/jobs", {})).status).toBe(409);
    expect((await send("POST", "/ign/cache/jobs", {}, worker.headers)).status).toBe(403);

    let done = await runIgnJob(db());
    while (done?.status === "running") done = await runIgnJob(db());
    expect(done).toMatchObject({ status: "done", failed: 0 });
    expect(done!.fetched).toBe(before.plan.tiles);

    const after = await state();
    expect(after.cached).toEqual({ tiles: before.plan.tiles, bytes: before.plan.tiles * PNG.length });
    expect(after.lastJob).toMatchObject({ status: "done", progress: { plan: { total: before.plan.tiles, done: before.plan.tiles, fetched: before.plan.tiles, failed: 0 } } });

    // Relancer ne télécharge rien : tout est déjà là.
    fetched.clear();
    await send("POST", "/ign/cache/jobs", {});
    expect(await runIgnJob(db())).toMatchObject({ status: "done", fetched: 0 });
    expect(fetched.size).toBe(0);
  });

  it("manifeste de la copie hors ligne : les tuiles du plan déjà sur le serveur, lisible par un salarié", async () => {
    const plan = (await state()).plan;
    const r = await send("GET", "/ign/cache/manifest", undefined, worker.headers);
    expect(r.status).toBe(200);
    const m = await r.json();
    expect(m.entries).toHaveLength(plan.tiles);
    expect(m.bytes).toBe(plan.tiles * PNG.length);
    expect(m.entries[0]).toEqual({ url: expect.stringMatching(new RegExp(`^/api/v1/farms/${farmId}/ign/tiles/plan/\\d+/\\d+/\\d+$`)), etag: `"${createHash("sha1").update(PNG).digest("hex")}"`, bytes: PNG.length });
    // L'URL du manifeste est servie telle quelle par le relais, avec le même ETag.
    const tile = await app.request(m.entries[0].url, { headers: worker.headers });
    expect(tile.headers.get("etag")).toBe(m.entries[0].etag);
  });

  it("le relais sert la tuile du cache, avec ETag et 304", async () => {
    const z = 16;
    const x = Math.floor(((HQ.lon + 180) / 360) * 2 ** z);
    const la = (HQ.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * 2 ** z);
    fetched.clear();
    const r = await send("GET", `/ign/tiles/plan/${z}/${x}/${y}`, undefined, worker.headers);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-ign-cache")).toBe("HIT");
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("private, max-age=604800");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(PNG);
    expect(fetched.size).toBe(0);
    const etag = r.headers.get("etag")!;
    const again = await app.request(`${base()}/ign/tiles/plan/${z}/${x}/${y}`, { headers: { ...owner.headers, "if-none-match": etag } });
    expect(again.status).toBe(304);
  });

  it("tuile absente : demandée à l'IGN puis écrite sur le disque ; IGN en panne : 502, ou la tuile périmée", async () => {
    const [z, x, y] = [14, 8000, 5912];
    ignDown = true;
    expect((await send("GET", `/ign/tiles/plan/${z}/${x}/${y}`)).status).toBe(502);
    ignDown = false;
    const r = await send("GET", `/ign/tiles/plan/${z}/${x}/${y}`);
    expect(r.headers.get("x-ign-cache")).toBe("MISS");
    expect((await stat(tilePath("plan", z, x, y))).size).toBe(PNG.length);

    await sql`UPDATE ign_tiles SET fetched_at = now() - interval '400 days' WHERE layer = 'plan' AND z = ${z} AND x = ${x} AND y = ${y}`;
    ignDown = true;
    expect((await send("GET", `/ign/tiles/plan/${z}/${x}/${y}`)).headers.get("x-ign-cache")).toBe("STALE");
    ignDown = false;
    // Périmée et IGN joignable : 304 de l'IGN, la date est rafraîchie.
    expect((await send("GET", `/ign/tiles/plan/${z}/${x}/${y}`)).headers.get("x-ign-cache")).toBe("HIT");
    const [row] = await sql`SELECT fetched_at FROM ign_tiles WHERE layer = 'plan' AND z = ${z} AND x = ${x} AND y = ${y}`;
    expect(Date.now() - new Date(row!.fetched_at).getTime()).toBeLessThan(60_000);
  });

  it("refuse les couches et tuiles inconnues ; hors couverture : 404 sans cache", async () => {
    expect((await send("GET", "/ign/tiles/cadastre/10/1/1")).status).toBe(404);
    expect((await send("GET", "/ign/tiles/plan/3/9/0")).status).toBe(404);
    const r = await send("GET", "/ign/tiles/plan/19/266000/190000");
    expect(r.status).toBe(404);
    const [n] = await sql`SELECT count(*)::int AS n FROM ign_tiles WHERE layer = 'plan' AND z = 19 AND x = 266000`;
    expect(n!.n).toBe(0);
  });

  it("quota : purge d'abord les tuiles hors de tout plan, les moins lues d'abord", async () => {
    const [z, x, y] = [14, 8000, 5912]; // à 800 km du siège : hors du plan
    await sql`UPDATE ign_tiles SET last_read_at = '2000-01-01' WHERE layer = 'plan' AND z = ${z} AND x = ${x} AND y = ${y}`;
    const [{ total }] = await sql`SELECT sum(bytes)::bigint AS total FROM ign_tiles`;
    const r = await purgeIgnCache(db(), Number(total) - 1);
    expect(r).toEqual({ deleted: 1, freedBytes: PNG.length, protectedDeleted: 0 });
    await expect(stat(tilePath("plan", z, x, y))).rejects.toThrow();
    expect((await state()).cached.tiles).toBe((await state()).plan.tiles);
  });

  it("relance automatique quand le siège bouge, si la ferme l'a demandé ; annulation", async () => {
    await send("PUT", "/settings/ign", { layers: ["plan"], detailMarginM: 0, autoRefresh: true });
    expect((await send("PUT", `/farm/sites/${hqId}`, hqBody(1500))).status).toBe(200);
    const job = (await state()).lastJob;
    expect(job).toMatchObject({ status: "pending" });
    expect((await send("DELETE", `/ign/cache/jobs/${job.id}`, undefined, worker.headers)).status).toBe(403);
    expect((await send("DELETE", `/ign/cache/jobs/${job.id}`)).status).toBe(204);
    expect((await state()).lastJob).toMatchObject({ status: "cancelled" });
    expect((await send("DELETE", `/ign/cache/jobs/${job.id}`)).status).toBe(409);
    expect(await runIgnJob(db())).toBeNull();
  });

  it("relief et bâtiments préchargés : la 3D les lit ensuite sur le disque, sans appeler l'IGN", async () => {
    await send("PUT", "/settings/ign", { layers: ["elevation", "buildings"], detailMarginM: 0, autoRefresh: false });
    await send("PUT", `/farm/sites/${hqId}`, hqBody(1000));
    const plan = (await state()).plan;
    expect(Object.keys(plan.layers).sort()).toEqual(["buildings", "elevation"]);
    expect(plan.layers.buildings).toBeGreaterThan(0);
    fetched.clear();
    expect((await send("POST", "/ign/cache/jobs", {})).status).toBe(202);
    let done = await runIgnJob(db());
    while (done?.status === "running") done = await runIgnJob(db());
    expect(done).toMatchObject({ status: "done", failed: 0, fetched: plan.tiles });
    expect((await state()).cached.tiles).toBe(plan.tiles);
    // Manifeste : le relief par la route de la 3D ; les bâtiments n'y sont pas (ils viennent avec /plan3d).
    const m = await (await send("GET", "/ign/cache/manifest")).json();
    expect(m.entries).toHaveLength(plan.layers.elevation);
    expect(m.entries.every((e: { url: string }) => e.url.includes("/terrain/heightmap/"))).toBe(true);

    const offline = (async () => {
      throw new Error("pas de réseau");
    }) as unknown as typeof fetch;
    const size = 180 / 2 ** 14;
    const t = await terrainTile(farmId, 14, Math.floor((HQ.lon + 180) / size), Math.floor((90 - HQ.lat) / size), offline);
    expect(t.source).toBe("ign");
    expect(t.grid[0]).toBe(812.5);
    const buildings = await ignBuildingsAround(farmId, { west: HQ.lon - 0.001, south: HQ.lat - 0.001, east: HQ.lon + 0.001, north: HQ.lat + 0.001 }, offline);
    expect(buildings.length).toBeGreaterThan(0);
    expect(buildings.every((b) => b.heightM === 6)).toBe(true);
  });

  it("le relais refuse le relief et les bâtiments (ils passent par la 3D)", async () => {
    expect((await send("GET", "/ign/tiles/elevation/14/16547/4884")).status).toBe(404);
    expect((await send("GET", "/ign/tiles/buildings/14/8355/5912")).status).toBe(404);
  });

  it("le budget de temps rend la main au worker, et la tâche reprend au tour suivant", async () => {
    const budget = preloadConfig.budgetMs;
    preloadConfig.budgetMs = -1;
    try {
      await send("POST", "/ign/cache/jobs", {});
      expect(await runIgnJob(db())).toMatchObject({ status: "running" });
      expect((await state()).lastJob).toMatchObject({ status: "running" });
    } finally {
      preloadConfig.budgetMs = budget;
    }
    expect(await runIgnJob(db())).toMatchObject({ status: "done" });
  });
});
