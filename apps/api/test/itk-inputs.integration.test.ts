import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Besoins en intrants (lot IT5) : articles cités et leurs conversions, stock
 * disponible, réservé par les interventions prévues saisies à la main (pas
 * celles des ITK), apports des plans de fumure établis de la campagne.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SQUARE = "MULTIPOLYGON(((0.5 44.8,0.51 44.8,0.51 44.809,0.5 44.809,0.5 44.8)))";
const seed = crypto.randomUUID();
const ammo = crypto.randomUUID();
const parcel = crypto.randomUUID();

describe.skipIf(!url)("besoins en intrants (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  const get = (path: string) => app.request(`/api/v1/farms/${farmId}${path}`, { headers });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test besoins en intrants");
    farmId = o.farmId;
    userId = o.userId;
    headers = o.headers;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Le Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText(${SQUARE}, 4326), 100000, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${seed}, ${farmId}, 'Blé Chevignon', 'seed', 'kilogram'), (${ammo}, ${farmId}, 'Ammonitrate 33,5', 'fertilizer', 'ton')`;
    await sql`INSERT INTO article_seeds (article_id, farm_id, tgw_g, tgw_origin) VALUES (${seed}, ${farmId}, 45, 'label')`;
    await sql`INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, origin) VALUES (${ammo}, ${farmId}, 'mass_percent', 33.5, 'confirmed')`;
    // Stock : 2 t d'ammonitrate.
    const place = crypto.randomUUID();
    const lot = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lot}, ${farmId}, ${ammo}, 'A1')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause) VALUES (${crypto.randomUUID()}, ${farmId}, ${lot}, ${place}, 2, 'ton', '2026-09-01', 'purchase')`;
    // ITK citant les deux articles.
    await sql`INSERT INTO technical_itineraries (id, farm_id, name, origin, content) VALUES (${crypto.randomUUID()}, ${farmId}, 'Blé', 'manual',
      ${sql.json({ schema: 1, steps: [{ id: crypto.randomUUID(), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, share: 1, optional: false, inputs: [{ articleId: seed, kind: "seed", label: "Blé", dose: 250, unit: "grain_per_square_meter" }], staffing: { equipmentIds: [], personIds: [] } }] })})`;
    // Interventions prévues : 150 kg/ha d'ammonitrate sur 10 ha saisis à la main (1,5 t réservées) ; une générée par un ITK (ignorée).
    for (const generated of [false, true]) {
      const id = crypto.randomUUID();
      await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, itinerary_ref) VALUES (${id}, ${farmId}, 'mineral_fertilizing', 'planned', 'web', '2027-02-15T06:00:00Z',
        ${generated ? sql.json({ itineraryId: crypto.randomUUID(), revision: 0, stepId: crypto.randomUUID(), occurrence: 0, productionId: crypto.randomUUID(), campaign: 2027, hash: "x" }) : null})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${id}, 'target', 'land_parcel', ${parcel})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${id}, 'input', 'article', ${ammo}, 150, 'kilogram_per_hectare')`;
    }
    // Plan de fumure établi 2027 : 67 kg N/ha d'ammonitrate, 50 kg N/ha sans engrais choisi.
    const plan = crypto.randomUUID();
    await sql`INSERT INTO fertilization_plans (id, farm_id, campaign, land_parcel_id, status, current_version) VALUES (${plan}, ${farmId}, 2027, ${parcel}, 'established', 1)`;
    await sql`INSERT INTO fertilization_plan_versions (plan_id, version, farm_id, established_by, referential, method, snapshot) VALUES (${plan}, 1, ${farmId}, ${userId}, 'test', 'bilan', '{}'::jsonb)`;
    await sql`INSERT INTO fertilization_plan_applications (plan_id, version, rank, farm_id, stage, article_id, n_efficient, n_total) VALUES
      (${plan}, 1, 1, ${farmId}, 'tallage', ${ammo}, 67, 67), (${plan}, 1, 2, ${farmId}, 'montaison', NULL, 50, 50)`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("articles, stock, réservé, plans de fumure", async () => {
    const res = await get("/crop-plans/2027/inputs-context");
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c.articles[seed]).toMatchObject({ kind: "seed", unit: "kilogram", tgwG: 45, fertilizer: null });
    expect(c.articles[ammo]).toMatchObject({ kind: "fertilizer", unit: "ton", fertilizer: { basis: "mass_percent", nTotal: 33.5 } });
    expect(c.stock).toEqual({ [ammo]: 2 });
    expect(c.reserved).toEqual({ [ammo]: 1.5 });
    expect(c.plans[`p:${parcel}`].applications).toEqual([
      { articleId: ammo, stage: "tallage", nTotalKgHa: 67, plannedOn: null },
      { articleId: null, stage: "montaison", nTotalKgHa: 50, plannedOn: null },
    ]);
    // Autre campagne : pas de plan.
    expect((await (await get("/crop-plans/2026/inputs-context")).json()).plans).toEqual({});
  });
});
