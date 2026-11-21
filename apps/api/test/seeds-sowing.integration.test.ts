import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Semis dans l'unité du métier (lot SE5, FR-SE-17 à 22) : grains/m², kg/ha
 * ou milliers, convertis dans l'unité du stock par le nombre de grains par
 * dose et le PMG (lot, fiche, puis repère « estimé ») ; conversion figée sur
 * l'intrant ; refus motivé sans PMG ; calcul d'avant inchangé dans l'unité de
 * l'article. Parcelle de 10 ha, valeurs connues d'avance.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const parcelId = crypto.randomUUID();
const ids = { maize: crypto.randomUUID(), wheat: crypto.randomUUID(), oat: crypto.randomUUID(), odd: crypto.randomUUID() };
const lots = { maize: crypto.randomUUID(), wheat: crypto.randomUUID(), wheatLabel: crypto.randomUUID(), odd: crypto.randomUUID() };

describe.skipIf(!url)("semis : unités et conversions (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let ownerId = "";
  let headers: Record<string, string> = {};
  let base = "";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test semis");
    farmId = owner.farmId;
    ownerId = owner.userId;
    headers = owner.headers;
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Grand champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5126 44.8,0.5126 44.8090,0.5 44.8090,0.5 44.8)))', 4326),
              100000, tstzrange('2026-01-01', NULL))`;
    const place = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES
      (${ids.maize}, ${farmId}, 'Maïs P0573', 'seed', 'Sac de 50 000 grains'),
      (${ids.wheat}, ${farmId}, 'Thermidor', 'seed', 'Mille grains'),
      (${ids.oat}, ${farmId}, 'Avoine de printemps', 'seed', 'kilogram'),
      (${ids.odd}, ${farmId}, 'Semence en palettes', 'seed', 'Palette')`;
    await sql`INSERT INTO article_seeds (article_id, farm_id, species, grains_per_dose, tgw_g, tgw_origin) VALUES
      (${ids.maize}, ${farmId}, 'zea_mays', 50000, 300, 'label'),
      (${ids.wheat}, ${farmId}, 'triticum_aestivum', null, null, null),
      (${ids.oat}, ${farmId}, 'avena_sativa', null, null, null)`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code, attrs) VALUES
      (${lots.maize}, ${farmId}, ${ids.maize}, 'LOT-MAIS', null),
      (${lots.wheat}, ${farmId}, ${ids.wheat}, 'LOT-BLE', null),
      (${lots.wheatLabel}, ${farmId}, ${ids.wheat}, 'LOT-BLE-ETIQUETTE', '{"seed": {"tgwG": 40, "origin": "label", "on": null}}'::jsonb),
      (${lots.odd}, ${farmId}, ${ids.odd}, 'LOT-PAL', null)`;
    for (const [lot, q, unit] of [
      [lots.maize, 40, "Sac de 50 000 grains"],
      [lots.wheat, 100000, "Mille grains"],
      [lots.wheatLabel, 1, "Mille grains"],
      [lots.odd, 50, "Palette"],
    ] as const) {
      await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
        VALUES (${crypto.randomUUID()}, ${farmId}, ${lot}, ${place}, ${q}, ${unit}, '2026-03-01', 'purchase')`;
    }
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId]);
    await sql.end();
  });

  const post = (path: string, body: unknown) => app.request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const sow = async (input: object) => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "sowing" });
    const res = await post(`/interventions/${id}/complete`, {
      periods: [{ startedAt: "2026-04-20T07:00:00Z", stoppedAt: "2026-04-20T12:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs: [input],
    });
    return { id, res };
  };
  const conversionOf = async (interventionId: string) => {
    const [p] = await sql`SELECT attrs->'seedConversion' AS c FROM intervention_parameters WHERE intervention_id = ${interventionId} AND role = 'input'`;
    return p!.c;
  };

  it("maïs à 9 grains/m² sur 10 ha : 18 doses sortent du stock, l'unité saisie est gardée", async () => {
    const { id, res } = await sow({ articleId: ids.maize, quantity: 9, per: "total", unit: "grain_per_square_meter" });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await res.json();
    expect(r.movements[0].quantity).toBeCloseTo(-18);
    expect(r.movements[0].unit).toBe("Sac de 50 000 grains");
    expect(r.intervention.inputs[0]).toMatchObject({ articleId: ids.maize, quantity: 9, unit: "grain_per_square_meter" });
    // Grains → doses : le nombre de grains par dose a servi, pas le PMG.
    expect(await conversionOf(id)).toEqual({ tgwG: null, tgwOrigin: null, grainsPerDose: 50000, estimated: false });
  });

  it("blé à 180 kg/ha stocké en milliers de grains : repère Arvalis (46 g), quantité estimée", async () => {
    const { id, res } = await sow({ articleId: ids.wheat, quantity: 180, per: "hectare", unit: "kilogram", lotId: lots.wheat });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = await res.json();
    // 1 800 kg à 46 g : 1 800 000 000 / 46 grains = 39 130,4 milliers.
    expect(r.movements[0].quantity).toBeCloseTo(-39130.43, 1);
    expect(await conversionOf(id)).toEqual({ tgwG: 46, tgwOrigin: "reference", grainsPerDose: null, estimated: true });
  });

  it("le PMG du lot l'emporte : 40 g sur l'étiquette du lot semé", async () => {
    const { id, res } = await sow({ articleId: ids.wheat, quantity: 180, per: "hectare", unit: "kilogram", lotId: lots.wheatLabel });
    const r = await res.json();
    expect(r.movements[0].quantity).toBeCloseTo(-45000, 0);
    expect(await conversionOf(id)).toEqual({ tgwG: 40, tgwOrigin: "label", grainsPerDose: null, estimated: false });
  });

  it("conversion figée : corriger le PMG de la fiche ne change pas un semis passé", async () => {
    const [before] = await sql`SELECT sum(quantity)::float8 AS q FROM stock_movements WHERE lot_id = ${lots.wheat}`;
    await sql`UPDATE article_seeds SET tgw_g = 50, tgw_origin = 'label' WHERE article_id = ${ids.wheat}`;
    const [after] = await sql`SELECT sum(quantity)::float8 AS q FROM stock_movements WHERE lot_id = ${lots.wheat}`;
    expect(after!.q).toBe(before!.q);
  });

  it("refus motivé : avoine sans PMG ni repère saisie en milliers ; unité inconnue", async () => {
    const tgw = await sow({ articleId: ids.oat, quantity: 400, per: "hectare", unit: "thousand" });
    expect(tgw.res.status).toBe(422);
    expect(await tgw.res.text()).toMatch(/PMG inconnu, à compléter dans Stocks → Semences/);
    const odd = await sow({ articleId: ids.maize, quantity: 2, per: "hectare", unit: "Litre" });
    expect(odd.res.status).toBe(422);
  });

  it("dans l'unité de l'article, même illisible : calcul d'avant (2 palettes/ha × 10 ha)", async () => {
    const { res } = await sow({ articleId: ids.odd, quantity: 2, per: "hectare" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).movements[0].quantity).toBeCloseTo(-20);
  });
});
