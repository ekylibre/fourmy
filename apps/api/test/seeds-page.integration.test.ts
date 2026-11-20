import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { SeedDetail, SeedListItem, SeedSpeciesOption } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Page Semences (lot SE3) : liste avec repères et stock, fiche (espèce, dose,
 * PMG), PMG d'un lot, densités des semis, garde sur l'unité de stock, droits.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("semences : page et fiche (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let other = { farmId: "", userId: "", headers: {} as Record<string, string> };
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const maize = crypto.randomUUID();
  const wheat = crypto.randomUUID();
  const lot = crypto.randomUUID();
  const sowing = crypto.randomUUID();
  const parcel = crypto.randomUUID();
  const at = "at=2026-06-30T23:59:59Z";
  const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test page semences");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    other = await setupFarm(sql, "Ferme voisine page semences");
    users.push(other.userId);
    const place = crypto.randomUUID();
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${place}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES
      (${maize}, ${farmId}, 'Semence de maïs - P0573', 'seed', 'Sac de 50 000 grains'),
      (${wheat}, ${farmId}, 'Thermidor', 'seed', 'kilogram')`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${lot}, ${farmId}, ${maize}, 'LOT-MAIS')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${lot}, ${place}, 40, 'Sac de 50 000 grains', '2026-03-01', 'purchase')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Grand champ')`;
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at)
      VALUES (${sowing}, ${farmId}, 'all_in_one_sowing', 'done', 'web', '2026-04-20T08:00:00Z', '2026-04-20T12:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit, attrs) VALUES
      (${crypto.randomUUID()}, ${sowing}, 'target', 'land_parcel', ${parcel}, null, null, '{"workedAreaM2": 100000}'::jsonb),
      (${crypto.randomUUID()}, ${sowing}, 'input', 'article', ${maize}, 1.8, 'Sac de 50 000 grains_per_hectare', ${JSON.stringify({ lotId: lot })}::text::jsonb)`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users.slice(0, 2));
    await teardown(sql, other.farmId, [other.userId]);
    await sql.end();
  });

  it("liste : unité reconnue, stock à la date, utilisation par campagne, ce qui manque", async () => {
    const res = await send(owner, "GET", `/seeds?${at}`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: SeedListItem[] };
    const m = items.find((i) => i.articleId === maize)!;
    expect(m).toMatchObject({ unitDim: "dose", stock: 40, sheet: null, tgw: null, usage: [{ campaign: 2026, interventions: 1 }] });
    expect(m.flags).toEqual(["species_unknown", "tgw_missing"]);
    expect(items.find((i) => i.articleId === wheat)).toMatchObject({ unitDim: "mass", usage: [] });
  });

  it("fiche : espèce, dose et PMG de l'étiquette ; repère Arvalis et densité du semis", async () => {
    expect((await send(worker, "PUT", `/articles/${maize}/seed`, { species: "zea_mays" })).status).toBe(403);
    const res = await send(owner, "PUT", `/articles/${maize}/seed?${at}`, { species: "zea_mays", varietyName: "P0573", grainsPerDose: 50000, tgwG: 300, tgwOrigin: "label" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as SeedDetail;
    expect(d.flags).toEqual([]);
    expect(d.reference).toMatchObject({ org: "Arvalis", typicalG: 320 });
    expect(d.tgw).toEqual({ tgwG: 300, origin: "label", from: "article", estimated: false });
    expect(d.lots).toEqual([{ id: lot, code: "LOT-MAIS", stock: 40, seed: null }]);
    // 1,8 dose/ha de 50 000 grains = 9 grains/m² ; à 300 g : 27 kg/ha.
    expect(d.interventions).toHaveLength(1);
    expect(d.interventions[0]).toMatchObject({ campaign: 2026, parcels: ["Grand champ"], areaHa: 10, estimated: false });
    expect(d.interventions[0]!.grainsPerM2).toBeCloseTo(9);
    expect(d.interventions[0]!.kgPerHa).toBeCloseTo(27);
  });

  it("PMG du lot : prioritaire pour les semis de ce lot ; effacé, l'article reprend", async () => {
    const res = await send(owner, "PUT", `/lots/${lot}/seed?${at}`, { tgwG: 280, origin: "label" });
    expect(res.status).toBe(200);
    const d = (await res.json()) as SeedDetail;
    expect(d.lots[0]!.seed).toEqual({ tgwG: 280, origin: "label", on: null });
    expect(d.interventions[0]!.kgPerHa).toBeCloseTo(25.2);
    const back = (await (await send(owner, "DELETE", `/lots/${lot}/seed?${at}`)).json()) as SeedDetail;
    expect(back.lots[0]!.seed).toBeNull();
    expect(back.interventions[0]!.kgPerHa).toBeCloseTo(27);
  });

  it("PMG loin du repère signalé ; repère seul : quantités estimées", async () => {
    let d = (await (await send(owner, "PUT", `/articles/${maize}/seed?${at}`, { species: "zea_mays", grainsPerDose: 50000, tgwG: 600, tgwOrigin: "label" })).json()) as SeedDetail;
    expect(d.flags).toEqual(["tgw_far_from_reference"]);
    d = (await (await send(owner, "PUT", `/articles/${maize}/seed?${at}`, { species: "zea_mays", grainsPerDose: 50000 })).json()) as SeedDetail;
    expect(d.flags).toEqual(["tgw_missing"]);
    expect(d.tgw).toEqual({ tgwG: 320, origin: "reference", from: "reference", estimated: true });
    expect(d.interventions[0]).toMatchObject({ estimated: true });
    expect(d.interventions[0]!.kgPerHa).toBeCloseTo(28.8);
  });

  it("unité de stock : équivalente seulement, une fois des mouvements enregistrés", async () => {
    const ok = await send(owner, "PUT", `/articles/${maize}/seed?${at}`, { unit: "dose", species: "zea_mays", grainsPerDose: 50000, tgwG: 300, tgwOrigin: "label" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as SeedDetail).unit).toBe("dose");
    const ko = await send(owner, "PUT", `/articles/${maize}/seed?${at}`, { unit: "kilogram", species: "zea_mays", grainsPerDose: 50000, tgwG: 300, tgwOrigin: "label" });
    expect(ko.status).toBe(400);
    // Sans mouvement, l'unité change librement.
    expect((await send(owner, "PUT", `/articles/${wheat}/seed`, { unit: "thousand", species: "triticum_aestivum" })).status).toBe(200);
    expect((await send(owner, "PUT", `/articles/${wheat}/seed`, { unit: "palette" })).status).toBe(400);
  });

  it("mélange : ni espèce ni PMG ; repère « mélange sans espèces »", async () => {
    expect((await send(owner, "PUT", `/articles/${wheat}/seed`, { isMixture: true, species: "avena_sativa" })).status).toBe(400);
    const d = (await (await send(owner, "PUT", `/articles/${wheat}/seed`, { isMixture: true })).json()) as SeedDetail;
    expect(d.flags).toEqual(["mixture_empty"]);
    expect(d.reference).toBeNull();
  });

  it("une autre ferme ne voit pas la fiche ; les espèces proposées viennent du référentiel", async () => {
    // Le responsable de la ferme voisine, chez lui : la semence n'existe pas.
    const res = await app.request(`/api/v1/farms/${other.farmId}/articles/${maize}/seed`, { headers: other.headers });
    expect(res.status).toBe(404);
    const list = (await (await app.request(`/api/v1/farms/${other.farmId}/seeds`, { headers: other.headers })).json()) as { items: SeedListItem[] };
    expect(list.items).toEqual([]);
    const species = (await (await send(worker, "GET", "/seeds/species")).json()) as { items: SeedSpeciesOption[] };
    const corn = species.items.find((s) => s.species === "zea_mays");
    if (corn) expect(corn).toMatchObject({ legume: false, hasReference: true });
    const faba = species.items.find((s) => s.species === "vicia_faba");
    if (faba) expect(faba).toMatchObject({ legume: true, hasReference: true });
  });
});
