import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Contrôle AB, lot CT2 : une ferme AB d'essai (parcelle en conversion depuis
 * le 01/03/2024). Feux de saisie (azote minéral, cuivre cumulé), motif exigé
 * sur le web, conversion qui redémarre, statut des parcelles, saisies propres
 * au contrôle (cuivre, catégories AB, production). Référentiel fictif.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const NOT_AB = { id: 99_000_301, amm: "9900301" };
const CUPRIC = { id: 99_000_302, amm: "9900302" };
const parcelId = crypto.randomUUID();
const urea = crypto.randomUUID();
const manure = crypto.randomUUID();
const copper = crypto.randomUUID();
const forbidden = crypto.randomUUID();
const production = crypto.randomUUID();

describe.skipIf(!url)("contrôle AB (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let users: string[] = [];
  let headers: Record<string, string> = {};
  let worker: Record<string, string> = {};

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test AB");
    farmId = owner.farmId;
    headers = owner.headers;
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users = [owner.userId, w.userId];
    await sql`INSERT INTO phyto_products (id, amm, name, state, organic, started_on) VALUES
      (${NOT_AB.id}, ${NOT_AB.amm}, 'SYNTHESE TEST', 'authorized', false, '2015-01-01'),
      (${CUPRIC.id}, ${CUPRIC.amm}, 'CUIVRE TEST', 'authorized', true, '2015-01-01')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Parcelle Bio')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10000, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES
      (${urea}, ${farmId}, 'Urée 46', 'fertilizer', 'Kilogramme', NULL),
      (${manure}, ${farmId}, 'Fumier de bovins', 'fertilizer', 'Tonne', NULL),
      (${copper}, ${farmId}, 'Cuivre test', 'phyto', 'Kilogramme', ${CUPRIC.amm}),
      (${forbidden}, ${farmId}, 'Synthèse test', 'phyto', 'Litre', ${NOT_AB.amm})`;
    await sql`INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, nitrate_type, foliar, origin) VALUES
      (${urea}, ${farmId}, 'mass_percent', 46, 1, 'III', false, 'confirmed'),
      (${manure}, ${farmId}, 'kg_per_t', 6, 0.1, 'Ia', false, 'confirmed')`;
    const [c] = await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${crypto.randomUUID()}, ${farmId}, 2026, '2026-01-01', '2026-12-31')
      ON CONFLICT DO NOTHING RETURNING id`;
    const campaignId = c?.id ?? (await sql`SELECT id FROM campaigns WHERE farm_id = ${farmId} AND year = 2026`)[0]!.id;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, started_on, stopped_on) VALUES
      (${production}, ${farmId}, ${campaignId}, ${parcelId}, 'field_crop', '2026-03-15', '2026-07-20')`;
    // Cuivre déjà apporté : 50 kg/ha d'un produit à 400 g/kg en 2023 (20 kg Cu/ha).
    const past = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${past}, ${farmId}, 'spraying', 'done', 'web', '2023-06-01T08:00:00Z', '2023-06-01T10:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${past}, 'target', 'land_parcel', ${parcelId})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${past}, 'input', 'article', ${copper}, 50, 'Kilogramme_per_hectare')`;
    const cert = await app.request(`/api/v1/farms/${farmId}/land-parcels/${parcelId}/certifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "organic", level: "conversion", startedOn: "2024-03-01" }),
    });
    expect(cert.status).toBe(201);
  });
  afterAll(async () => {
    await sql`DELETE FROM stock_movements WHERE intervention_id IN (SELECT id FROM interventions WHERE farm_id = ${farmId})`;
    await teardown(sql, farmId, users);
    await sql`DELETE FROM phyto_products WHERE id IN (${NOT_AB.id}, ${CUPRIC.id})`;
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown, h = headers) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (method: string, path: string, body?: unknown) => {
    const res = await send(method, path, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };
  const draft = (procedure: string, day: string, inputs: unknown[], justification?: string) => ({
    procedure,
    periods: [{ startedAt: `${day}T09:00:00Z`, stoppedAt: `${day}T10:00:00Z` }],
    targets: [{ kind: "land_parcel", id: parcelId }],
    inputs,
    ...(justification ? { justification } : {}),
  });

  it("cuivre : teneur saisie sur un produit absent du catalogue E-Phy, puis cumul sur 7 ans dans le feu de saisie", async () => {
    // Sans teneur connue, le produit n'est pas reconnu comme cuprique : aucun constat.
    const before = await json("POST", "/control/check", draft("spraying", "2026-06-01", [{ articleId: copper, quantity: 6, per: "hectare" }], "Mildiou observé, BSV"));
    expect(before.check).toBeNull();
    expect((await send("PUT", `/articles/${copper}/copper`, { g: 400, per: "kg" }, worker)).status).toBe(403);
    expect((await send("PUT", `/articles/${copper}/copper`, { g: 400, per: "kg" })).status).toBe(204);
    const articles = await json("GET", "/phyto/articles");
    expect(articles.items.find((a: { id: string }) => a.id === copper).copper).toEqual({ g: 400, per: "kg", from: "article" });
    // 20 kg (2023) + 6 kg/ha × 400 g/kg = 22,4 kg : proche du plafond de 28 kg.
    const after = await json("POST", "/control/check", draft("spraying", "2026-06-01", [{ articleId: copper, quantity: 6, per: "hectare" }], "Mildiou observé, BSV"));
    // Sans justification : le rappel R20 (orange) s'ajoute.
    const unjustified = await json("POST", "/control/check", draft("spraying", "2026-06-01", [{ articleId: copper, quantity: 6, per: "hectare" }]));
    expect(unjustified.check.findings.map((f: { ruleId: string }) => f.ruleId)).toEqual(["ab.R20", "ab.R21"]);
    expect(after.check).toMatchObject({ level: "warning", findings: [{ ruleId: "ab.R21", level: "warning", value: 22.4 }] });
  });

  it("phyto non utilisable en AB : feu rouge en saisie, avec la conséquence", async () => {
    const r = await json("POST", "/control/check", draft("spraying", "2026-06-01", [{ articleId: forbidden, quantity: 1, per: "hectare" }]));
    expect(r.check.findings).toEqual([expect.objectContaining({ ruleId: "ab.R5", level: "danger", breach: expect.objectContaining({ inao: "4" }) })]);
  });

  it("fertilisant : catégories AB validées ; azote minéral refusé sans motif sur le web, enregistré avec", async () => {
    expect((await send("PUT", `/articles/${manure}/fertilizer`, { basis: "kg_per_t", nTotal: 6, nMineralShare: 0.1, nitrateType: "Ia", foliar: false, abCategories: ["boues"] })).status).toBe(400);
    const saved = await json("PUT", `/articles/${manure}/fertilizer`, { basis: "kg_per_t", nTotal: 6, nMineralShare: 0.1, nitrateType: "Ia", foliar: false, abCategories: ["manure"], effluentOrigin: "conventional" });
    expect(saved).toMatchObject({ abCategories: ["manure"], effluentOrigin: "conventional" });
    // 30 t/ha × 6 kg N/t = 180 kg N/ha d'effluents : au-delà de 170.
    const manureCheck = await json("POST", "/control/check", draft("fertilizing", "2026-04-10", [{ articleId: manure, quantity: 30, per: "hectare" }]));
    expect(manureCheck.check.findings).toEqual([expect.objectContaining({ ruleId: "ab.R16", level: "warning", value: 180, breach: expect.objectContaining({ inao: "40" }) })]);

    const id = crypto.randomUUID();
    expect((await send("POST", "/interventions", { id, procedure: "fertilizing" })).status).toBe(201);
    const body = draft("fertilizing", "2026-05-20", [{ articleId: urea, quantity: 100, per: "hectare" }]);
    const refused = await send("POST", `/interventions/${id}/complete`, body);
    expect(refused.status).toBe(422);
    expect((await refused.json()).detail).toMatch(/Certification : .*Urée 46 est un engrais azoté minéral, interdit en AB.*motif/);
    const ok = await send("POST", `/interventions/${id}/complete`, { ...body, compliance: { usages: {}, reason: "Erreur de produit, déclarée à l'OC" } });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await ok.json()).intervention.certificationCheck).toMatchObject({ level: "danger", reason: "Erreur de produit, déclarée à l'OC", findings: [{ ruleId: "ab.R15" }] });
  });

  it("semences : non bio sans dérogation (rouge), conforme avec une dérogation antérieure ; traitement sans justification (orange)", async () => {
    const seed = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${seed}, ${farmId}, 'Blé Renan', 'seed', 'Kilogramme')`;
    expect((await send("PUT", `/articles/${seed}/organic`, { organicStatus: "conventional", seedTreated: false })).status).toBe(204);
    const sow = crypto.randomUUID();
    const spray = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at, justification) VALUES
      (${sow}, ${farmId}, 'sowing', 'done', 'web', '2026-10-20T08:00:00Z', '2026-10-20T10:00:00Z', NULL),
      (${spray}, ${farmId}, 'spraying', 'done', 'web', '2026-06-10T08:00:00Z', '2026-06-10T09:00:00Z', NULL)`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES
      (${crypto.randomUUID()}, ${sow}, 'target', 'land_parcel', ${parcelId}, NULL, NULL),
      (${crypto.randomUUID()}, ${sow}, 'input', 'article', ${seed}, 180, 'Kilogramme_per_hectare'),
      (${crypto.randomUUID()}, ${spray}, 'target', 'land_parcel', ${parcelId}, NULL, NULL),
      (${crypto.randomUUID()}, ${spray}, 'input', 'article', ${copper}, 2, 'Kilogramme_per_hectare')`;
    const section = async (id: string) => (await json("GET", "/control/ab?campaign=2026")).sections.find((s: { id: string }) => s.id === id);
    expect((await section("seeds")).findings[0]).toMatchObject({ ruleId: "ab.R25", level: "danger", breach: { inao: "349" } });
    expect((await section("treatments")).findings.find((f: { ruleId: string }) => f.ruleId === "ab.R20")).toMatchObject({ level: "warning", breach: { inao: "44" } });
    const uses = await json("GET", "/control/ab/seeds?campaign=2026");
    expect(uses.items[0]).toMatchObject({ articleId: seed, organicStatus: "conventional", seedTreated: false, parcels: ["Parcelle Bio"] });
    const created = await send("POST", "/seed-derogations", { species: "blé", articleId: seed, grantedOn: "2026-09-01", season: 2026, reference: "DER-2026-1" });
    expect(created.status, await created.clone().text()).toBe(201);
    expect((await section("seeds")).findings[0]).toMatchObject({ level: "ok" });
    expect((await json("GET", "/seed-derogations")).items).toHaveLength(1);
  });

  it("matériel à usage mixte : semoir venu d'une parcelle non AB, signalé puis conforme après nettoyage ; rotation et règles non contrôlées", async () => {
    const other = crypto.randomUUID();
    const drill = crypto.randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${other}, ${farmId}, 'Parcelle conventionnelle')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${other}, ST_GeomFromText('MULTIPOLYGON(((0.6 44.8,0.6013 44.8,0.6013 44.8009,0.6 44.8009,0.6 44.8)))', 4326), 10000, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${drill}, ${farmId}, 'Semoir test', 'trailed_equipment')`;
    const use = async (day: string, parcel: string, procedure = "sowing") => {
      const id = crypto.randomUUID();
      await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${id}, ${farmId}, ${procedure}, 'done', 'web', ${`${day}T08:00:00Z`}, ${`${day}T10:00:00Z`})`;
      if (parcel) await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${id}, 'target', 'land_parcel', ${parcel})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${id}, 'tool', 'equipment', ${drill})`;
      return id;
    };
    await use("2026-09-01", other);
    await use("2026-09-02", parcelId);
    const section = async (id: string) => (await json("GET", "/control/ab?campaign=2026")).sections.find((s: { id: string }) => s.id === id);
    expect((await section("equipment")).findings[0]).toMatchObject({ ruleId: "ab.R27", level: "warning", breach: { inao: "19" } });
    // Saisie d'un nouvel usage sur la parcelle AB : le dernier usage (AB) ne pose pas de problème ; après un usage hors AB, si.
    await use("2026-09-03", other);
    const check = await json("POST", "/control/check", { ...draft("sowing", "2026-09-04", []), tools: [{ equipmentId: drill }] });
    expect(check.check.findings).toEqual([expect.objectContaining({ ruleId: "ab.R27", level: "warning" })]);
    // Nettoyage enregistré entre les deux usages du 1er et du 2 : plus de constat pour ce passage.
    const cleaning = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${cleaning}, ${farmId}, 'equipment_cleaning', 'done', 'web', '2026-09-01T15:00:00Z', '2026-09-01T16:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${cleaning}, 'tool', 'equipment', ${drill})`;
    expect((await section("equipment")).findings).toEqual([]);
    expect((await section("rotation")).findings[0]).toMatchObject({ ruleId: "ab.R11", level: "missing" });
    const uncontrolled = await section("uncontrolled");
    expect(uncontrolled.level).toBe("na");
    expect(uncontrolled.findings.map((f: { ruleId: string }) => f.ruleId)).toContain("ab.R28");
  });

  it("rapport et parcelles : l'azote minéral fait redémarrer la conversion ; production modifiable", async () => {
    const report = await json("GET", "/control/ab?campaign=2026");
    expect(report.verdict).toBe("danger");
    const fert = report.sections.find((s: { id: string }) => s.id === "fertilization");
    expect(fert.findings.map((f: { ruleId: string }) => f.ruleId)).toContain("ab.R15");
    const parcels = await json("GET", "/control/ab/parcels?campaign=2026");
    expect(parcels.items[0]).toMatchObject({ parcelId, conversionStart: "2026-05-20", status: "C1", resetBy: { product: "Urée 46" } });
    expect(parcels.items[0].productions[0]).toMatchObject({ id: production, cycle: "annual" });

    expect((await send("PUT", `/productions/${production}/certification`, { cycle: "perennial" }, worker)).status).toBe(403);
    expect(await json("PUT", `/productions/${production}/certification`, { cycle: "perennial", plantedOn: "2010-03-01", cultivationMode: "shelter" })).toMatchObject({
      cycle: "perennial",
      plantedOn: "2010-03-01",
      cultivationMode: "shelter",
    });
    expect((await json("GET", "/control/ab/parcels?campaign=2026")).items[0].productions[0].cycle).toBe("perennial");
  });
});
