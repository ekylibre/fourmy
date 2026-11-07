import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { externalUrl } from "../src/integrations/providers.js";
import { dueIntegrations } from "../src/integrations/repo.js";
import { db } from "../src/db.js";
import { pendingSyncs } from "../src/routes/integrations.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * Intégrations par ferme, contre un faux serveur Traccar : secret chiffré et
 * jamais renvoyé, test avant enregistrement, synchro et verrou, cloisonnement.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const TOKEN = "jeton-traccar-de-test-4242";

let traccar: Server;
let traccarUrl = "";
let positionsServed = 0;

function fakeTraccar(): Promise<void> {
  traccar = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    const u = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "application/json");
    if (u.pathname === "/api/devices") {
      res.end(JSON.stringify([
        { id: 7, name: "Tracteur Fendt" },
        { id: 8, name: "Boîtier orphelin" },
      ]));
      return;
    }
    if (u.pathname === "/api/positions") {
      const from = new Date(u.searchParams.get("from")!).getTime();
      const to = new Date(u.searchParams.get("to")!).getTime();
      const fix = Date.parse("2026-11-01T09:00:00Z");
      const inWindow = fix >= from && fix < to;
      if (inWindow) positionsServed += 2;
      res.end(JSON.stringify(inWindow ? [
        { id: 1, deviceId: 7, fixTime: "2026-11-01T09:00:00Z", latitude: 44.8, longitude: 0.5, speed: 3, attributes: {} },
        { id: 2, deviceId: 7, fixTime: "2026-11-01T09:00:10Z", latitude: 44.8001, longitude: 0.5001, speed: 3, attributes: {} },
      ] : []));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => traccar.listen(0, "127.0.0.1", () => {
    traccarUrl = `http://127.0.0.1:${(traccar.address() as AddressInfo).port}`;
    resolve();
  }));
}

