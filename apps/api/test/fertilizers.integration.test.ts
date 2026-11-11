import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { FertilizerArticle } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/** Fertilisants (lot AE) : proposition, composition confirmée, retour à la proposition, analyses, droits. */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("fertilisants (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const uan = crypto.randomUUID();
  const manure = crypto.randomUUID();
  const seed = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  const base = () => `/api/v1/farms/${farmId}`;
  const list = async (h = headers) => ((await (await app.request(`${base()}/fertilizers`, { headers: h })).json()) as { items: FertilizerArticle[] }).items;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test fertilisants"));
    worker = await addMember(sql, farmId, "worker");
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, lexicon_ref) VALUES
      (${uan}, ${farmId}, 'Solution azotée 390', 'fertilizer', 'Tonne', 'liquid_nitrogen_30_d1.3'),
      (${manure}, ${farmId}, 'Fumier de bovins', 'fertilizer', 'Tonne', NULL),
      (${seed}, ${farmId}, 'Semence maïs', 'seed', 'unity', NULL)`;
    const i = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${i}, ${farmId}, 'fertilizing', 'done', 'web', '2026-05-10T08:00:00Z', '2026-05-10T10:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${i}, 'input', 'article', ${uan}, 160, 'kilogram_per_hectare')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  it("liste les fertilisants avec la proposition de Fourmy et leur usage", async () => {
    const items = await list(worker.headers);
    expect(items.map((f) => f.name)).toEqual(["Fumier de bovins", "Solution azotée 390"]);
    const u = items.find((f) => f.id === uan)!;
    expect(u).toMatchObject({ composition: null, origin: null, usage: 1, proposal: { basis: "kg_per_m3", nTotal: 390, density: 1.3, nitrateType: "III" } });
    expect(items.find((f) => f.id === manure)).toMatchObject({ composition: null, proposal: null, usage: 0 });
  });

  it("le responsable confirme une composition ; le salarié ne peut pas", async () => {
    const body = { basis: "mass_percent", nTotal: 30, density: 1.3, nitrateType: "III", source: "étiquette" };
    const put = (h: Record<string, string>) => app.request(`${base()}/articles/${uan}/fertilizer`, { method: "PUT", headers: h, body: JSON.stringify(body) });
    expect((await put(worker.headers)).status).toBe(403);
    const res = await put(headers);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ origin: "confirmed", source: "étiquette", composition: { basis: "mass_percent", nTotal: 30, density: 1.3, nMineralShare: null, foliar: false } });
    expect((await app.request(`${base()}/articles/${uan}/fertilizer`, { method: "PUT", headers, body: JSON.stringify({ ...body, nTotal: -1 }) })).status).toBe(400);

    // Retour à la proposition.
    const cleared = (await (await app.request(`${base()}/articles/${uan}/fertilizer`, { method: "DELETE", headers })).json()) as FertilizerArticle;
    expect(cleared).toMatchObject({ composition: null, origin: null });
  });

  it("analyses d'un produit organique", async () => {
    await app.request(`${base()}/articles/${manure}/fertilizer`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ basis: "kg_per_t", nTotal: 5.8, nMineralShare: 0.1, nitrateType: "Ib", source: "référentiel" }),
    });
    const res = await app.request(`${base()}/articles/${manure}/analyses`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sampledOn: "2026-03-02", basis: "kg_per_t", nTotal: 6.4, nNh4: 0.9, dryMatter: 22, lab: "Labo test" }),
    });
    expect(res.status).toBe(201);
    const f = (await res.json()) as FertilizerArticle;
    expect(f.analyses).toEqual([expect.objectContaining({ sampledOn: "2026-03-02", nTotal: 6.4, nNh4: 0.9, dryMatter: 22, cN: null, lab: "Labo test" })]);
    expect((await list()).find((x) => x.id === manure)!.analyses).toHaveLength(1);
    const removed = (await (await app.request(`${base()}/articles/${manure}/analyses/${f.analyses[0]!.id}`, { method: "DELETE", headers })).json()) as FertilizerArticle;
    expect(removed.analyses).toEqual([]);
  });
});
