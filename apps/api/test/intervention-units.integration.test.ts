import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Unité de saisie d'un fertilisant (recette vidéo du 12/11) : un engrais
 * liquide stocké en tonnes (unité Ekylibre) se saisit en L/ha ou en kg/ha ;
 * le stock sort en tonnes, l'azote suit la densité. Valeurs connues d'avance.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const parcelId = crypto.randomUUID();
const engraisId = crypto.randomUUID(); // 14-48 liquide, en tonnes, densité 1,4
const sansDensiteId = crypto.randomUUID(); // engrais en tonnes, densité inconnue
const phytoId = crypto.randomUUID();

describe.skipIf(!url)("unité de saisie des intrants (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let ownerId = "";
  let headers: Record<string, string> = {};
  let base = "";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test unités");
    farmId = owner.farmId;
    ownerId = owner.userId;
    headers = owner.headers;
    base = `/api/v1/farms/${farmId}`;
    // Parcelle de 2 ha.
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Lespourcy')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5026 44.8,0.5026 44.8009,0.5 44.8009,0.5 44.8)))', 4326),
              20000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES
      (${engraisId}, ${farmId}, '14-48 liquide', 'fertilizer', 'Tonne'),
      (${sansDensiteId}, ${farmId}, 'Engrais Y', 'fertilizer', 'Tonne'),
      (${phytoId}, ${farmId}, 'Insecticide Z', 'phyto', 'Kilogramme')`;
    await sql`INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, p2o5, density, nitrate_type, origin)
      VALUES (${engraisId}, ${farmId}, 'mass_percent', 14, 1, 48, 1.4, 'III', 'confirmed')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId]);
    await sql.end();
  });

  const post = (path: string, body: unknown) => app.request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const done = async (inputs: object[]) => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "fertilizing" });
    return post(`/interventions/${id}/complete`, {
      periods: [{ startedAt: "2026-04-16T07:15:00Z", stoppedAt: "2026-04-16T09:45:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs,
    });
  };

  it("120 L/ha d'un engrais stocké en tonnes : 0,336 t sortent du stock, l'unité saisie est gardée", async () => {
    const res = await done([{ articleId: engraisId, quantity: 120, per: "hectare", unit: "Litre" }]);
    expect(res.status).toBe(200);
    const r = await res.json();
    // 120 L × 1,4 kg/L × 2 ha = 336 kg = 0,336 t.
    expect(r.movements[0].quantity).toBeCloseTo(-0.336);
    expect(r.movements[0].unit).toBe("Tonne");
    expect(r.intervention.inputs).toEqual([{ articleId: engraisId, quantity: 120, per: "hectare", unit: "Litre" }]);
    // Azote : 168 kg de produit × 14 % = 23,5 kg N/ha.
    expect(r.intervention.nitrateCheck.nitrogen).toMatchObject({ totalKgHa: 23.5 });
  });

  it("120 kg/ha sans unité de saisie particulière, mais en kilogrammes : 0,24 t", async () => {
    const r = await (await done([{ articleId: sansDensiteId, quantity: 120, per: "hectare", unit: "Kilogramme" }])).json();
    expect(r.movements[0].quantity).toBeCloseTo(-0.24);
  });

  it("refusé : des litres sans densité connue, une unité inconnue, un phyto hors de son unité", async () => {
    const litres = await done([{ articleId: sansDensiteId, quantity: 120, per: "hectare", unit: "Litre" }]);
    expect(litres.status).toBe(422);
    expect((await litres.json()).detail).toMatch(/densité/);
    const sacs = await done([{ articleId: engraisId, quantity: 3, per: "total", unit: "Sac" }]);
    expect(sacs.status).toBe(422);
    const phyto = await post("/interventions", {
      id: crypto.randomUUID(),
      procedure: "spraying",
      plannedAt: "2026-04-20T08:00:00Z",
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs: [{ articleId: phytoId, quantity: 5000, per: "hectare", unit: "Tonne" }],
    });
    expect(phyto.status).toBe(422);
    expect((await phyto.json()).detail).toMatch(/se saisit dans son unité/);
  });
});