describe.skipIf(!url)("intégrations (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let other: { farmId: string; userId: string; headers: Record<string, string> };
  let integrationId = "";
  const base = () => `/api/v1/farms/${farmId}`;
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(`${base()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  beforeAll(async () => {
    await fakeTraccar();
    const o = await setupFarm(sql, "Ferme intégrations");
    farmId = o.farmId;
    owner = o;
    worker = await addMember(sql, farmId, "worker");
    other = await setupFarm(sql, "Ferme voisine");
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${crypto.randomUUID()}, ${farmId}, 'Tracteur Fendt', 'tractor')`;
  });
  afterAll(async () => {
    await Promise.all(pendingSyncs);
    await teardown(sql, farmId, [owner.userId, worker.userId]);
    await teardown(sql, other.farmId, [other.userId]);
    await sql.end();
    await new Promise((r) => traccar.close(r));
  });

  it("réservé au responsable ; le catalogue des fournisseurs décrit les champs", async () => {
    expect((await call("GET", "/integrations", worker.headers)).status).toBe(403);
    expect((await call("PUT", "/integrations/traccar", worker.headers, { settings: { url: traccarUrl }, secret: TOKEN })).status).toBe(403);
    const r = await (await call("GET", "/integrations", owner.headers)).json();
    expect(r.items).toEqual([]);
    expect(r.providers[0]).toMatchObject({ provider: "traccar", fields: [{ key: "url" }, { key: "token", kind: "secret" }] });
  });

  it("un jeton refusé par Traccar n'est pas enregistré", async () => {
    const res = await call("PUT", "/integrations/traccar", owner.headers, { settings: { url: traccarUrl }, secret: "mauvais-jeton-xyz" });
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/Connexion impossible.*refuse/);
    expect(await sql`SELECT 1 FROM integrations WHERE farm_id = ${farmId}`).toHaveLength(0);
  });

  it("configuration testée puis enregistrée : secret chiffré, jamais renvoyé", async () => {
    const res = await call("PUT", "/integrations/traccar", owner.headers, { settings: { url: traccarUrl }, secret: TOKEN });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    const r = JSON.parse(text);
    integrationId = r.integration.id;
    expect(r.integration).toMatchObject({ provider: "traccar", hasSecret: true, secretHint: "4242", status: "pending" });
    expect(r.test).toEqual({
      devices: 2,
      matched: [{ device: "Tracteur Fendt", equipment: "Tracteur Fendt" }],
      unmatched: [{ device: "Boîtier orphelin", reason: "aucun matériel de ce nom" }],
    });
    const [row] = await sql`SELECT secret_ciphertext FROM integrations WHERE id = ${integrationId}`;
    expect(row?.secret_ciphertext).toMatch(/^v1:/);
    expect(row?.secret_ciphertext).not.toContain(TOKEN);
    expect(await (await call("GET", "/integrations", owner.headers)).text()).not.toContain(TOKEN);
  });

  it("modifier l'adresse sans ressaisir le jeton garde le secret", async () => {
    const res = await call("PUT", "/integrations/traccar", owner.headers, { settings: { url: `${traccarUrl}/` } });
    expect(res.status).toBe(200);
    expect((await res.json()).integration).toMatchObject({ hasSecret: true, secretHint: "4242" });
  });

  it("synchronisation : positions rattachées au matériel, état et rapport", async () => {
    const res = await call("POST", `/integrations/${integrationId}/sync`, owner.headers);
    expect([200, 202]).toContain(res.status);
    await Promise.all(pendingSyncs);
    const [item] = (await (await call("GET", "/integrations", owner.headers)).json()).items;
    expect(item).toMatchObject({ status: "ok", running: false, lastError: null });
    expect(item.lastReport).toMatchObject({ inserted: 2, unmatched: [{ device: "Boîtier orphelin" }] });
    const [{ n }] = (await sql`SELECT count(*)::int AS n FROM positions WHERE farm_id = ${farmId}`) as unknown as [{ n: number }];
    expect(n).toBe(2);
  });

  it("une synchro déjà en cours renvoie un conflit", async () => {
    await sql`UPDATE integrations SET running_since = now() WHERE id = ${integrationId}`;
    expect((await call("POST", `/integrations/${integrationId}/sync`, owner.headers)).status).toBe(409);
    await sql`UPDATE integrations SET running_since = NULL WHERE id = ${integrationId}`;
  });

  it("le worker trouve les intégrations à synchroniser, sans leurs secrets", async () => {
    await sql`UPDATE integrations SET last_sync_at = now() - interval '5 minutes' WHERE id = ${integrationId}`;
    const due = await dueIntegrations(db(), "1 minute");
    const mine = due.find((d) => d.id === integrationId);
    expect(mine).toEqual({ id: integrationId, farm_id: farmId, provider: "traccar" });
  });

  it("cloisonnement : une autre ferme ne voit ni ne synchronise cette intégration", async () => {
    const r = await (await app.request(`/api/v1/farms/${other.farmId}/integrations`, { headers: other.headers })).json();
    expect(r.items).toEqual([]);
    const res = await app.request(`/api/v1/farms/${other.farmId}/integrations/${integrationId}/sync`, {
      method: "POST",
      headers: other.headers,
    });
    expect(res.status).toBe(404);
  });

  it("retirer l'intégration supprime le secret, garde les positions", async () => {
    expect((await call("DELETE", `/integrations/${integrationId}`, owner.headers)).status).toBe(204);
    expect(await sql`SELECT 1 FROM integrations WHERE id = ${integrationId}`).toHaveLength(0);
    expect((await sql`SELECT count(*)::int AS n FROM positions WHERE farm_id = ${farmId}`)[0]?.n).toBe(2);
  });
});

describe("adresse d'un service externe", () => {
  it("hors développement : https et adresse publique exigés", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(externalUrl("https://traccar.osfarm.org/", "Serveur")).toBe("https://traccar.osfarm.org");
      for (const bad of ["http://traccar.osfarm.org", "https://localhost:8082", "https://10.0.0.5", "https://192.168.1.2",
        "https://api:3000.internal", "https://user:pw@traccar.osfarm.org", "pas une url"]) {
        expect(() => externalUrl(bad, "Serveur"), bad).toThrow();
      }
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
