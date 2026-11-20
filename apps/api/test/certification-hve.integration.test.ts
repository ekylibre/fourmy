import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { unzip } from "@fourmy/isoxml";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Contrôle HVE, lot CT3 (phyto) : ferme d'essai en Alsace, deux parcelles de
 * grandes cultures certifiées HVE. Herbicide classé CMR2 (n° 2000003 de la
 * liste ministérielle), IFT signé enregistré : items 5.1, 5.2, 5.3 ; feu de
 * saisie CMR2.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const treated = crypto.randomUUID();
const untreated = crypto.randomUUID();
const herbicide = crypto.randomUUID();
const spraying = crypto.randomUUID();
const urea = crypto.randomUUID();
const grain = crypto.randomUUID();
const activity = crypto.randomUUID();
const productions: Record<string, string> = {};
const hedge = crypto.randomUUID();

describe.skipIf(!url)("contrôle HVE phyto (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let users: string[] = [];
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test HVE");
    farmId = owner.farmId;
    headers = owner.headers;
    users = [owner.userId];
    await sql`UPDATE farm_sites SET insee_code = '67482', updated_at = now() WHERE farm_id = ${farmId} AND is_headquarters`;
    const [c] = await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${crypto.randomUUID()}, ${farmId}, 2026, '2026-01-01', '2026-12-31')
      ON CONFLICT DO NOTHING RETURNING id`;
    const campaignId = c?.id ?? (await sql`SELECT id FROM campaigns WHERE farm_id = ${farmId} AND year = 2026`)[0]!.id;
    await sql`INSERT INTO activities (id, farm_id, name, family, reference, cultivation) VALUES (${activity}, ${farmId}, 'Blé tendre', 'plant_farming', 'winter_common_wheat', 'triticum_aestivum')`;
    for (const [id, name] of [[treated, "Champ traité"], [untreated, "Champ sans traitement"]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText('MULTIPOLYGON(((7.5 48.5,7.51 48.5,7.51 48.509,7.5 48.509,7.5 48.5)))', 4326), 100000, tstzrange('2020-01-01', NULL))`;
      productions[id] = crypto.randomUUID();
      await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id, started_on) VALUES (${productions[id]!}, ${farmId}, ${campaignId}, ${id}, 'field_crop', ${activity}, '2025-10-15')`;
      await sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, level, started_on) VALUES (${crypto.randomUUID()}, ${farmId}, ${id}, 'hve', '3', '2025-01-01')`;
    }
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${herbicide}, ${farmId}, 'SULTAN', 'phyto', 'Litre', '2000003')`;
    // Herbicide réalisé, IFT certifié par l'API (2 sur la parcelle traitée).
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at, ift) VALUES (${spraying}, ${farmId}, 'spraying', 'done', 'web', '2026-04-10T08:00:00Z', '2026-04-10T10:00:00Z',
      ${sql.json({ status: "ok", total: 2, computedAt: "2026-04-10T12:00:00Z", error: null, lines: [{ articleId: herbicide, parcelId: treated, ift: 2, segment: "Herbicides", segmentCode: "S3", doseReference: 1, warning: null, certifiedId: "x", signature: "jwt" }] })})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${spraying}, 'target', 'land_parcel', ${treated})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${spraying}, 'input', 'article', ${herbicide}, 1.5, 'Litre_per_hectare')`;
    // Haie TelePAC (V4) de 2,2 m le long du bord sud des parcelles.
    await sql`INSERT INTO farm_landscape_features (id, farm_id, source, campaign, ref, kind, cap_type, width_m, area_m2, geom) VALUES
      (${hedge}, ${farmId}, 'telepac', 2026, 'SNA-1', 'hedge', 'V4', 2.2, 1620,
       ST_GeomFromText('POLYGON((7.5 48.49999,7.51 48.49999,7.51 48.50001,7.5 48.50001,7.5 48.49999))', 4326))`;
    // Fertilisation : 200 kg/ha d'urée (92 kg N/ha) sur la parcelle traitée ; récolte de 80 q/ha de blé.
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${urea}, ${farmId}, 'Urée 46', 'fertilizer', 'Kilogramme'), (${grain}, ${farmId}, 'Blé grain', 'harvest', 'Tonne')`;
    await sql`INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, nitrate_type, foliar, origin) VALUES (${urea}, ${farmId}, 'mass_percent', 46, 1, 'III', false, 'confirmed')`;
    const fert = crypto.randomUUID();
    const harvest = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES
      (${fert}, ${farmId}, 'fertilizing', 'done', 'web', '2026-03-10T08:00:00Z', '2026-03-10T10:00:00Z'),
      (${harvest}, ${farmId}, 'harvesting', 'done', 'web', '2026-07-15T08:00:00Z', '2026-07-15T18:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES
      (${crypto.randomUUID()}, ${fert}, 'target', 'land_parcel', ${treated}, NULL, NULL),
      (${crypto.randomUUID()}, ${fert}, 'input', 'article', ${urea}, 200, 'Kilogramme_per_hectare'),
      (${crypto.randomUUID()}, ${harvest}, 'target', 'land_parcel', ${treated}, NULL, NULL),
      (${crypto.randomUUID()}, ${harvest}, 'output', 'article', ${grain}, 80, 'quintal_per_hectare')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  const json = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };

  it("rapport : CMR2 (1 point), 50 % non traité (5 points), IFT d'Alsace × part de SAU, items déclaratifs à remplir", async () => {
    const report = await json("GET", "/control/hve?campaign=2026");
    const phyto = report.sections.find((s: { id: string }) => s.id === "phyto");
    const item = (id: string) => phyto.findings.find((f: { ruleId: string }) => f.ruleId === id);
    expect(item("hve.5.1")).toMatchObject({ level: "ok", points: { got: 1, max: 2 } });
    expect(item("hve.5.2")).toMatchObject({ value: 50, points: { got: 5, max: 10 } });
    // Herbicides : 2 × 10 ha / 20 ha = 1 ≤ plancher 1 → 5 ; hors herbicides 0 → 5 ; toute la SAU en grandes cultures : 10.
    expect(item("hve.5.3")).toMatchObject({ level: "ok", points: { got: 10, max: 10 } });
    expect(item("hve.5.5")).toMatchObject({ level: "missing" });
    // 1 + 5 + 10 = 16 ≥ 10 : conforme, items déclaratifs « à vérifier ».
    expect(phyto).toMatchObject({ level: "warning", points: { got: 16, min: 10 } });
  });

  it("fertilisation : BGA en azote total, SAU non fertilisée ; élevage à déclarer", async () => {
    const report = await json("GET", "/control/hve?campaign=2026");
    const fert = report.sections.find((s: { id: string }) => s.id === "fertilization");
    const item = (id: string) => fert.findings.find((f: { ruleId: string }) => f.ruleId === id);
    // 92 kg N × 10 ha apportés − 80 t × 18 kg N/t exportés = −520 kg sur 20 ha : −26 kg/ha → 8 points ; élevage non déclaré.
    expect(item("hve.6.1")).toMatchObject({ level: "missing", value: -26, points: { got: 8, max: 8 } });
    expect(item("hve.6.1.harvests")).toMatchObject({ level: "warning" });
    expect(item("hve.6.3")).toMatchObject({ value: 0, points: { got: 0 } });
    expect(item("hve.6.5")).toMatchObject({ value: 50, points: { got: 5 } });
    await json("PUT", "/settings/certification", { hveLivestock: false });
    const after = (await json("GET", "/control/hve?campaign=2026")).sections.find((s: { id: string }) => s.id === "fertilization");
    expect(after.findings.find((f: { ruleId: string }) => f.ruleId === "hve.6.1").level).toBe("ok");
  });

  it("irrigation : sans apport, sans objet ; avec un apport de juillet, 7.1 et 7.6", async () => {
    const section = async () => (await json("GET", "/control/hve?campaign=2026")).sections.find((s: { id: string }) => s.id === "irrigation");
    expect((await section()).level).toBe("na");
    // 30 mm sur la parcelle traitée (10 ha) le 10 juillet, depuis la nappe ; facteur déclenchant non saisi.
    const water = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at, irrigation) VALUES
      (${water}, ${farmId}, 'watering', 'done', 'web', '2026-07-10T06:00:00Z', '2026-07-10T12:00:00Z', ${sql.json({ depthMm: 30, method: "reel", origin: "groundwater", trigger: null, mobile: true })})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${water}, 'target', 'land_parcel', ${treated})`;
    let irrigation = await section();
    const item = (s: { findings: { ruleId: string }[] }, id: string) => s.findings.find((f) => f.ruleId === id);
    // Manquent : facteur déclenchant ; variété tolérante, pratiques économes : 3 sur 12 = 25 % → 2 points.
    expect(item(irrigation, "hve.7.1")).toMatchObject({ value: 25, points: { got: 2, max: 6 } });
    // Tout le volume (3 000 m³) prélevé dans la nappe en juillet : 100 % en étiage → 0 point.
    expect(item(irrigation, "hve.7.6")).toMatchObject({ value: 100, points: { got: 0, max: 5 } });
    await json("PUT", `/productions/${productions[treated]}/certification`, { droughtTolerant: false, waterSaving: "non-labour" });
    irrigation = await section();
    expect(item(irrigation, "hve.7.1")).toMatchObject({ value: 8.3, points: { got: 6 } });
  });

  it("biodiversité : haie TelePAC proposée, comptée une fois validée (socle sur les terres arables, poids)", async () => {
    const bio = async () => (await json("GET", "/control/hve?campaign=2026")).sections.find((s: { id: string }) => s.id === "biodiversity");
    const iae = (s: { findings: { ruleId: string }[] }) => s.findings.find((f) => f.ruleId === "hve.4.1") as { level: string; points: { got: number }; message: string };
    expect(iae(await bio())).toMatchObject({ level: "missing", points: { got: 0 } });
    const list = await json("GET", "/control/hve/iae?campaign=2026");
    expect(list.items[0]).toMatchObject({ id: hedge, type: "hedge", proposed: true, validated: false, unit: "m", onArable: true });
    expect(list.items[0].quantity).toBeGreaterThan(700);
    const put = await app.request(`/api/v1/farms/${farmId}/landscape-features/${hedge}/hve`, { method: "PUT", headers, body: JSON.stringify({ type: "hedge", validated: true, shared: false }) });
    expect(put.status).toBe(204);
    const after = iae(await bio());
    // ≈ 736 m × 20 m² = 1,47 ha équivalents sur 20 ha de terres arables : socle atteint, poids ≈ 7 % → 4 points.
    expect(after.level).toBe("ok");
    expect(after.points.got).toBe(4);
    expect(after.message).toMatch(/Socle : 7,\d % des terres arables/);
    expect((await app.request(`/api/v1/farms/${farmId}/landscape-features/${hedge}/hve`, { method: "PUT", headers, body: JSON.stringify({ type: "dragon", validated: true }) })).status).toBe(400);
  });

  it("questionnaire annuel : réponses validées, items déclaratifs notés, justificatif rattaché", async () => {
    const empty = await json("GET", "/control/hve/questionnaire?campaign=2026");
    expect(empty).toMatchObject({ id: null, campaign: 2026, updatedAt: null });
    const bad = await app.request(`/api/v1/farms/${farmId}/control/hve/questionnaire?campaign=2026`, { method: "PUT", headers, body: JSON.stringify({ biodiversity: { animalSpecies: -1 } }) });
    expect(bad.status).toBe(400);
    const saved = await json("PUT", "/control/hve/questionnaire?campaign=2026", {
      biodiversity: { animalSpecies: 2, hives: true, soilBiology: "spade_test" },
      phyto: { leakEquipment: 1 },
      fertilization: { livestockNitrogenKg: 0 },
    });
    expect(saved.id).toBeTruthy();
    const report = await json("GET", "/control/hve?campaign=2026");
    const item = (section: string, id: string) =>
      report.sections.find((s: { id: string }) => s.id === section).findings.find((f: { ruleId: string }) => f.ruleId === id);
    expect(item("biodiversity", "hve.4.5")).toMatchObject({ level: "ok", points: { got: 1 } });
    expect(item("biodiversity", "hve.4.7")).toMatchObject({ level: "missing" });
    expect(item("phyto", "hve.5.7")).toMatchObject({ level: "ok", points: { got: 1 } });
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "test-beche.pdf"));
    form.set("ownerType", "hve_questionnaire");
    form.set("ownerId", saved.id);
    const doc = await app.request(`/api/v1/farms/${farmId}/fertilization/documents`, { method: "POST", headers: { authorization: headers.authorization! }, body: form });
    expect(doc.status, await doc.clone().text()).toBe(201);
  });

  it("liasse HVE : zip (synthèse, IFT signés, cahiers, IAE)", async () => {
    const res = await app.request(`/api/v1/farms/${farmId}/control/hve/export?campaign=2026`, { headers });
    expect(res.status, await res.clone().text()).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual(["cahier-fertilisation.csv", "iae.csv", "ift.csv", "irrigation.csv", "parcelles-irriguees.csv", "parcelles.csv", "registre-phyto.csv", "synthese.html"]);
    const text = (name: string) => new TextDecoder().decode(files.get(name));
    expect(text("ift.csv")).toMatch(/"SULTAN";"2000003";"Herbicides";"2";"x";"jwt"/);
    expect(text("iae.csv")).toMatch(/"hedge";"oui"/);
    expect(text("synthese.html")).toMatch(/Stratégie phytosanitaire — /);
    expect((await json("GET", "/control/hve?campaign=2026")).exportedAt).toBeTruthy();
  });

  it("réglage : notation IFT « ancienne » ; saisie : herbicide CMR2 en orange", async () => {
    await json("PUT", "/settings/certification", { hveIftScale: "old", hveLivestock: false });
    const phyto = (await json("GET", "/control/hve?campaign=2026")).sections.find((s: { id: string }) => s.id === "phyto");
    expect(phyto.findings.find((f: { ruleId: string }) => f.ruleId === "hve.5.3").message).toMatch(/plafond 1,67/);
    const r = await json("POST", "/control/check", {
      procedure: "spraying",
      periods: [{ startedAt: "2026-05-02T08:00:00Z", stoppedAt: "2026-05-02T09:00:00Z" }],
      targets: [{ kind: "land_parcel", id: untreated }],
      inputs: [{ articleId: herbicide, quantity: 1, per: "hectare" }],
    });
    expect(r.check).toMatchObject({ level: "warning", findings: [{ ruleId: "hve.5.1", level: "warning" }] });
    expect(r.check.findings[0].message).toMatch(/SULTAN est classé CMR2/);
  });
});
