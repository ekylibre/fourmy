import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * US-2 de bout en bout : un salarié planifie puis réalise un traitement ;
 * le stock et le registre phyto suivent. Valeurs connues d'avance.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const parcelId = crypto.randomUUID();
const hangarId = crypto.randomUUID();
const cuveId = crypto.randomUUID();
const fongicideId = crypto.randomUUID();
const raisinId = crypto.randomUUID();
const lotA = crypto.randomUUID();

describe.skipIf(!url)("interventions (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let ownerId = "";
  let worker: { userId: string; headers: Record<string, string> };
  let base = "";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test interventions");
    farmId = owner.farmId;
    ownerId = owner.userId;
    worker = await addMember(sql, farmId, "worker");
    base = `/api/v1/farms/${farmId}`;
    // Parcelle de 1 ha, hangar, cuve, fongicide (AMM) avec 20 L en stock, raisin.
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Les Vignes')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326),
              10000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${crypto.randomUUID()}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${hangarId}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO place_versions (id, place_id, kind, source, valid) VALUES (${crypto.randomUUID()}, ${hangarId}, 'building', 'manual', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO containers (id, farm_id, place_id, name) VALUES (${cuveId}, ${farmId}, ${hangarId}, 'Cuve 1')`;
    await sql`INSERT INTO container_versions (id, container_id, kind, capacity_l, placement, valid) VALUES (${crypto.randomUUID()}, ${cuveId}, 'tank', 5000, 'auto', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${fongicideId}, ${farmId}, 'Fongicide X', 'phyto', 'liter', '2100001')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${raisinId}, ${farmId}, 'Raisin', 'harvest', 'liter')`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lotA}, ${farmId}, ${fongicideId}, 'LOT-A')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${lotA}, ${hangarId}, 20, 'liter', '2026-03-01', 'purchase')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId, worker.userId]);
    await sql.end();
  });

  const post = (path: string, body: unknown) =>
    app.request(`${base}${path}`, { method: "POST", headers: worker.headers, body: JSON.stringify(body) });
  const get = async (path: string) => (await app.request(`${base}${path}`, { headers: worker.headers })).json();

  const spraying = (dose: number, unit = "liter_per_hectare", stock?: object) => [
    { role: "target", refType: "land_parcel", refId: parcelId, quantity: null, unit: null },
    { role: "input", refType: "article", refId: fongicideId, quantity: dose, unit, stock },
  ];
  const plannedId = crypto.randomUUID();

  it("un salarié planifie un traitement ; la planification est idempotente", async () => {
    const body = { id: plannedId, procedure: "spraying", startedAt: "2026-06-10T08:00:00Z", parameters: spraying(2) };
    const first = await post("/interventions", body);
    expect(first.status).toBe(201);
    expect((await first.json()).status).toBe("planned");
    const again = await post("/interventions", body);
    expect(again.status).toBe(200);
  });

  it("il le réalise : 2 L/ha × 1 ha = 2 L sortis du lot en stock, au hangar", async () => {
    const res = await post(`/interventions/${plannedId}/complete`, {
      startedAt: "2026-06-10T08:00:00Z",
      stoppedAt: "2026-06-10T09:00:00Z",
      parameters: spraying(2),
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.intervention.status).toBe("done");
    expect(r.warnings).toEqual([]);
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]).toMatchObject({ lotId: lotA, placeId: hangarId, quantity: -2, unit: "liter" });

    const stock = await get(`/stock?at=2026-06-11T00:00:00Z&article=${fongicideId}`);
    expect(stock.items).toEqual([expect.objectContaining({ lotCode: "LOT-A", quantity: 18 })]);

    const register = await get("/registers/phyto?campaign=2026");
    expect(register.items).toEqual([
      expect.objectContaining({ parcelName: "Les Vignes", productName: "Fongicide X", amm: "2100001", quantity: 2, unit: "liter_per_hectare" }),
    ]);
  });

  it("une intervention réalisée ne se réalise pas deux fois (409)", async () => {
    const res = await post(`/interventions/${plannedId}/complete`, {
      startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T09:00:00Z", parameters: spraying(2),
    });
    expect(res.status).toBe(409);
  });

  it("une surconsommation est acceptée mais signalée (stock négatif)", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "spraying", parameters: [] });
    const res = await post(`/interventions/${id}/complete`, {
      startedAt: "2026-06-20T08:00:00Z", stoppedAt: "2026-06-20T09:00:00Z",
      parameters: spraying(2, "liter_per_hectare", { quantity: 50 }),
    });
    const r = await res.json();
    expect(r.movements[0].quantity).toBe(-50);
    expect(r.warnings[0]).toMatch(/stock négatif/);
    const stock = await get(`/stock?at=2026-06-21T00:00:00Z&article=${fongicideId}`);
    expect(stock.items[0].quantity).toBe(-32);
  });

  it("une récolte sans lieu est refusée (422), puis rangée en cuve", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "harvesting", parameters: [] });
    const output = (stock?: object) => [
      { role: "target", refType: "land_parcel", refId: parcelId, quantity: null, unit: null },
      { role: "output", refType: "article", refId: raisinId, quantity: 300, unit: "liter", stock },
    ];
    const window = { startedAt: "2026-09-15T08:00:00Z", stoppedAt: "2026-09-15T12:00:00Z" };
    expect((await post(`/interventions/${id}/complete`, { ...window, parameters: output() })).status).toBe(422);
    const ok = await post(`/interventions/${id}/complete`, { ...window, parameters: output({ containerId: cuveId }) });
    expect(ok.status).toBe(200);
    const contents = await get(`/containers/${cuveId}/contents?at=2026-09-16T00:00:00Z`);
    expect(contents.volumeL).toBe(300);
    expect(contents.composition[0].lotCode).toBe("Raisin 2026-09-15");
  });

  it("une unité incohérente est refusée plutôt que devinée (422)", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "spraying", parameters: [] });
    const res = await post(`/interventions/${id}/complete`, {
      startedAt: "2026-07-01T08:00:00Z", stoppedAt: "2026-07-01T09:00:00Z",
      parameters: spraying(3, "kilogram_per_hectare"),
    });
    expect(res.status).toBe(422);
    // Et rien n'a été écrit (transaction annulée) : l'intervention reste planifiée.
    const list = await get("/interventions?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z&status=planned");
    expect(list.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it("liste les interventions d'une période avec leurs paramètres", async () => {
    const list = await get("/interventions?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z&status=done");
    expect(list.items.length).toBe(3);
    expect(list.items[0].parameters.length).toBeGreaterThan(0);
  });
});
