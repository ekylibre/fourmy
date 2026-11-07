import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadFixture, type FixtureFile } from "@fourmy/db";
import { pointInPolygon, type Pt } from "@fourmy/domain";
import { createApp } from "../src/app.js";
import { terrainDeps } from "../src/routes/plan3d.js";
import { terrainConfig } from "../src/terrain.js";
import { addMember } from "./helpers.js";

/**
 * Plan 3D sur la fixture viticole (données réelles anonymisées), avec un
 * faux IGN : aucun appel réseau, réponses contrôlées.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const realFetch = terrainDeps.fetch;

let ignCalls: string[] = [];
let ignMode: "ok" | "down" | "429-once" = "ok";
let chaiFootprint: unknown = null;

const fakeIgn: typeof fetch = async (input) => {
  const u = new URL(String(input));
  ignCalls.push(u.pathname);
  if (ignMode === "down") return new Response("<ServiceException/>", { status: 503, headers: { "content-type": "text/xml" } });
  if (ignMode === "429-once") {
    ignMode = "ok";
    return new Response("Too Many Requests", { status: 429, headers: { "content-type": "text/html" } });
  }
  if (u.pathname === "/wms-r") {
    const n = Number(u.searchParams.get("WIDTH"));
    const buf = new ArrayBuffer(n * n * 4);
    const v = new DataView(buf);
    for (let i = 0; i < n * n; i++) v.setFloat32(i * 4, 42.5, true);
    return new Response(buf, { headers: { "content-type": "image/x-bil;bits=32" } });
  }
  // BD TOPO : un bâtiment IGN qui reprend exactement l'emprise du chai.
  return Response.json({
    features: [{ geometry: chaiFootprint, properties: { cleabs: "BATIMENT_TEST", hauteur: 7.2, altitude_minimale_sol: 29, identifiants_rnb: "RNB_TEST" } }],
  });
};

describe.skipIf(!url)("plan 3D (intégration, faux IGN)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let base = "";
  let owner: { userId: string; headers: Record<string, string> };
  let tile: { x: number; y: number };

  beforeAll(async () => {
    const path = fileURLToPath(new URL("../../../fixtures/pilote-viticulture.json", import.meta.url));
    const fixture = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
    await loadFixture(sql, fixture); // remet aussi les hauteurs à NULL
    const farmId = fixture.tables.farms![0]!.id as string;
    owner = await addMember(sql, farmId, "owner");
    base = `/api/v1/farms/${farmId}`;
    const [row] = await sql`SELECT ST_AsGeoJSON(v.footprint)::json AS g, ST_X(ST_Centroid(v.footprint)) AS lon, ST_Y(ST_Centroid(v.footprint)) AS lat
      FROM place_versions v JOIN containers c ON c.place_id = v.place_id
      JOIN places p ON p.id = v.place_id WHERE p.farm_id = ${farmId} AND v.footprint IS NOT NULL LIMIT 1`;
    chaiFootprint = row!.g;
    const size = 180 / 2 ** 15;
    tile = { x: Math.floor((row!.lon + 180) / size), y: Math.floor((90 - row!.lat) / size) };
    terrainDeps.fetch = fakeIgn;
    terrainConfig.retryBaseDelayMs = 5; // reprises rapides en test
  }, 60_000);
  beforeEach(() => {
    ignCalls = [];
    ignMode = "ok";
  });
  afterAll(async () => {
    terrainDeps.fetch = realFetch;
    await sql`DELETE FROM memberships WHERE user_id = ${owner.userId}`;
    await sql`DELETE FROM users WHERE id = ${owner.userId}`;
    await sql.end();
  });

  const get = (path: string) => app.request(`${base}${path}`, { headers: owner.headers });

  it("relief : grille 65 × 65 de l'IGN près de la ferme, puis servie depuis le cache", async () => {
    const res = await get(`/terrain/heightmap/15/${tile.x}/${tile.y}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-terrain-source")).toBe("ign");
    const grid = new Float32Array(await res.arrayBuffer());
    expect(grid.length).toBe(65 * 65);
    expect(grid[0]).toBe(42.5);
    await get(`/terrain/heightmap/15/${tile.x}/${tile.y}`);
    expect(ignCalls.filter((p) => p === "/wms-r")).toHaveLength(1); // 2e fois : cache
  });

  it("relief plat sans solliciter l'IGN : loin de la ferme, ou à faible niveau de détail", async () => {
    for (const path of ["/terrain/heightmap/15/100/100", "/terrain/heightmap/3/4/1"]) {
      const res = await get(path);
      expect(res.headers.get("x-terrain-source")).toBe("flat");
      expect(new Float32Array(await res.arrayBuffer()).every((h) => h === 0)).toBe(true);
    }
    expect(ignCalls).toEqual([]);
    expect((await get("/terrain/heightmap/1/9/9")).status).toBe(400);
  });

  it("tuiles fines : interpolées depuis l'ancêtre de niveau 16, un seul appel IGN pour des tuiles sœurs simultanées", async () => {
    const [x16, y16] = [tile.x * 2, tile.y * 2]; // un ancêtre de niveau 16 encore jamais demandé
    const children = [0, 1].flatMap((dx) => [0, 1].map((dy) => `/terrain/heightmap/17/${x16 * 2 + dx}/${y16 * 2 + dy}`));
    const responses = await Promise.all([...children, `/terrain/heightmap/18/${x16 * 4}/${y16 * 4}`].map((p) => get(p)));
    for (const r of responses) {
      expect(r.headers.get("x-terrain-source")).toBe("ign");
      expect(new Float32Array(await r.arrayBuffer())[100]).toBeCloseTo(42.5);
    }
    expect(ignCalls.filter((p) => p === "/wms-r")).toHaveLength(1);
  });

  it("un 429 isolé est rattrapé par une nouvelle tentative", async () => {
    ignMode = "429-once";
    const res = await get(`/terrain/heightmap/16/${tile.x * 2 + 1}/${tile.y * 2}`);
    expect(res.headers.get("x-terrain-source")).toBe("ign");
    expect(ignCalls.filter((p) => p === "/wms-r")).toHaveLength(2);
  });

  it("IGN durablement indisponible : relief de repli à l'altitude de la ferme, signalé, non mis en cache", async () => {
    ignMode = "down";
    const res = await get(`/terrain/heightmap/16/${tile.x * 2 + 1}/${tile.y * 2 + 1}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-terrain-source")).toBe("fallback");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const grid = new Float32Array(await res.arrayBuffer());
    expect(grid.every((h) => Math.abs(h - 42.5) < 1e-6)).toBe(true); // pas un trou à 0 m
    expect(ignCalls.filter((p) => p === "/wms-r")).toHaveLength(3); // 3 tentatives
  });

  it("plan fin 2021 : chaque cuve placée dans l'emprise de son bâtiment, remplissage à la date", async () => {
    const plan = await (await get("/plan3d?at=2021-12-31T23:00:00Z")).json();
    expect(plan.parcels).toHaveLength(9);
    expect(plan.tanks.length + plan.unplaced.length).toBe(6);
    const ring = (id: string) => {
      const g = plan.buildings.find((b: { id: string }) => b.id === id).footprint;
      return (g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0]) as Pt[];
    };
    for (const t of plan.tanks) expect(pointInPolygon([t.lon, t.lat], ring(t.placeId))).toBe(true);
    const cuve1 = plan.tanks.find((t: { name: string }) => t.name === "Cuve 1");
    expect(cuve1.fill).toBeCloseTo(0.6);
    expect(cuve1.placement).toBe("auto");
    expect(plan.unplaced.map((u: { name: string }) => u.name)).toEqual(["GV1"]); // bâtiment sans emprise
  });

  it("un placement manuel prime sur le placement automatique", async () => {
    const plan = await (await get("/plan3d?at=2021-12-31T23:00:00Z")).json();
    const cuve2 = plan.tanks.find((t: { name: string }) => t.name === "Cuve 2");
    const res = await app.request(`${base}/containers/${cuve2.id}/placement`, {
      method: "PATCH",
      headers: owner.headers,
      body: JSON.stringify({ shape3d: { x: 1, y: -1, z: 0, radius: 0.8, height: 2.5 } }),
    });
    expect(res.status).toBe(200);
    const after = (await (await get("/plan3d?at=2021-12-31T23:00:00Z")).json()).tanks.find((t: { name: string }) => t.name === "Cuve 2");
    expect(after.placement).toBe("manual");
    expect(after.radius).toBe(0.8);
  });

  it("hauteurs BD TOPO : appariement par recouvrement, tracé, idempotent", async () => {
    const first = await (await app.request(`${base}/places/ign-heights`, { method: "POST", headers: owner.headers })).json();
    expect(first.updated.length).toBeGreaterThan(0);
    expect(first.updated.every((u: { heightM: number }) => u.heightM === 7.2)).toBe(true);
    const plan = await (await get("/plan3d?at=2021-12-31T23:00:00Z")).json();
    expect(plan.buildings.some((b: { heightM: number; heightSource: string }) => b.heightM === 7.2 && b.heightSource === "ign")).toBe(true);
    const again = await (await app.request(`${base}/places/ign-heights`, { method: "POST", headers: owner.headers })).json();
    expect(again.updated).toEqual([]);
  });
});
