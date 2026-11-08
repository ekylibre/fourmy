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
  let ownerHeaders: Record<string, string> = {};
  let worker: { userId: string; headers: Record<string, string> };
  let base = "";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test interventions");
    farmId = owner.farmId;
    ownerId = owner.userId;
    ownerHeaders = owner.headers;
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
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${fongicideId}, ${farmId}, 'Fongicide X', 'phyto', 'liter', '9100001')`;
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

  const period = (day: string, from = "08:00", to = "09:00") => ({
    startedAt: `${day}T${from}:00Z`,
    stoppedAt: `${day}T${to}:00Z`,
  });
  const spraying = (dose: number, extra: object = {}) => ({
    targets: [{ kind: "land_parcel", id: parcelId }],
    inputs: [{ articleId: fongicideId, quantity: dose, per: "hectare" }],
    purposes: ["fungicide"],
    ...extra,
  });
  const plannedId = crypto.randomUUID();
  const doneIds: string[] = [];

  it("un salarié planifie un traitement ; la planification est idempotente", async () => {
    const body = { id: plannedId, procedure: "spraying", plannedAt: "2026-06-10T08:00:00Z", ...spraying(2) };
    const first = await post("/interventions", body);
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ status: "planned", startedAt: "2026-06-10T08:00:00.000Z", purposes: ["fungicide"] });
    expect(created.inputs).toEqual([{ articleId: fongicideId, quantity: 2, per: "hectare", unit: "liter" }]);
    const again = await post("/interventions", body);
    expect(again.status).toBe(200);
  });

  it("il le réalise : 2 L/ha × 1 ha = 2 L sortis du lot en stock, au hangar", async () => {
    const res = await post(`/interventions/${plannedId}/complete`, { periods: [period("2026-06-10")], ...spraying(2) });
    expect(res.status).toBe(200);
    const r = await res.json();
    doneIds.push(plannedId);
    expect(r.intervention.status).toBe("done");
    expect(r.intervention.periods).toEqual([{ startedAt: "2026-06-10T08:00:00.000Z", stoppedAt: "2026-06-10T09:00:00.000Z" }]);
    expect(r.warnings).toEqual([]);
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]).toMatchObject({ lotId: lotA, placeId: hangarId, quantity: -2, unit: "liter" });

    const stock = await get(`/stock?at=2026-06-11T00:00:00Z&article=${fongicideId}`);
    expect(stock.items).toEqual([expect.objectContaining({ lotCode: "LOT-A", quantity: 18 })]);

    const register = await get("/registers/phyto?campaign=2026");
    expect(register.items).toEqual([
      expect.objectContaining({ parcelName: "Les Vignes", productName: "Fongicide X", amm: "9100001", quantity: 2, unit: "liter_per_hectare" }),
    ]);
  });

  it("une intervention réalisée ne se réalise pas deux fois (409)", async () => {
    const res = await post(`/interventions/${plannedId}/complete`, { periods: [period("2026-06-10")], ...spraying(2) });
    expect(res.status).toBe(409);
  });

  it("plusieurs périodes, surface traitée partielle : la dose suit la surface réellement traitée", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "spraying" });
    const res = await post(`/interventions/${id}/complete`, {
      periods: [period("2026-06-15", "08:00", "10:00"), period("2026-06-15", "14:00", "16:00")],
      ...spraying(2, { targets: [{ kind: "land_parcel", id: parcelId, workedAreaM2: 5000 }] }),
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    doneIds.push(id);
    expect(r.movements[0].quantity).toBe(-1);
    expect(r.intervention).toMatchObject({ startedAt: "2026-06-15T08:00:00.000Z", stoppedAt: "2026-06-15T16:00:00.000Z" });
    expect(r.intervention.periods).toHaveLength(2);
    expect(r.intervention.targets[0].workedAreaM2).toBe(5000);
  });

  it("une surconsommation est acceptée mais signalée (stock négatif)", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "spraying" });
    const res = await post(`/interventions/${id}/complete`, {
      periods: [period("2026-06-20")],
      ...spraying(50, { inputs: [{ articleId: fongicideId, quantity: 50, per: "total" }] }),
    });
    const r = await res.json();
    doneIds.push(id);
    expect(r.movements[0].quantity).toBe(-50);
    expect(r.warnings[0]).toMatch(/stock négatif/);
    const stock = await get(`/stock?at=2026-06-21T00:00:00Z&article=${fongicideId}`);
    expect(stock.items[0].quantity).toBe(-33);
  });

  it("une récolte sans destination est refusée (422), puis rangée en cuve", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "harvesting" });
    const body = (to?: object) => ({
      periods: [period("2026-09-15", "08:00", "12:00")],
      targets: [{ kind: "land_parcel", id: parcelId }],
      outputs: [{ articleId: raisinId, quantity: 300, per: "total", ...(to ? { to } : {}) }],
    });
    const refused = await post(`/interventions/${id}/complete`, body());
    expect(refused.status).toBe(422);
    const ok = await post(`/interventions/${id}/complete`, body({ containerId: cuveId }));
    expect(ok.status).toBe(200);
    doneIds.push(id);
    const contents = await get(`/containers/${cuveId}/contents?at=2026-09-16T00:00:00Z`);
    expect(contents.volumeL).toBe(300);
    expect(contents.composition[0].lotCode).toBe("Raisin 2026-09-15");
  });

  it("la forme de la procédure est vérifiée (422) et rien n'est écrit", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "spraying" });
    // Un traitement sans produit phyto, des motifs sur un travail du sol, des périodes qui se chevauchent.
    const noPhyto = await post(`/interventions/${id}/complete`, {
      periods: [period("2026-07-01")], targets: [{ kind: "land_parcel", id: parcelId }],
    });
    expect(noPhyto.status).toBe(422);
    const overlap = await post(`/interventions/${id}/complete`, {
      periods: [period("2026-07-01", "08:00", "10:00"), period("2026-07-01", "09:00", "11:00")], ...spraying(1),
    });
    expect(overlap.status).toBe(422);
    const plowing = await post("/interventions", { procedure: "plowing", purposes: ["herbicide"], targets: [{ kind: "land_parcel", id: parcelId }] });
    expect(plowing.status).toBe(422);
    const list = await get("/interventions?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z&status=planned");
    expect(list.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it("une référence inconnue est refusée (400)", async () => {
    const res = await post("/interventions", { procedure: "spraying", ...spraying(1, { tools: [{ equipmentId: crypto.randomUUID() }] }) });
    expect(res.status).toBe(400);
    expect((await res.json()).detail).toMatch(/Matériel introuvable/);
  });

  it("liste les interventions d'une période, structurées", async () => {
    const list = await get("/interventions?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z&status=done");
    expect(list.items.length).toBe(doneIds.length);
    expect(list.items.every((i: { targets: unknown[] }) => i.targets.length > 0)).toBe(true);
  });

  it("une personne de la ferme est désignée comme intervenant (propriétaire seul pour la créer)", async () => {
    const refused = await post("/people", { name: "Camille" });
    expect(refused.status).toBe(403);
    const res = await app.request(`${base}/people`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "Camille", role: "tractoriste" }) });
    expect(res.status).toBe(201);
    const person = await res.json();
    const planned = await post("/interventions", { procedure: "plowing", targets: [{ kind: "land_parcel", id: parcelId }], doers: [{ personId: person.id }] });
    expect(planned.status).toBe(201);
    expect((await planned.json()).doers).toEqual([{ personId: person.id }]);
    expect((await get("/people")).items.map((p: { name: string }) => p.name)).toEqual(["Camille"]);
  });

  it("annuler une intervention réalisée contre-passe ses mouvements et la retire du registre", async () => {
    expect((await post(`/interventions/${plannedId}/cancel`, {})).status).toBe(400);
    const res = await post(`/interventions/${plannedId}/cancel`, { reason: "saisie en double" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("cancelled");
    const stock = await get(`/stock?at=2026-06-21T00:00:00Z&article=${fongicideId}`);
    expect(stock.items[0].quantity).toBe(-31);
    const register = await get("/registers/phyto?campaign=2026");
    expect(register.items.map((i: { interventionId: string }) => i.interventionId)).not.toContain(plannedId);
    expect((await post(`/interventions/${plannedId}/cancel`, { reason: "encore" })).status).toBe(409);
  });

  it("le catalogue des procédures suggère ce que la ferme utilise", async () => {
    const r = await get("/procedures");
    expect(Object.keys(r.shapes)).toHaveLength(6);
    const spray = r.items.find((p: { code: string }) => p.code === "spraying");
    expect(spray).toMatchObject({ shape: "treatment", inputKinds: ["phyto"] });
    expect(spray.usage).toBe(2); // 3 réalisés, dont 1 annulé depuis
    expect(spray.suggestions.inputs).toEqual([fongicideId]);
  });
});
