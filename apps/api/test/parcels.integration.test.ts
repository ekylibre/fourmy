import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Parcellaire de bout en bout contre la vraie base (contrats + db + domaine
 * + api + RLS). Ne s'exécute que si DATABASE_URL pointe une base migrée.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
let farmId = "";
let userId = "";
let headers: Record<string, string> = {};
let base = "";

const square = (d: number) => ({
  type: "MultiPolygon" as const,
  coordinates: [[[[0.5, 44.8], [0.5 + d, 44.8], [0.5 + d, 44.8 + d], [0.5, 44.8 + d], [0.5, 44.8]]]],
});

describe.skipIf(!url)("parcellaire (intégration)", () => {
  const sql = postgres(url!, { max: 1 });

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme de test"));
    base = `/api/v1/farms/${farmId}`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("crée une parcelle avec surface calculée par PostGIS", async () => {
    const res = await app.request(`${base}/land-parcels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Les Rouffiats", shape: square(0.01) }),
    });
    expect(res.status).toBe(201);
    const v = await res.json();
    expect(v.areaM2).toBeGreaterThan(0);
    expect(v.valid.upper).toBeNull();
  });

  it("versionne la parcelle : l'ancienne version est close, une nouvelle s'ouvre", async () => {
    const list = await (await app.request(`${base}/land-parcels`, { headers })).json();
    const parcelId = list.items[0].id;
    expect(list.items[0].name).toBe("Les Rouffiats");

    const patched = await app.request(`${base}/land-parcels/${parcelId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Les Rouffiats", shape: square(0.02) }),
    });
    expect(patched.status).toBe(200);

    // Deux versions au total, une seule ouverte.
    const rows = await sql`
      SELECT upper(valid) AS upper FROM land_parcel_versions v
      JOIN land_parcels p ON p.id = v.land_parcel_id
      WHERE p.farm_id = ${farmId}`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.upper === null)).toHaveLength(1);
  });

  it("liste les noms de toutes les parcelles, même sans version à la date du jour", async () => {
    // Parcelle close l'an dernier : absente du parcellaire du jour, présente dans les noms.
    const oldId = crypto.randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${oldId}, ${farmId}, 'Ancienne vigne')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${oldId}, ST_Multi(ST_GeomFromText('POLYGON((1 45,1.001 45,1.001 45.001,1 45.001,1 45))', 4326)), 8000, tstzrange('2020-01-01', '2021-01-01'))`;
    const today = await (await app.request(`${base}/land-parcels`, { headers })).json();
    expect(today.items.map((p: { name: string }) => p.name)).not.toContain("Ancienne vigne");
    const names = await (await app.request(`${base}/land-parcels/names`, { headers })).json();
    expect(names.items).toEqual(expect.arrayContaining([{ id: oldId, name: "Ancienne vigne" }, expect.objectContaining({ name: "Les Rouffiats" })]));
  });

  it("une ferme dont on n'est pas membre est refusée (403)", async () => {
    const otherFarm = `/api/v1/farms/${crypto.randomUUID()}`;
    const res = await app.request(`${otherFarm}/land-parcels`, { headers });
    expect(res.status).toBe(403);
  });
});
