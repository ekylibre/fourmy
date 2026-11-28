import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Réécriture des unités reprises (issue #130, lot SU3, FR-SU-1 à 7, NF-SU-1
 * et 2) : propositions, conflit, réservée au responsable ; stock à plusieurs
 * dates, registre de la fiche, semis et prix identiques avant et après ;
 * toutes les tables réécrites ; historique ; plus rien à proposer ensuite.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const parcelId = crypto.randomUUID();
const ids = {
  maize: crypto.randomUUID(),
  wheat: crypto.randomUUID(),
  oat: crypto.randomUUID(),
  vine: crypto.randomUUID(),
  conflict: crypto.randomUUID(),
  clean: crypto.randomUUID(),
};

type Rewrite = { articleId: string; from: string; to: string | null; grainsPerDose: number | null; conflict: unknown; stock: number; usage: { movements: number; interventions: number; prices: number } };

describe.skipIf(!url)("réécriture des unités reprises des semences (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  let worker: Awaited<ReturnType<typeof addMember>>;
  let base = "";
  let sown = "";
  const get = (path: string, headers = farm.headers) => app.request(`${base}${path}`, { headers });
  const post = (path: string, body: unknown, headers = farm.headers) => app.request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  /** Ce qui doit rester identique : stock à trois dates, fiche (stock et semis), utilisation de la campagne. */
  const observed = async () => {
    const stock = [];
    for (const at of ["2025-12-31T00:00:00Z", "2026-03-15T00:00:00Z", "2026-11-01T00:00:00Z"]) {
      const list = (await (await get(`/seeds?at=${at}`)).json()) as { items: { articleId: string; stock: number }[] };
      stock.push(list.items.map((s) => [s.articleId, s.stock]).sort());
    }
    const maize = (await (await get(`/articles/${ids.maize}/seed?at=2026-11-01T00:00:00Z`)).json()) as { stock: number; interventions: { quantity: number; grainsPerM2: number | null }[] };
    const usage = (await (await get("/seeds/usage?campaign=2026")).json()) as { groups: { label: string; done: { stockQuantity: number | null; areaHa: number } }[] };
    return {
      stock,
      maize: { stock: maize.stock, interventions: maize.interventions.map((u) => [u.quantity, u.grainsPerM2]) },
      usage: usage.groups.map((g) => [g.label, g.done.stockQuantity, g.done.areaHa]),
    };
  };

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test unités reprises");
    worker = await addMember(sql, farm.farmId, "worker");
    base = `/api/v1/farms/${farm.farmId}`;
    const f = farm.farmId;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${f}, 'Grand champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5126 44.8,0.5126 44.8090,0.5 44.8090,0.5 44.8)))', 4326),
              100000, tstzrange('2020-01-01', NULL))`;
    const place = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${f}, 'Hangar')`;
    const seeds: [string, string, string, number | null][] = [
      [ids.maize, "Maïs P0573", "Sac de 50 000 grains", null],
      [ids.wheat, "Thermidor", "Mille graines", null],
      [ids.oat, "Avoine de printemps", "Kg", null],
      [ids.vine, "Plants de vigne", "unity", null],
      [ids.conflict, "Tournesol", "Sac de 50 000 grains", 80000],
      [ids.clean, "Orge", "kilogram", null],
    ];
    for (const [id, name, unit, grainsPerDose] of seeds) {
      await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${id}, ${f}, ${name}, 'seed', ${unit})`;
      if (grainsPerDose) await sql`INSERT INTO article_seeds (article_id, farm_id, grains_per_dose) VALUES (${id}, ${f}, ${grainsPerDose})`;
      const lot = crypto.randomUUID();
      await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lot}, ${f}, ${id}, ${`LOT-${name}`})`;
      // Deux achats sur deux campagnes, dans l'unité reprise.
      for (const [q, on] of [
        [30, "2025-03-01"],
        [20, "2026-03-01"],
      ] as const) {
        await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
          VALUES (${crypto.randomUUID()}, ${f}, ${lot}, ${place}, ${q}, ${unit}, ${on}, 'purchase')`;
      }
    }
    await sql`INSERT INTO prices (id, farm_id, kind, article_id, unit, amount, valid_from, source)
      VALUES (${crypto.randomUUID()}, ${f}, 'article', ${ids.maize}, 'Sac de 50 000 grains', 180, '2026-01-01', 'farm')`;
    await sql`INSERT INTO seed_derogations (id, farm_id, species, article_id, granted_on, season, quantity, unit)
      VALUES (${crypto.randomUUID()}, ${f}, 'zea_mays', ${ids.maize}, '2026-02-01', 2026, 10, 'Sac de 50 000 grains')`;
    // Semis du maïs : 1,8 sac/ha sur 10 ha, dans l'unité de l'article.
    sown = crypto.randomUUID();
    expect((await post("/interventions", { id: sown, procedure: "sowing" })).status).toBe(201);
    const done = await post(`/interventions/${sown}/complete`, {
      periods: [{ startedAt: "2026-04-20T07:00:00Z", stoppedAt: "2026-04-20T12:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs: [{ articleId: ids.maize, quantity: 1.8, per: "hectare" }],
    });
    expect(done.status, await done.clone().text()).toBe(200);
  });
  afterAll(async () => {
    await teardown(sql, farm.farmId, [farm.userId, worker.userId]);
    await sql.end();
  });

  it("propositions : même grandeur pour chaque unité reprise, conflit à part, rien pour une unité canonique", async () => {
    const res = await get("/seeds/units", worker.headers);
    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: Rewrite[] }).items;
    const by = new Map(items.map((i) => [i.articleId, i]));
    expect(by.get(ids.maize)).toMatchObject({ from: "Sac de 50 000 grains", to: "dose", grainsPerDose: 50000, conflict: null, usage: { movements: 3, interventions: 1, prices: 1 } });
    expect(by.get(ids.maize)!.stock).toBeCloseTo(32);
    expect(by.get(ids.wheat)).toMatchObject({ to: "thousand", stock: 50 });
    expect(by.get(ids.oat)).toMatchObject({ to: "kilogram" });
    expect(by.get(ids.vine)).toMatchObject({ to: "plant" });
    expect(by.get(ids.conflict)).toMatchObject({ to: null, conflict: { unitGrains: 50000, sheetGrains: 80000 } });
    expect(by.has(ids.clean)).toBe(false);
  });

  it("réservée au responsable ; conflit et code autre que la proposition ignorés", async () => {
    expect((await post("/seeds/units", { items: [{ articleId: ids.maize, to: "dose" }] }, worker.headers)).status).toBe(403);
    expect((await post("/seeds/units", { items: [] })).status).toBe(400);
    const r = (await (
      await post("/seeds/units", {
        items: [
          { articleId: ids.conflict, to: "dose" },
          { articleId: ids.wheat, to: "grain" },
          { articleId: crypto.randomUUID(), to: "kilogram" },
        ],
      })
    ).json()) as { rewritten: unknown[]; skipped: { reason: string }[] };
    expect(r.rewritten).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["conflict", "changed", "not_found"]);
  });

  it("réécriture : stocks, fiche, semis et utilisation identiques ; tables, historique ; plus rien à proposer", async () => {
    const before = await observed();
    const res = await post("/seeds/units", {
      items: [
        { articleId: ids.maize, to: "dose" },
        { articleId: ids.wheat, to: "thousand" },
        { articleId: ids.oat, to: "kilogram" },
        { articleId: ids.vine, to: "plant" },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const r = (await res.json()) as { rewritten: { articleId: string; to: string; rows: Record<string, number> }[]; skipped: unknown[] };
    expect(r.skipped).toEqual([]);
    expect(r.rewritten.find((x) => x.articleId === ids.maize)!.rows).toEqual({ movements: 3, parameters: 1, prices: 1, derogations: 1 });

    expect(await observed()).toEqual(before);
    const [maize] = await sql`SELECT a.unit, a.custom->'unitRewrite'->>'from' AS rewritten_from, s.grains_per_dose FROM articles a JOIN article_seeds s ON s.article_id = a.id WHERE a.id = ${ids.maize}`;
    expect(maize).toMatchObject({ unit: "dose", rewritten_from: "Sac de 50 000 grains", grains_per_dose: 50000 });
    const [param] = await sql`SELECT unit, quantity::float8 AS q FROM intervention_parameters WHERE intervention_id = ${sown} AND role = 'input'`;
    expect(param).toMatchObject({ unit: "dose_per_hectare", q: 1.8 });
    expect((await sql`SELECT DISTINCT m.unit FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE l.article_id = ${ids.maize}`).map((m) => m.unit)).toEqual(["dose"]);
    expect((await sql`SELECT unit FROM prices WHERE article_id = ${ids.maize}`)[0]!.unit).toBe("dose");
    expect((await sql`SELECT unit FROM seed_derogations WHERE article_id = ${ids.maize}`)[0]!.unit).toBe("dose");
    const [vine] = await sql`SELECT unit FROM articles WHERE id = ${ids.vine}`;
    expect(vine!.unit).toBe("plant");
    const log = await sql`SELECT action, diff FROM audit_log WHERE entity = 'article' AND entity_id = ${ids.maize}`;
    expect(log).toEqual([{ action: "unit_rewritten", diff: { from: "Sac de 50 000 grains", to: "dose", grainsPerDose: 50000, rows: { movements: 3, parameters: 1, prices: 1, derogations: 1 } } }]);

    // La fiche : « doses de 50 000 grains », et le stock du jour toujours en doses.
    const list = (await (await get("/seeds")).json()) as { items: { articleId: string; unit: string; unitDim: string }[] };
    expect(list.items.find((s) => s.articleId === ids.maize)).toMatchObject({ unit: "dose", unitDim: "dose" });
    // Plus rien à proposer, sauf le conflit.
    const again = ((await (await get("/seeds/units")).json()) as { items: Rewrite[] }).items;
    expect(again.map((i) => i.articleId)).toEqual([ids.conflict]);
    // Un semis après la réécriture, dans la nouvelle unité : 1 dose/ha × 10 ha.
    const next = crypto.randomUUID();
    await post("/interventions", { id: next, procedure: "sowing" });
    const after = await post(`/interventions/${next}/complete`, {
      periods: [{ startedAt: "2026-05-02T07:00:00Z", stoppedAt: "2026-05-02T09:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs: [{ articleId: ids.maize, quantity: 1, per: "hectare" }],
    });
    expect(after.status, await after.clone().text()).toBe(200);
    expect(((await after.json()) as { movements: { quantity: number; unit: string }[] }).movements[0]).toMatchObject({ quantity: -10, unit: "dose" });
  });
});
