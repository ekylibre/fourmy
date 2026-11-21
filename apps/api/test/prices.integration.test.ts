import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/** Prix datés de la ferme (temps 3, lot E1) : ajout en masse, en vigueur à une date, historique, droits, refus. */
const url = process.env.DATABASE_URL;
const app = createApp();
const ammo = crypto.randomUUID();
const wheat = crypto.randomUUID();

describe.skipIf(!url)("prix de la ferme (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let otherFarm = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const send = (h: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test prix");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    otherFarm = (await setupFarm(sql, "Autre ferme prix")).farmId;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${ammo}, ${farmId}, 'Ammonitrate 33,5', 'fertilizer', 'ton')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${wheat}, ${farmId}, 'Blé tendre', 'plant_farming')`;
  });
  afterAll(async () => {
    await sql`DELETE FROM activities WHERE farm_id = ${farmId}`;
    await sql`DELETE FROM lexicon_productions WHERE reference_name IN ('zz_grain', 'zz_fodder')`;
    await teardown(sql, otherFarm, []);
    await teardown(sql, farmId, users);
    await sql.end();
  });

  it("ajout en masse, en vigueur à une date, historique gardé", async () => {
    expect((await send(worker, "POST", "/prices", { items: [{ kind: "labour", unit: "hour", amount: 20, validFrom: "2026-01-01" }] })).status).toBe(403);
    const res = await send(owner, "POST", "/prices", {
      items: [
        { kind: "article", articleId: ammo, unit: "ton", amount: 500, validFrom: "2026-01-01" },
        { kind: "article", articleId: ammo, unit: "ton", amount: 580.5, validFrom: "2026-11-01", source: "lexicon", sourceRef: "ammonitrate_33", sourceDate: "2026-11-01" },
        { kind: "labour", unit: "hour", amount: 22, validFrom: "2026-01-01" },
        { kind: "product", activityId: wheat, product: "grain", unit: "ton", amount: 210, validFrom: "2026-07-01" },
        { kind: "service", procedure: "harvesting", unit: "hectare", amount: 150, validFrom: "2026-01-01" },
      ],
    });
    expect(res.status).toBe(201);
    expect((await res.json()).items).toHaveLength(5);
    const june = await (await send(worker, "GET", "/prices?kind=article&at=2026-06-30")).json();
    expect(june.items.map((p: { amount: number }) => p.amount)).toEqual([500]);
    const dec = await (await send(worker, "GET", "/prices?at=2026-12-01")).json();
    expect(dec.items).toHaveLength(4);
    expect(dec.items.find((p: { kind: string }) => p.kind === "article")).toMatchObject({ amount: 580.5, source: "lexicon", sourceDate: "2026-11-01" });
    const history = await (await send(worker, "GET", "/prices?kind=article&history=1")).json();
    expect(history.items.map((p: { amount: number }) => p.amount)).toEqual([580.5, 500]);
  });

  it("repères Lexicon : prix du grain (département, France, MATIF, marchés) et rendements Agreste du département", async () => {
    // Références factices, propres au test (espèce et production inventées).
    await sql`INSERT INTO lexicon_productions (reference_name, family, specie, usage, label) VALUES ('zz_grain', 'plant_farming', 'zz_specie', 'grain', 'Grain test'), ('zz_fodder', 'plant_farming', 'zz_specie', 'fodder', 'Fourrage test') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO lexicon_production_prices (zone, started_on, nature, specie, output, price, unit, label) VALUES
      ('64', '2025-01-01', 'farmer_price', 'zz_specie', 'grain', 170, 'ton', 'Test'), ('64', '2025-06-01', 'farmer_price', 'zz_specie', 'grain', 180, 'ton', 'Test'),
      ('44', '2025-06-01', 'farmer_price', 'zz_specie', 'grain', 999, 'ton', 'Test'), ('0', '2025-06-01', 'farmer_price', 'zz_specie', 'grain', 175, 'ton', 'Test'),
      ('0', '2025-12-01', 'matif_price', 'zz_specie', 'grain', 250.5, 'ton', 'Test MATIF'), ('44', '2019-06-01', 'farmer_price', 'zz_specie', 'grain', 1, 'ton', 'Trop ancien')`;
    await sql`INSERT INTO lexicon_market_prices (id, specie, product_code, label, unit, price, started_on) VALUES
      ('zz_1', 'zz_specie', 'ZZ', 'Test Bordeaux', 'ton', 200, '2026-04-06'), ('zz_2', 'zz_specie', 'ZZ', 'Test Bordeaux', 'ton', 201.5, '2026-04-13'),
      ('zz_3', 'zz_specie', 'ZZ', 'Test Dunkerque (en retard)', 'ton', 190, '2025-02-01'), ('zz_4', 'zz_specie', 'ZZ', 'Test Rouen (trop ancien)', 'ton', 150, '2019-02-01')`;
    // Cache agrifood : prioritaire sur la copie Lexicon des mêmes prix.
    await sql`INSERT INTO market_prices (id, product_code, specie, product_label, market, unit, price, started_on) VALUES
      ('zz_agri', 'ZZ', 'zz_specie', 'Test Bordeaux', 'Bordeaux', 'ton', 205, '2026-04-20')`;
    await sql`INSERT INTO lexicon_production_yields (department, specie, production, yield_value, yield_unit, campaign) VALUES
      ('64', 'zz_specie', 'zz_grain', 95, 'quintal_per_hectare', 2024), ('64', 'zz_specie', 'zz_grain', 69, 'quintal_per_hectare', 2025)`;
    try {
      // Le prix du 44 de 2019 et les places en retard ou trop anciennes sont écartés.
      await sql`UPDATE farm_sites SET insee_code = '64488' WHERE farm_id = ${farmId} AND is_headquarters`;
      const grain = crypto.randomUUID();
      const fodder = crypto.randomUUID();
      await sql`INSERT INTO activities (id, farm_id, name, family, reference) VALUES (${grain}, ${farmId}, 'Grain test', 'plant_farming', 'zz_grain'), (${fodder}, ${farmId}, 'Fourrage test', 'plant_farming', 'zz_fodder')`;
      const res = await (await send(worker, "GET", "/prices/suggestions/products")).json();
      expect(res.department).toBe("64");
      const g = res.items.find((i: { activityId: string }) => i.activityId === grain);
      expect(g.suggestions.map((s: { scope: string; source: string; amount: number; date: string }) => [s.scope, s.source, s.amount, s.date])).toEqual([
        ["department", "lexicon", 180, "2025-06-01"],
        ["national", "lexicon", 175, "2025-06-01"],
        ["matif", "lexicon", 250.5, "2025-12-01"],
        ["market", "agrifood", 205, "2026-04-20"],
      ]);
      expect(g.yields).toEqual([
        { campaign: 2025, value: 69, unit: "quintal_per_hectare" },
        { campaign: 2024, value: 95, unit: "quintal_per_hectare" },
      ]);
      // Fourrage : pas de prix du grain.
      expect(res.items.find((i: { activityId: string }) => i.activityId === fodder).suggestions).toEqual([]);
      // Contexte économique (lot E3) : Agreste sans historique, prix agrifood sans prix de la ferme, puis prix de la ferme.
      const eco = await (await send(worker, "GET", "/crop-plans/2027/eco-context")).json();
      const ge = eco.activities.find((i: { activityId: string }) => i.activityId === grain);
      expect(ge.yield).toEqual({ value: 82, unit: "quintal_per_hectare", source: "agreste", label: "médiane Agreste 64 2024-2025" });
      expect(ge.price).toMatchObject({ value: 205, unit: "ton", source: "agrifood" });
      expect(eco.department).toBe("64");
      await send(owner, "POST", "/prices", { items: [{ kind: "product", activityId: grain, product: "principal", unit: "ton", amount: 190, validFrom: "2026-09-01" }] });
      const eco2 = await (await send(worker, "GET", "/crop-plans/2027/eco-context")).json();
      expect(eco2.activities.find((i: { activityId: string }) => i.activityId === grain).price).toMatchObject({ value: 190, source: "farm", label: "prix de la ferme" });
      expect((await send(worker, "GET", "/crop-plans/abc/eco-context")).status).toBe(400);
    } finally {
      await sql`DELETE FROM lexicon_production_prices WHERE specie = 'zz_specie'`;
      await sql`DELETE FROM lexicon_market_prices WHERE specie = 'zz_specie'`;
      await sql`DELETE FROM market_prices WHERE specie = 'zz_specie'`;
      await sql`DELETE FROM lexicon_production_yields WHERE specie = 'zz_specie'`;
    }
  });

  it("refuse une clé incohérente ou un article d'une autre ferme ; suppression d'une ligne", async () => {
    expect((await send(owner, "POST", "/prices", { items: [{ kind: "article", unit: "ton", amount: 1, validFrom: "2026-01-01" }] })).status).toBe(400);
    const foreign = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${foreign}, ${otherFarm}, 'Voisin', 'fertilizer', 'ton')`;
    expect((await send(owner, "POST", "/prices", { items: [{ kind: "article", articleId: foreign, unit: "ton", amount: 1, validFrom: "2026-01-01" }] })).status).toBe(400);
    const list = await (await send(owner, "GET", "/prices?kind=labour")).json();
    expect((await send(owner, "DELETE", `/prices/${list.items[0].id}`)).status).toBe(204);
    expect((await (await send(owner, "GET", "/prices?kind=labour")).json()).items).toEqual([]);
  });
});
