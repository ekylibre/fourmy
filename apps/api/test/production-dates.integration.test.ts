import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Productions datées (lot IM2) : la culture en place à une date
 * (`fourmy_production_at`), et l'alerte de saisie quand deux cultures datées
 * d'une même parcelle se recoupent pendant l'intervention.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("productions datées (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  const parcel = crypto.randomUUID();
  const ids = { maize: crypto.randomUUID(), spinach: crypto.randomUUID(), undated: crypto.randomUUID() };

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test productions datées");
    farmId = o.farmId;
    owner = o;
    const c26 = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${c26}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Grande pièce')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
              VALUES (${crypto.randomUUID()}, ${parcel}, ST_Multi(ST_GeomFromText('POLYGON((1 46,1.01 46,1.01 46.01,1 46.01,1 46))', 4326)), 100000,
                      tstzrange('2025-01-01', NULL))`;
    const act = async (name: string) => {
      const id = crypto.randomUUID();
      await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${id}, ${farmId}, ${name}, 'plant_farming')`;
      return id;
    };
    const [a1, a2] = [await act("Maïs fourrage"), await act("Épinard")];
    const prod = (id: string, activity: string, from: string | null, to: string | null) =>
      sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id, started_on, stopped_on)
          VALUES (${id}, ${farmId}, ${c26}, ${parcel}, 'field_crop', ${activity}, ${from}, ${to})`;
    // Épinard (dérobée) de mars à mai, maïs de mai à septembre : ils se recoupent du 10 au 20 mai.
    await prod(ids.spinach, a2, "2026-03-01", "2026-05-20");
    await prod(ids.maize, a1, "2026-05-10", "2026-09-15");
  });
  afterAll(async () => {
    await teardown(sql, farmId, [owner.userId]);
    await sql.end();
  });

  const at = async (day: string) => {
    const [r] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('fourmy.farm_id', ${farmId}, true)`;
      await tx`SET LOCAL ROLE fourmy_app`;
      return tx`SELECT fourmy_production_at(${parcel}::uuid, ${day}::date) AS id`;
    });
    return r!.id as string | null;
  };

  it("retient la culture en place à la date", async () => {
    expect(await at("2026-04-01")).toBe(ids.spinach);
    expect(await at("2026-07-01")).toBe(ids.maize);
    // Recoupement : la plus récemment semée.
    expect(await at("2026-05-15")).toBe(ids.maize);
    // Hors des dates des deux cultures, mais dans la campagne : une production de la campagne (comportement d'avant).
    expect([ids.spinach, ids.maize]).toContain(await at("2026-11-01"));
  });

  it("une production non datée de la campagne l'emporte hors des dates des productions datées", async () => {
    const [{ campaign_id: c }] = await sql`SELECT campaign_id FROM productions WHERE id = ${ids.maize}`;
    const [{ activity_id: a }] = await sql`SELECT activity_id FROM productions WHERE id = ${ids.maize}`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id) VALUES (${ids.undated}, ${farmId}, ${c}, ${parcel}, 'field_crop', ${a})`;
    try {
      expect(await at("2026-11-01")).toBe(ids.undated);
      expect(await at("2026-07-01")).toBe(ids.maize);
    } finally {
      await sql`DELETE FROM productions WHERE id = ${ids.undated}`;
    }
  });

  const plan = (plannedAt: string) =>
    app.request(`/api/v1/farms/${farmId}/interventions`, {
      method: "POST",
      headers: owner.headers,
      body: JSON.stringify({ procedure: "hoeing", targets: [{ kind: "land_parcel", id: parcel }], plannedAt }),
    });

  it("alerte à la saisie quand deux cultures datées se recoupent pendant l'intervention", async () => {
    const r = await plan("2026-05-15T08:00:00Z");
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatch(/« Grande pièce » porte 2 cultures qui se recoupent/);
    expect(body.warnings[0]).toMatch(/Épinard \(01\/03\/2026 → 20\/05\/2026\)/);
    expect(body.warnings[0]).toMatch(/retient Maïs fourrage/);
  });

  it("pas d'alerte quand une seule culture est en place", async () => {
    expect((await (await plan("2026-07-01T08:00:00Z")).json()).warnings).toEqual([]);
  });

  it("à la réalisation aussi", async () => {
    const id = crypto.randomUUID();
    await app.request(`/api/v1/farms/${farmId}/interventions`, {
      method: "POST",
      headers: owner.headers,
      body: JSON.stringify({ id, procedure: "hoeing" }),
    });
    const r = await app.request(`/api/v1/farms/${farmId}/interventions/${id}/complete`, {
      method: "POST",
      headers: owner.headers,
      body: JSON.stringify({ targets: [{ kind: "land_parcel", id: parcel }], periods: [{ startedAt: "2026-05-12T07:00:00Z", stoppedAt: "2026-05-12T09:00:00Z" }] }),
    });
    expect(r.status).toBe(200);
    expect((await r.json()).warnings.some((w: string) => /cultures qui se recoupent/.test(w))).toBe(true);
  });
});
