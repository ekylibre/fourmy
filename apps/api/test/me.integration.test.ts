import { FULL_GRANT } from "@fourmy/domain";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/** « Mes fermes » et catalogue d'articles. */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("mes fermes, articles (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let a: Awaited<ReturnType<typeof setupFarm>>;
  let b: Awaited<ReturnType<typeof setupFarm>>;
  let workerOnA: Awaited<ReturnType<typeof addMember>>;

  beforeAll(async () => {
    a = await setupFarm(sql, "Ferme Alpha");
    b = await setupFarm(sql, "Ferme Bêta");
    workerOnA = await addMember(sql, a.farmId, "worker");
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES
      (${crypto.randomUUID()}, ${a.farmId}, 'Fongicide', 'phyto', 'liter', '1'),
      (${crypto.randomUUID()}, ${a.farmId}, 'Ammonitrate', 'fertilizer', 'kilogram', NULL)`;
  });
  afterAll(async () => {
    await teardown(sql, a.farmId, [a.userId, workerOnA.userId]);
    await teardown(sql, b.farmId, [b.userId]);
    await sql.end();
  });

  it("chacun ne voit que ses fermes, avec son rôle", async () => {
    const mine = await (await app.request("/api/v1/me/farms", { headers: workerOnA.headers })).json();
    // Droits effectifs (lot AM3) : un salarié a tous les modules.
    expect(mine.items).toEqual([{ id: a.farmId, name: "Ferme Alpha", role: "worker", onboarding: null, grant: FULL_GRANT }]);
    const other = await (await app.request("/api/v1/me/farms", { headers: b.headers })).json();
    expect(other.items).toEqual([{ id: b.farmId, name: "Ferme Bêta", role: "owner", onboarding: null, grant: FULL_GRANT }]);
    expect((await app.request("/api/v1/me/farms")).status).toBe(401);
  });

  it("catalogue d'articles, filtrable par nature", async () => {
    const all = await (await app.request(`/api/v1/farms/${a.farmId}/articles`, { headers: a.headers })).json();
    expect(all.items.map((x: { name: string }) => x.name)).toEqual(["Ammonitrate", "Fongicide"]);
    const phyto = await (await app.request(`/api/v1/farms/${a.farmId}/articles?kind=phyto`, { headers: a.headers })).json();
    expect(phyto.items).toEqual([expect.objectContaining({ name: "Fongicide", amm: "1", unit: "liter" })]);
    expect((await app.request(`/api/v1/farms/${a.farmId}/articles?kind=x`, { headers: a.headers })).status).toBe(400);
  });
});
