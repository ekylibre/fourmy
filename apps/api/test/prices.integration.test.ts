import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/** Prix datés de la ferme (temps 3, lot E1) : ajout en masse, en vigueur à une date, historique, droits, refus. */
const url = process.env.DATABASE_URL;
const app = createApp();
const ammo = crypto.randomUUID();
const wheat = crypto.randomUUID();

describe.skipIf(!url)("prix de la ferme (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let otherFarm = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const send = (h: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test prix");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    otherFarm = (await setupFarm(sql, "Autre ferme prix")).farmId;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${ammo}, ${farmId}, 'Ammonitrate 33,5', 'fertilizer', 'ton')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${wheat}, ${farmId}, 'Blé tendre', 'plant_farming')`;
  });
  afterAll(async () => {
    await teardown(sql, otherFarm, []);
    await teardown(sql, farmId, users);
    await sql.end();
  });

  it("ajout en masse, en vigueur à une date, historique gardé", async () => {
    expect((await send(worker, "POST", "/prices", { items: [{ kind: "labour", unit: "hour", amount: 20, validFrom: "2026-01-01" }] })).status).toBe(403);
    const res = await send(owner, "POST", "/prices", {
      items: [
        { kind: "article", articleId: ammo, unit: "ton", amount: 500, validFrom: "2026-01-01" },
        { kind: "article", articleId: ammo, unit: "ton", amount: 580.5, validFrom: "2026-11-01", source: "lexicon", sourceRef: "ammonitrate_33", sourceDate: "2026-11-01" },
        { kind: "labour", unit: "hour", amount: 22, validFrom: "2026-01-01" },
        { kind: "product", activityId: wheat, product: "grain", unit: "ton", amount: 210, validFrom: "2026-07-01" },
        { kind: "service", procedure: "harvesting", unit: "hectare", amount: 150, validFrom: "2026-01-01" },
      ],
    });
    expect(res.status).toBe(201);
    expect((await res.json()).items).toHaveLength(5);
    const june = await (await send(worker, "GET", "/prices?kind=article&at=2026-06-30")).json();
    expect(june.items.map((p: { amount: number }) => p.amount)).toEqual([500]);
    const dec = await (await send(worker, "GET", "/prices?at=2026-12-01")).json();
    expect(dec.items).toHaveLength(4);
    expect(dec.items.find((p: { kind: string }) => p.kind === "article")).toMatchObject({ amount: 580.5, source: "lexicon", sourceDate: "2026-11-01" });
    const history = await (await send(worker, "GET", "/prices?kind=article&history=1")).json();
    expect(history.items.map((p: { amount: number }) => p.amount)).toEqual([580.5, 500]);
  });

  it("refuse une clé incohérente ou un article d'une autre ferme ; suppression d'une ligne", async () => {
    expect((await send(owner, "POST", "/prices", { items: [{ kind: "article", unit: "ton", amount: 1, validFrom: "2026-01-01" }] })).status).toBe(400);
    const foreign = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${foreign}, ${otherFarm}, 'Voisin', 'fertilizer', 'ton')`;
    expect((await send(owner, "POST", "/prices", { items: [{ kind: "article", articleId: foreign, unit: "ton", amount: 1, validFrom: "2026-01-01" }] })).status).toBe(400);
    const list = await (await send(owner, "GET", "/prices?kind=labour")).json();
    expect((await send(owner, "DELETE", `/prices/${list.items[0].id}`)).status).toBe(204);
    expect((await (await send(owner, "GET", "/prices?kind=labour")).json()).items).toEqual([]);
  });
});
