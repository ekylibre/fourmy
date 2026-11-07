import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/** Appartenance et rôles : qui peut entrer dans une ferme, et y faire quoi. */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("autorisations (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  let outsider: { farmId: string; userId: string; headers: Record<string, string> };
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
    await teardown(sql, farmId, [owner.userId, worker.userId]);
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
});
