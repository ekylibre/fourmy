import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/** Cycle de synchro mobile (WatermelonDB) contre la vraie base. */
const url = process.env.DATABASE_URL;
const app = createApp();
const parcelId = crypto.randomUUID();
const articleId = crypto.randomUUID();
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
  const done = (id: string, unit = "liter_per_hectare") => ({
    id,
    procedure: "spraying",
    status: "done",
    started_at: Date.parse("2026-05-02T07:00:00Z"),
    stopped_at: Date.parse("2026-05-02T08:00:00Z"),
    parameters: [
      { role: "target", refType: "land_parcel", refId: parcelId, quantity: null, unit: null },
      { role: "input", refType: "article", refId: articleId, quantity: 1.5, unit },
    ],
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
      changes: { interventions: { created: [done(ok), done(bad, "kilogram_per_hectare")], updated: [], deleted: [ok] } },
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.applied).toEqual([{ id: ok, outcome: "completed" }]);
    expect(r.failed.map((f: { id: string }) => f.id)).toEqual([bad, ok]);
    expect(r.failed[0].error).toMatch(/incompatible/);
    expect(r.failed[1].error).toMatch(/Suppression/);
    // Tout ou rien : l'intervention rejetée n'a laissé aucune trace côté serveur.
    expect(await sql`SELECT 1 FROM interventions WHERE id = ${bad}`).toHaveLength(0);
  });

  it("conflit : une intervention modifiée sur le web depuis le pull renvoie 409", async () => {
    const id = crypto.randomUUID();
    const created = await app.request(`${base}/interventions`, {
      method: "POST", headers: owner.headers, body: JSON.stringify({ id, procedure: "spraying", parameters: [] }),
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
    expect(JSON.parse(fromMobile[0].parameters_json)).toHaveLength(2);
  });
});
