import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Plants comptés à la pièce (issue #130, lot SU2, FR-SU-8 à 12) : création
 * d'une semence en plants, plantation en plants/ha, ni PMG ni conversion en
 * kg, export de l'utilisation en « plants ». Parcelle de 1,5 ha.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const parcelId = crypto.randomUUID();

describe.skipIf(!url)("plants comptés à la pièce (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  let base = "";
  let place = "";
  const post = (path: string, body: unknown) => app.request(`${base}${path}`, { method: "POST", headers: farm.headers, body: JSON.stringify(body) });
  const plant = async (input: object) => {
    const id = crypto.randomUUID();
    expect((await post("/interventions", { id, procedure: "implanting" })).status).toBe(201);
    return post(`/interventions/${id}/complete`, {
      periods: [{ startedAt: "2026-04-20T07:00:00Z", stoppedAt: "2026-04-20T12:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs: [input],
    });
  };

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test plants");
    base = `/api/v1/farms/${farm.farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farm.farmId}, 'Champ de lavande')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5126 44.8,0.5126 44.8090,0.5 44.8090,0.5 44.8)))', 4326),
              15000, tstzrange('2026-01-01', NULL))`;
    place = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${farm.farmId}, 'Serre')`;
  });
  afterAll(async () => {
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("créée en « Plant », reçue, plantée à 8 000 plants/ha sur 1,5 ha : 12 000 plants sortent du stock", async () => {
    const created = await post("/seeds", { name: "Plants de lavande", unit: "Plant", sheet: { species: "lavandula_angustifolia" } });
    expect(created.status, await created.clone().text()).toBe(201);
    const seed = (await created.json()) as { articleId: string; unitDim: string; tgw: unknown; reference: unknown; flags: string[] };
    expect(seed).toMatchObject({ unitDim: "plant", tgw: null, reference: null });
    expect(seed.flags).not.toContain("tgw_missing");

    const lot = crypto.randomUUID();
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lot}, ${farm.farmId}, ${seed.articleId}, 'LOT-LAV')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farm.farmId}, ${lot}, ${place}, 20000, 'Plant', '2026-03-01', 'purchase')`;

    const res = await plant({ articleId: seed.articleId, quantity: 8000, per: "hectare" });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = (await res.json()) as { movements: { quantity: number; unit: string }[] };
    expect(r.movements[0]).toMatchObject({ quantity: -12000, unit: "Plant" });

    // Fiche : stock en plants, plantation en plants/ha, ni densité en grains ni kg/ha.
    const sheet = (await (await app.request(`${base}/articles/${seed.articleId}/seed?at=2026-05-01T00:00:00Z`, { headers: farm.headers })).json()) as {
      stock: number;
      interventions: { plantsPerHa: number; grainsPerM2: number | null; kgPerHa: number | null }[];
    };
    expect(sheet.stock).toBe(8000);
    expect(sheet.interventions[0]).toMatchObject({ plantsPerHa: 8000, grainsPerM2: null, kgPerHa: null });

    // Une saisie en kg ou en grains est refusée : les plants ne se convertissent pas.
    const kg = await plant({ articleId: seed.articleId, quantity: 10, per: "hectare", unit: "kilogram" });
    expect(kg.status).toBe(422);
    expect(await kg.text()).toMatch(/les plants se comptent à la pièce/);
    expect((await plant({ articleId: seed.articleId, quantity: 4, per: "total", unit: "grain_per_square_meter" })).status).toBe(422);

    // Export de l'utilisation : l'unité est « plants ».
    const csv = await (await app.request(`${base}/seeds/usage?campaign=2026&format=csv`, { headers: farm.headers })).text();
    const line = csv.split("\n").find((l) => l.includes("Plants de lavande"))!;
    expect(line).toContain("plants");
    expect(line).toContain("12000");
  });

  it("une semence reprise en « unity » est comptée en plants", async () => {
    const id = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${id}, ${farm.farmId}, 'Jeunes plants de vigne', 'seed', 'unity')`;
    const list = (await (await app.request(`${base}/seeds`, { headers: farm.headers })).json()) as { items: { articleId: string; unitDim: string; flags: string[] }[] };
    const item = list.items.find((s) => s.articleId === id)!;
    expect(item.unitDim).toBe("plant");
    expect(item.flags).not.toContain("tgw_missing");
  });
});
