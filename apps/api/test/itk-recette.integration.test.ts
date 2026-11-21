import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { inputNeeds } from "@fourmy/domain";
import type { ItkInputsContext, ItkWorkContext } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Recette du temps 2 (lot IT6), point de contrôle d'IT5 : les besoins en
 * semences de l'assolement (onglet Intrants) se recoupent avec
 * « Utilisation des semences » (SE7) une fois les interventions prévues
 * générées depuis l'ITK.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SQUARE = (x: number) => `MULTIPOLYGON(((${x} 44.8,${x + 0.01} 44.8,${x + 0.01} 44.809,${x} 44.809,${x} 44.8)))`;
const wheat = crypto.randomUUID();
const seed = crypto.randomUUID();
const itk = crypto.randomUUID();
const parcels = [crypto.randomUUID(), crypto.randomUUID()];

describe.skipIf(!url)("recette : besoins en semences et utilisation des semences (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test recette temps 2");
    farmId = o.farmId;
    userId = o.userId;
    headers = o.headers;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${wheat}, ${farmId}, 'Blé tendre', 'plant_farming')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${seed}, ${farmId}, 'Blé Chevignon', 'seed', 'kilogram')`;
    await sql`INSERT INTO article_seeds (article_id, farm_id, species, tgw_g, tgw_origin) VALUES (${seed}, ${farmId}, 'triticum_aestivum', 45, 'label')`;
    const campaign = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, 2027, '2027-01-01', '2027-12-31')`;
    for (const [k, id] of parcels.entries()) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${`Parcelle ${k + 1}`})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${SQUARE(0.5 + k * 0.02)}, 4326), 100000, tstzrange('2020-01-01', NULL))`;
      await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id, started_on, stopped_on, attrs)
                VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${id}, 'field_crop', ${wheat}, '2026-10-15', '2027-07-10', ${sql.json({ itineraryId: itk })})`;
    }
    const res = await send("POST", "/technical-itineraries", {
      id: itk,
      name: "Blé tendre — Le Champ",
      activityId: wheat,
      content: {
        schema: 1,
        steps: [{ id: crypto.randomUUID(), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, inputs: [{ articleId: seed, kind: "seed", label: "Blé", dose: 250, unit: "grain_per_square_meter" }] }],
      },
    });
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("besoin de l'onglet Intrants = semences prévues de « Utilisation des semences »", async () => {
    // Besoin calculé comme l'onglet Intrants : 250 grains/m² × 20 ha × PMG 45 g = 2 250 kg.
    const work = (await (await send("GET", "/crop-plans/2027/itk-context?routes=0")).json()) as ItkWorkContext;
    const inputs = (await (await send("GET", "/crop-plans/2027/inputs-context")).json()) as ItkInputsContext;
    const items = parcels.map((id) => ({ parcelKey: `p:${id}`, areaM2: 100_000, itineraryId: itk, sowingOn: "2026-10-15", harvestOn: "2027-07-10", year: 2027 }));
    const need = inputNeeds(items, work.itineraries, inputs).find((l) => l.articleId === seed)!;
    expect(need.needed).toBeCloseTo(2250, 6);

    // Interventions prévues générées depuis l'ITK.
    const preview = await (await send("POST", "/planned-interventions/2027/preview", {})).json();
    expect(preview.items).toHaveLength(2);
    const confirmed = await (await send("POST", "/planned-interventions/2027", { previewHash: preview.previewHash, accepted: preview.items.map((i: { key: string }) => i.key) })).json();
    expect(confirmed).toMatchObject({ created: 2, failed: [] });

    const usage = await (await send("GET", "/seeds/usage?campaign=2027&by=article")).json();
    const group = usage.groups.find((g: { key: string }) => g.key === seed);
    expect(group.planned).toMatchObject({ interventions: 2, areaHa: 20 });
    expect(group.planned.stockQuantity).toBeCloseTo(need.needed, 3);
    expect(group.planned.kg).toBeCloseTo(2250, 3);
  });

  it("phyto en unité reprise (« Litre ») : intervention créée dans l'unité de l'article, puis « à jour » (recette du 21/11)", async () => {
    const phyto = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${phyto}, ${farmId}, 'Choriste', 'phyto', 'Litre')`;
    const current = await (await send("GET", `/technical-itineraries/${itk}`)).json();
    const steps = [
      ...current.content.steps,
      { id: crypto.randomUUID(), procedure: "spraying", anchor: { kind: "sowing", offsetDays: 30 }, inputs: [{ articleId: phyto, kind: "phyto", label: "Choriste", dose: 0.75, unit: "liter_per_hectare" }] },
    ];
    const put = await send("PUT", `/technical-itineraries/${itk}`, { revision: current.revision, name: current.name, activityId: wheat, content: { schema: 1, steps } });
    expect(put.status).toBe(200);
    const preview = await (await send("POST", "/planned-interventions/2027/preview", {})).json();
    const sprays = preview.items.filter((i: { procedure: string }) => i.procedure === "spraying");
    expect(sprays.map((i: { state: string }) => i.state)).toEqual(["create", "create"]);
    const confirmed = await (await send("POST", "/planned-interventions/2027", { previewHash: preview.previewHash, accepted: sprays.map((i: { key: string }) => i.key) })).json();
    expect(confirmed).toMatchObject({ created: 2, failed: [] });
    const [input] = await sql`SELECT p.quantity::float8 AS q, p.unit FROM intervention_parameters p JOIN interventions i ON i.id = p.intervention_id
                              WHERE i.farm_id = ${farmId} AND p.role = 'input' AND p.ref_id = ${phyto} LIMIT 1`;
    expect(input).toEqual({ q: 0.75, unit: "Litre_per_hectare" });
    const again = await (await send("POST", "/planned-interventions/2027/preview", {})).json();
    expect(again.items.filter((i: { procedure: string }) => i.procedure === "spraying").map((i: { state: string }) => i.state)).toEqual(["same", "same"]);
  });
});
