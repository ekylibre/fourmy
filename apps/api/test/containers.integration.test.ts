import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";

/** Correction tracée d'une cuve, contre la vraie base (RLS, audit). */
const url = process.env.DATABASE_URL;
const app = createApp();
const farmId = crypto.randomUUID();
const placeId = crypto.randomUUID();
const containerId = crypto.randomUUID();
const headers = { "x-user-id": "testeur", "content-type": "application/json" };
const base = `/api/v1/farms/${farmId}`;

describe.skipIf(!url)("cuves (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    await sql`INSERT INTO farms (id, name) VALUES (${farmId}, 'Ferme test cuves')`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${placeId}, ${farmId}, 'Chai')`;
    await sql`INSERT INTO containers (id, farm_id, place_id, name) VALUES (${containerId}, ${farmId}, ${placeId}, 'GV1')`;
    await sql`INSERT INTO container_versions (id, container_id, kind, capacity_l, placement, valid)
              VALUES (${crypto.randomUUID()}, ${containerId}, 'tank', 100000, 'auto', tstzrange('2020-01-01', NULL))`;
  });
  afterAll(async () => {
    await sql`DELETE FROM farms WHERE id = ${farmId}`;
    await sql.end();
  });

  it("corrige la capacité et trace l'avant, l'après et le motif", async () => {
    const res = await app.request(`${base}/containers/${containerId}/corrections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ capacityL: 1000, reason: "saisie en hl au lieu de L" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).version.capacityL).toBe(1000);

    // L'historique est réparé : à une date passée, la cuve fait bien 1000 L.
    const past = await (await app.request(`${base}/containers?at=2021-06-01T00:00:00Z`, { headers })).json();
    expect(past.items[0].version.capacityL).toBe(1000);

    const [audit] = await sql`SELECT actor, diff FROM audit_log WHERE farm_id = ${farmId} AND action = 'corrected'`;
    expect(audit?.actor).toBe("testeur");
    expect(audit?.diff).toEqual({
      reason: "saisie en hl au lieu de L",
      changes: { capacityL: { before: 100000, after: 1000 } },
    });
  });

  it("refuse une correction sans effet (422) et une cuve inconnue (404)", async () => {
    const same = await app.request(`${base}/containers/${containerId}/corrections`, {
      method: "POST", headers, body: JSON.stringify({ capacityL: 1000, reason: "rejouée" }),
    });
    expect(same.status).toBe(422);
    const unknown = await app.request(`${base}/containers/${crypto.randomUUID()}/corrections`, {
      method: "POST", headers, body: JSON.stringify({ capacityL: 10, reason: "inconnue" }),
    });
    expect(unknown.status).toBe(404);
  });
});
