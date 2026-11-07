import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/** Cycle de synchro mobile (WatermelonDB) contre la vraie base. */
const url = process.env.DATABASE_URL;
const app = createApp();
const parcelId = crypto.randomUUID();
const articleId = crypto.randomUUID();
const personId = crypto.randomUUID();
const placeId = crypto.randomUUID();
const tankId = crypto.randomUUID();
const square = (d: number) => ({
  type: "MultiPolygon",
  coordinates: [[[[0.5, 44.8], [0.5 + d, 44.8], [0.5 + d, 44.8 + d], [0.5, 44.8 + d], [0.5, 44.8]]]],
});

describe.skipIf(!url)("synchro mobile (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let mobile: { userId: string; headers: Record<string, string> };
  let base = "";
  let t1 = "";

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test synchro");
    farmId = o.farmId;
    owner = o;
    mobile = await addMember(sql, farmId, "worker");
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Pré du bas')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(square(0.0013))}), 4326),
              10000, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${articleId}, ${farmId}, 'Herbicide Y', 'phyto', 'liter', '2000123')`;
    await sql`INSERT INTO people (id, farm_id, name, user_id) VALUES (${personId}, ${farmId}, 'Dominique', ${mobile.userId})`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${placeId}, ${farmId}, 'Chai')`;
    await sql`INSERT INTO place_versions (id, place_id, kind, source, valid) VALUES (${crypto.randomUUID()}, ${placeId}, 'building', 'manual', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO containers (id, farm_id, place_id, name) VALUES (${tankId}, ${farmId}, ${placeId}, 'Cuve 1')`;
    await sql`INSERT INTO container_versions (id, container_id, kind, capacity_l, placement, valid)
      VALUES (${crypto.randomUUID()}, ${tankId}, 'tank', 5000, 'auto', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${crypto.randomUUID()}, ${farmId}, 'Pulvérisateur', 'sprayer')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [owner.userId, mobile.userId]);
    await sql.end();
  });

  const pull = async (last?: string) =>
    (await app.request(`${base}/sync/pull${last ? `?lastPulledAt=${encodeURIComponent(last)}` : ""}`, { headers: mobile.headers })).json();
  const push = (body: unknown) =>
    app.request(`${base}/sync/push`, { method: "POST", headers: mobile.headers, body: JSON.stringify(body) });
  const done = (id: string, articleRef = articleId) => ({
    id,
    procedure: "spraying",
    status: "done",
    periods: [{ startedAt: "2026-05-02T07:00:00Z", stoppedAt: "2026-05-02T08:00:00Z" }],
    targets: [{ kind: "land_parcel", id: parcelId }],
    inputs: [{ articleId: articleRef, quantity: 1.5, per: "hectare" }],
    doers: [{ personId }],
    purposes: ["herbicide"],
  });

  it("premier pull : tout arrive en « created », parcelle prête pour la carte", async () => {
    const r = await pull();
    t1 = r.timestamp;
    const p = r.changes.land_parcels.created[0];
    expect(p).toMatchObject({ id: parcelId, name: "Pré du bas", area_hectares: 1, valid_to: null });
    expect(JSON.parse(p.geometry_geojson).type).toBe("MultiPolygon");
    expect(p.shape_svg).toMatch(/^M /);
    expect(r.changes.articles.created).toHaveLength(1);
    expect(r.changes.equipments.created).toHaveLength(1);
    expect(r.changes.people.created).toEqual([
      expect.objectContaining({ id: personId, name: "Dominique", active: true, user_id: mobile.userId }),
    ]);
    expect(r.changes.places.created).toEqual([expect.objectContaining({ id: placeId, name: "Chai" })]);
    expect(r.changes.containers.created).toEqual([
      expect.objectContaining({ id: tankId, name: "Cuve 1", place_id: placeId, capacity_l: 5000 }),
    ]);
  });

  it("pull incrémental sans changement : vide", async () => {
    const r = await pull(t1);
    for (const c of Object.values(r.changes) as { created: unknown[]; updated: unknown[]; deleted: unknown[] }[]) {
      expect(c.created.length + c.updated.length + c.deleted.length).toBe(0);
    }
  });

  it("une parcelle versionnée sur le web revient en « updated » au pull suivant", async () => {
    const res = await app.request(`${base}/land-parcels/${parcelId}`, {
      method: "PATCH", headers: owner.headers, body: JSON.stringify({ name: "Pré du bas", shape: square(0.002) }),
    });
    expect(res.status).toBe(200);
    const r = await pull(t1);
    expect(r.changes.land_parcels.updated.map((p: { id: string }) => p.id)).toEqual([parcelId]);
  });

  it("push d'une intervention réalisée hors-ligne : appliquée, stock mouvementé, re-push idempotent", async () => {
    const id = crypto.randomUUID();
    const body = { lastPulledAt: t1, changes: { interventions: { created: [done(id)], updated: [], deleted: [] } } };
    const first = await (await push(body)).json();
    expect(first).toEqual({ applied: [{ id, outcome: "completed" }], failed: [] });
    // Surface valide à la DATE de l'intervention (2 mai : ancienne version, 1 ha),
    // et non la parcelle agrandie aujourd'hui sur le web : 1,5 L/ha × 1 ha.
    const [m] = await sql`SELECT quantity::float8 AS q FROM stock_movements WHERE intervention_id = ${id}`;
    expect(m?.q).toBe(-1.5);
    const [i] = await sql`SELECT origin, client_id FROM interventions WHERE id = ${id}`;
    expect(i).toEqual({ origin: "mobile", client_id: id });

    const again = await (await push(body)).json();
    expect(again).toEqual({ applied: [{ id, outcome: "unchanged" }], failed: [] });
    const count = await sql`SELECT count(*)::int AS n FROM stock_movements WHERE intervention_id = ${id}`;
    expect(count[0]?.n).toBe(1);
  });

  it("un enregistrement invalide échoue seul, avec son motif ; la suppression est refusée", async () => {
    const ok = crypto.randomUUID();
    const bad = crypto.randomUUID();
    const res = await push({
      lastPulledAt: t1,
      changes: { interventions: { created: [done(ok), done(bad, crypto.randomUUID())], updated: [], deleted: [ok] } },
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.applied).toEqual([{ id: ok, outcome: "completed" }]);
    expect(r.failed.map((f: { id: string }) => f.id)).toEqual([bad, ok]);
    expect(r.failed[0].error).toMatch(/article inconnu/);
    expect(r.failed[1].error).toMatch(/Suppression/);
    // Tout ou rien : l'intervention rejetée n'a laissé aucune trace côté serveur.
    expect(await sql`SELECT 1 FROM interventions WHERE id = ${bad}`).toHaveLength(0);
  });

  it("conflit : une intervention modifiée sur le web depuis le pull renvoie 409", async () => {
    const id = crypto.randomUUID();
    const created = await app.request(`${base}/interventions`, {
      method: "POST", headers: owner.headers, body: JSON.stringify({ id, procedure: "spraying" }),
    });
    expect(created.status).toBe(201);
    const res = await push({ lastPulledAt: t1, changes: { interventions: { created: [], updated: [done(id)], deleted: [] } } });
    expect(res.status).toBe(409);
  });

  it("les interventions poussées redescendent au pull suivant", async () => {
    const r = await pull(t1);
    const fromMobile = r.changes.interventions.updated.filter((i: { origin: string }) => i.origin === "mobile");
    expect(fromMobile.length).toBe(2);
    expect(fromMobile.every((i: { status: string }) => i.status === "done")).toBe(true);
    const body = JSON.parse(fromMobile[0].body_json);
    expect(body.inputs).toEqual([{ articleId, quantity: 1.5, per: "hectare", unit: "liter" }]);
    expect(body).toMatchObject({ purposes: ["herbicide"], doers: [{ personId }] });
    expect(body.periods).toHaveLength(1);
  });
});
