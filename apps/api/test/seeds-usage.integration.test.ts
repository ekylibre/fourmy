import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Utilisation des semences par campagne (lot SE7, FR-SE-24 à 27) : quantité
 * dans l'unité du stock, kg, grains, surface, densité moyenne pondérée par la
 * surface et écart ; réalisé et prévu distingués ; regroupement par espèce ;
 * export CSV. Parcelles de 10 et 5 ha, valeurs connues d'avance.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const big = crypto.randomUUID();
const small = crypto.randomUUID();
const ids = { thermidor: crypto.randomUUID(), rubisko: crypto.randomUUID(), odd: crypto.randomUUID() };

describe.skipIf(!url)("utilisation des semences par campagne (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let ownerId = "";
  let headers: Record<string, string> = {};
  let base = "";

  const parcel = async (id: string, name: string, m2: number, lon: number) => {
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${id},
              ST_GeomFromText(${`MULTIPOLYGON(((${lon} 44.8,${lon + 0.01} 44.8,${lon + 0.01} 44.805,${lon} 44.805,${lon} 44.8)))`}, 4326),
              ${m2}, tstzrange('2025-01-01', NULL))`;
  };

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test utilisation semences");
    farmId = owner.farmId;
    ownerId = owner.userId;
    headers = owner.headers;
    base = `/api/v1/farms/${farmId}`;
    await parcel(big, "Grand champ", 100000, 0.5);
    await parcel(small, "Petit champ", 50000, 0.6);
    const place = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES
      (${ids.thermidor}, ${farmId}, 'Blé Thermidor', 'seed', 'kilogram'),
      (${ids.rubisko}, ${farmId}, 'Blé Rubisko', 'seed', 'kilogram'),
      (${ids.odd}, ${farmId}, 'Semence en palettes', 'seed', 'Palette')`;
    await sql`INSERT INTO article_seeds (article_id, farm_id, species, tgw_g, tgw_origin) VALUES
      (${ids.thermidor}, ${farmId}, 'triticum_aestivum', 50, 'label'),
      (${ids.rubisko}, ${farmId}, 'triticum_aestivum', null, null)`;
    for (const a of Object.values(ids)) {
      const lot = crypto.randomUUID();
      await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lot}, ${farmId}, ${a}, ${`LOT-${a.slice(0, 4)}`})`;
      await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
        VALUES (${crypto.randomUUID()}, ${farmId}, ${lot}, ${place}, 10000, ${a === ids.odd ? "Palette" : "kilogram"}, '2025-09-01', 'purchase')`;
    }
    const post = (path: string, body: unknown) => app.request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const sow = async (articleId: string, parcelId: string, kgHa: number, day: string) => {
      const id = crypto.randomUUID();
      await post("/interventions", { id, procedure: "sowing" });
      const res = await post(`/interventions/${id}/complete`, {
        periods: [{ startedAt: `${day}T07:00:00Z`, stoppedAt: `${day}T12:00:00Z` }],
        targets: [{ kind: "land_parcel", id: parcelId }],
        inputs: [{ articleId, quantity: kgHa, per: "hectare" }],
      });
      expect(res.status, await res.text()).toBe(200);
    };
    // Réalisé : Thermidor à 180 kg/ha sur 10 ha et 150 kg/ha sur 5 ha ; Rubisko à 160 kg/ha sur 5 ha (sans PMG : repère).
    await sow(ids.thermidor, big, 180, "2026-03-10");
    await sow(ids.thermidor, small, 150, "2026-03-11");
    await sow(ids.rubisko, small, 160, "2026-03-12");
    await sow(ids.odd, big, 2, "2026-03-13");
    // Prévu : Thermidor à 200 kg/ha sur 5 ha.
    const planned = await post("/interventions", {
      procedure: "sowing",
      plannedAt: "2026-04-01T08:00:00Z",
      targets: [{ kind: "land_parcel", id: small }],
      inputs: [{ articleId: ids.thermidor, quantity: 200, per: "hectare" }],
    });
    expect(planned.status, await planned.text()).toBe(201);
    // Hors campagne : non compté.
    await sow(ids.thermidor, big, 999, "2025-03-10");
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId]);
    await sql.end();
  });

  const get = (q: string) => app.request(`${base}/seeds/usage?${q}`, { headers });

  it("par semence : quantité, surface, dose moyenne pondérée et écart ; réalisé et prévu distingués", async () => {
    const res = await get("campaign=2026");
    expect(res.status).toBe(200);
    const u = await res.json();
    expect(u.groups.map((g: { label: string }) => g.label)).toEqual(["Blé Rubisko", "Blé Thermidor", "Semence en palettes"]);
    const t = u.groups.find((g: { key: string }) => g.key === ids.thermidor);
    expect(t.done).toMatchObject({ interventions: 2, areaHa: 15, stockQuantity: 2550, kg: 2550, estimated: false, unconvertible: 0 });
    // (180 × 10 + 150 × 5) / 15 = 170 kg/ha ; 170 × 100 / 50 = 340 grains/m².
    expect(t.done.kgPerHa).toEqual({ mean: 170, min: 150, max: 180 });
    expect(t.done.grainsPerM2).toEqual({ mean: 340, min: 300, max: 360 });
    expect(t.done.grains).toBe(51_000_000);
    expect(t.planned).toMatchObject({ interventions: 1, areaHa: 5, stockQuantity: 1000, kg: 1000 });
    // Sans PMG : la densité passe par le repère Arvalis (46 g), « estimée ».
    const r = u.groups.find((g: { key: string }) => g.key === ids.rubisko);
    expect(r.done).toMatchObject({ stockQuantity: 800, estimated: true });
    expect(r.done.grainsPerM2.mean).toBeCloseTo(347.8, 1);
    // Unité illisible : la quantité de stock est connue (mouvement), pas les kg.
    const odd = u.groups.find((g: { key: string }) => g.key === ids.odd);
    expect(odd.done).toMatchObject({ stockQuantity: 20, kg: null, kgPerHa: null, unconvertible: 0 });
  });

  it("par espèce : les variétés comparées, pas de quantité de stock (unités différentes)", async () => {
    const u = await (await get("campaign=2026&by=species")).json();
    const wheat = u.groups.find((g: { key: string }) => g.key === "triticum_aestivum");
    expect(wheat.articles.map((a: { name: string }) => a.name).sort()).toEqual(["Blé Rubisko", "Blé Thermidor"]);
    expect(wheat.done).toMatchObject({ interventions: 3, areaHa: 20, stockQuantity: null, kg: 3350, estimated: true });
    expect(wheat.done.kgPerHa).toEqual({ mean: 167.5, min: 150, max: 180 });
    expect(u.groups.find((g: { key: string }) => g.key === "sans-espece").label).toBe("Espèce non renseignée");
  });

  it("export CSV : une ligne par semence et par statut, décimales françaises", async () => {
    const res = await get("campaign=2026&format=csv");
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/semences-2026\.csv/);
    const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^"Campagne";"Semence";"Espèce";"Statut"/);
    expect(lines).toHaveLength(1 + 4);
    expect(lines.find((l) => l.includes("Blé Thermidor") && l.includes("Réalisé"))).toContain('"2550";"kilogram";"2550";"51000000";"170";"150";"180"');
    expect(lines.find((l) => l.includes("Blé Thermidor") && l.includes("Prévu"))).toContain('"5";"1000"');
  });

  it("paramètres contrôlés", async () => {
    expect((await get("campaign=1999")).status).toBe(400);
    expect((await get("campaign=2026&by=lot")).status).toBe(400);
  });
});
