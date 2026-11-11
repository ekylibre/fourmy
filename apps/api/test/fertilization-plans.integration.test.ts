import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { CoverCrop, FertilizationCheck, SteeringMeasurement, FertilizationPlan, FertilizationPlanSummary, FertilizationRecord, RegulatoryDocument } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { fertilizationDeps } from "../src/routes/fertilization.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Plans prévisionnels de fumure (lot AG) : préparation de la campagne, données
 * rassemblées (précédent réalisé, objectif, pluie), dose calculée terme par
 * terme selon l'annexe 2.2.b, saisies, établissement, révision motivée, dose
 * d'un outil, droits. Météo simulée : aucun appel réseau.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SHAPE = "MULTIPOLYGON(((-0.2 43.38,-0.195 43.38,-0.195 43.3809,-0.2 43.3809,-0.2 43.38)))";
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Open-Meteo simulé : 35 mm de pluie les 10, 20 et 30 du mois (20 jours, 700 mm d'octobre à mai). */
function fakeOpenMeteo(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const today = new Date().toISOString().slice(0, 10);
    const from = u.searchParams.get("start_date") ?? addDays(today, -7);
    const to = u.searchParams.get("end_date") ?? addDays(today, 15);
    const time: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) time.push(d);
    return Response.json({
      daily: {
        time,
        temperature_2m_min: time.map(() => 8),
        temperature_2m_max: time.map(() => 18),
        precipitation_sum: time.map((d) => (Number(d.slice(8, 10)) % 10 === 0 ? 35 : 0)),
        et0_fao_evapotranspiration: time.map(() => 2),
      },
    });
  }) as typeof fetch;
}

describe.skipIf(!url)("plans de fumure (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const p2025 = crypto.randomUUID();
  const p2026 = crypto.randomUUID();
  const urea = crypto.randomUUID();
  const grain = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  let planId = "";
  const base = () => `/api/v1/farms/${farmId}`;
  const original = fertilizationDeps.fetch;
  const plan = async () => (await (await app.request(`${base()}/fertilization/plans/${planId}`, { headers })).json()) as FertilizationPlan;
  const putDraft = (draft: object, h = headers) => app.request(`${base()}/fertilization/plans/${planId}/draft`, { method: "PUT", headers: h, body: JSON.stringify(draft) });
  const establish = (reason: string | null, h = headers) => app.request(`${base()}/fertilization/plans/${planId}/establish`, { method: "POST", headers: h, body: JSON.stringify({ reason }) });
  const term = (p: FertilizationPlan, t: keyof FertilizationPlan["result"]["terms"]) => {
    const v = p.result.terms[t];
    return v && "value" in v ? v.value : undefined;
  };

  beforeAll(async () => {
    fertilizationDeps.fetch = fakeOpenMeteo();
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test plans de fumure"));
    worker = await addMember(sql, farmId, "worker");
    const activity = crypto.randomUUID();
    await sql`INSERT INTO activities (id, farm_id, name, family, reference, cultivation) VALUES (${activity}, ${farmId}, 'Maïs', 'plant_farming', 'grain_corn', 'zea_mays')`;
    const [c25, c26] = [crypto.randomUUID(), crypto.randomUUID()];
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${c25}, ${farmId}, 2025, '2024-09-01', '2025-08-31'), (${c26}, ${farmId}, 2026, '2025-09-01', '2026-08-31')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${p2025}, ${farmId}, 'Champ Maïs 2025'), (${p2026}, ${farmId}, 'Champ Maïs 2026')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES
      (${crypto.randomUUID()}, ${p2025}, ST_GeomFromText(${SHAPE}, 4326), 40000, tstzrange('2025-01-01', '2026-01-01')),
      (${crypto.randomUUID()}, ${p2026}, ST_GeomFromText(${SHAPE}, 4326), 40000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species, cultivation, activity_id) VALUES
      (${crypto.randomUUID()}, ${farmId}, ${c25}, ${p2025}, 'field_crop', 'zea_mays', 'zea_mays', ${activity}),
      (${crypto.randomUUID()}, ${farmId}, ${c26}, ${p2026}, 'field_crop', 'DKC5432', 'zea_mays', ${activity})`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${urea}, ${farmId}, 'Urée 46', 'fertilizer', 'Kilogramme'), (${grain}, ${farmId}, 'Maïs grain', 'harvest', 'Quintal')`;
    await sql`INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, nitrate_type, origin) VALUES (${urea}, ${farmId}, 'mass_percent', 46, 1, 'III', 'confirmed')`;
    // 2025 : 200 kg/ha d'urée (92 kg N), récolte de 120 q/ha.
    for (const [procedure, day, role, article, qty, unit] of [
      ["fertilizing", "2025-05-20", "input", urea, 200, "kilogram_per_hectare"],
      ["harvesting", "2025-10-15", "output", grain, 120, "quintal_per_hectare"],
    ] as const) {
      const i = crypto.randomUUID();
      await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${i}, ${farmId}, ${procedure}, 'done', 'web', ${`${day}T08:00:00Z`}, ${`${day}T12:00:00Z`})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${i}, 'target', 'land_parcel', ${p2025})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${i}, ${role}, 'article', ${article}, ${qty}, ${unit})`;
    }
    await sql`INSERT INTO parcel_soils (land_parcel_id, farm_id, irrigated, soil_type, soil_type_region) VALUES (${p2026}, ${farmId}, false, 'limoneux', 'nouvelle-aquitaine')`;
    await sql`INSERT INTO parcel_nitrate_zones (land_parcel_id, farm_id, insee, commune, status, referential) VALUES (${p2026}, ${farmId}, '64389', 'Monassut-Audiracq', 'in', 'test')`;
  });
  afterAll(async () => {
    fertilizationDeps.fetch = original;
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  it("prépare un plan par parcelle cultivée ; réservé au responsable", async () => {
    expect((await app.request(`${base()}/fertilization/plans/prepare?campaign=2026`, { method: "POST", headers: worker.headers })).status).toBe(403);
    const r = await app.request(`${base()}/fertilization/plans/prepare?campaign=2026`, { method: "POST", headers });
    expect(await r.json()).toEqual({ created: 1 });
    expect(await (await app.request(`${base()}/fertilization/plans/prepare?campaign=2026`, { method: "POST", headers })).json()).toEqual({ created: 0 });
    const list = (await (await app.request(`${base()}/fertilization/plans?campaign=2026`, { headers: worker.headers })).json()) as { items: FertilizationPlanSummary[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ cropLabel: "Maïs grain", status: "draft", zone: "in", missing: 0, doseOrigin: "fourmy" });
    planId = list.items[0]!.id;
  });

  it("rassemble le précédent réalisé, l'objectif et la pluie, puis calcule la dose (annexe 2.2.b)", async () => {
    const p = await plan();
    expect(p.context).toMatchObject({
      department: "64",
      crop: "maize_grain",
      variety: "DKC5432",
      soilType: "limoneux",
      irrigated: false,
      previous: { crop: "maize_grain", parcelName: "Champ Maïs 2025", yieldRealized: 120, xMineral: 92, uncounted: [] },
      yieldTarget: { value: 95, origin: "reference" }, // une seule campagne : référence 64, maïs grain non irrigué
      rain: { mm: 700, from: "2025-10-01", to: "2026-05-01", normalsFrom: null },
    });
    expect(term(p, "Pf")).toBe(219); // 95 × 2,3
    expect(term(p, "Rf")).toBe(30);
    expect(term(p, "Mh")).toBe(45);
    expect(term(p, "Mr")).toBe(0);
    // APL = [(140 + 92) − 120 × 2,2] × 0,48 < 0 → 0 ; limoneux, APL 0, 700 et 800 mm : 26.
    expect(term(p, "Ri")).toBe(26);
    expect(p.result.dose).toBe(223); // (249 − 71) / 0,8 = 222,5
    expect(p.proposedApplications.map((a) => a.nKgHa)).toEqual([50, 173]);
  });

  it("saisies du brouillon, établissement, révision motivée, versions figées", async () => {
    expect((await putDraft({ yieldTarget: 110 }, worker.headers)).status).toBe(403);
    const updated = (await (await putDraft({ yieldTarget: 110, overrides: { Mh: { value: 50, reason: "référence locale" } } })).json()) as FertilizationPlan;
    expect(term(updated, "Pf")).toBe(242);
    expect(updated.result.terms.Mh).toMatchObject({ value: 50, origin: "override" });
    expect(updated.result.dose).toBe(245); // (272 − 76) / 0,8

    const v1 = (await (await establish(null)).json()) as FertilizationPlan;
    expect(v1).toMatchObject({ status: "established", currentVersion: 1 });
    expect(v1.versions[0]).toMatchObject({ version: 1, doseEfficient: 245, method: "bilan_cau_two_phase", reason: null });
    expect(v1.versions[0]!.applications.map((a) => a.nKgHa)).toEqual([50, 195]);

    // Révision : motif obligatoire ; la version 1 reste telle quelle.
    await putDraft({ yieldTarget: 100 });
    expect((await establish(null)).status).toBe(400);
    const v2 = (await (await establish("Objectif revu après la sécheresse")).json()) as FertilizationPlan;
    expect(v2).toMatchObject({ status: "revised", currentVersion: 2 });
    expect(v2.versions.map((v) => [v.version, v.doseEfficient])).toEqual([
      [2, 224], // brouillon remplacé : plus de valeur de la ferme pour Mh ; (250 − 71) / 0,8
      [1, 245],
    ]);
    expect(v2.versions[1]!.snapshot.draft.yieldTarget).toBe(110);
    await expect(sql`UPDATE fertilization_plan_versions SET dose_efficient = 1 WHERE plan_id = ${planId}`).rejects.toThrow(/ne se modifie pas/);
  });

  it("dose d'un outil ou d'un conseiller ; apports au-delà de la dose refusés", async () => {
    await putDraft({ yieldTarget: 100, external: { doseKgNHa: 180, tool: "AzoFert", advisor: "Technicien coopérative", computedOn: "2026-02-01" }, applications: [{ stage: "Avant 4 feuilles", nKgHa: 50 }, { stage: "6 feuilles", nKgHa: 140 }] });
    expect((await establish("Dose de l'outil labellisé")).status).toBe(400);
    await putDraft({ yieldTarget: 100, external: { doseKgNHa: 180, tool: "AzoFert", advisor: null, computedOn: "2026-02-01" }, applications: [{ stage: "Avant 4 feuilles", nKgHa: 50 }, { stage: "6 feuilles", nKgHa: 130 }] });
    const v3 = (await (await establish("Dose de l'outil labellisé")).json()) as FertilizationPlan;
    expect(v3.versions[0]).toMatchObject({ version: 3, doseEfficient: 180, method: "external", external: { tool: "AzoFert" } });
    const list = (await (await app.request(`${base()}/fertilization/plans?campaign=2026`, { headers })).json()) as { items: FertilizationPlanSummary[] };
    expect(list.items[0]).toMatchObject({ status: "revised", currentVersion: 3, dose: 180, doseOrigin: "external" });
    expect((await establish("x", worker.headers)).status).toBe(403);
  });

  it("contrôle d'un apport : calendrier (zone ouest), dose restante du plan, premier apport", async () => {
    await sql`UPDATE parcel_nitrate_zones SET zones = '{ouest,sud}' WHERE land_parcel_id = ${p2026}`;
    const check = async (startedAt: string, quantity: number) =>
      (await (
        await app.request(`${base()}/fertilization/check`, {
          method: "POST",
          headers: worker.headers,
          body: JSON.stringify({ startedAt, parcelIds: [p2026], inputs: [{ articleId: urea, quantity, per: "hectare" }] }),
        })
      ).json()) as FertilizationCheck;
    const winter = await check("2026-01-10T09:00:00+01:00", 100);
    expect(winter.level).toBe("danger");
    expect(winter.nitrogen).toEqual({ totalKgHa: 46, efficientKgHa: 46 });
    expect(winter.indicators.find((i) => i.code === "fert_calendar")).toMatchObject({ level: "danger", parcelName: "Champ Maïs 2026" });
    const may = await check("2026-05-15T09:00:00+02:00", 100);
    expect(may.indicators.find((i) => i.code === "fert_calendar")?.level).toBe("ok");
    // Plan version 3 : 180 kg ; 46 kg apportés, il en reste 134.
    expect(may.indicators.find((i) => i.code === "fert_plan")).toMatchObject({ level: "ok", message: expect.stringContaining("reste 134 kg") });
    const big = await check("2026-05-15T09:00:00+02:00", 450);
    expect(big.indicators.map((i) => i.code)).toEqual(expect.arrayContaining(["fert_plan", "fert_first_split"]));
    expect(big.indicators.find((i) => i.code === "fert_plan")?.level).toBe("warning");
  });

  it("cahier d'enregistrement : apports, teneur, rendement, dose prévue ; export CSV", async () => {
    const i = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${i}, ${farmId}, 'fertilizing', 'done', 'web', '2026-05-12T08:00:00Z', '2026-05-12T10:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${i}, 'target', 'land_parcel', ${p2026})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${i}, 'input', 'article', ${urea}, 150, 'kilogram_per_hectare')`;
    const r = (await (await app.request(`${base()}/fertilization/record?campaign=2026`, { headers: worker.headers })).json()) as FertilizationRecord;
    expect(r).toMatchObject({ campaign: 2026, from: "2025-09-01", to: "2026-09-01", toComplete: 0 });
    expect(r.parcels).toHaveLength(1);
    expect(r.parcels[0]).toMatchObject({ name: "Champ Maïs 2026", crop: "Maïs grain", variety: "DKC5432", totalNKgHa: 69, plannedDose: 180, planVersion: 3 });
    expect(r.parcels[0]!.applications).toEqual([
      expect.objectContaining({ date: "2026-05-12", product: "Urée 46", content: "46 % N", nitrateType: "III", nTotalKgHa: 69, nEfficientKgHa: 69, areaHa: 4 }),
    ]);
    const csv = await app.request(`${base()}/fertilization/record?campaign=2026&format=csv`, { headers });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text.split("\r\n")[1]).toContain('"Champ Maïs 2026";"4";"Maïs grain";"DKC5432"');
    expect(text).toContain('"Urée 46";"46 % N";"III"');
  });

  it("réaliser un épandage en période d'interdiction : refusé sans motif, contrôle et motif enregistrés", async () => {
    const post = (path: string, body: unknown) => app.request(`${base()}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const fertilizing = (day: string, extra: object = {}) => ({
      procedure: "fertilizing",
      periods: [{ startedAt: `${day}T09:00:00Z`, stoppedAt: `${day}T10:00:00Z` }],
      targets: [{ kind: "land_parcel", id: p2026 }],
      inputs: [{ articleId: urea, quantity: 100, per: "hectare" }],
      ...extra,
    });
    const id = crypto.randomUUID();
    expect((await post("/interventions", { id, procedure: "fertilizing" })).status).toBe(201);
    const refused = await post(`/interventions/${id}/complete`, fertilizing("2026-01-12"));
    expect(refused.status).toBe(422);
    expect((await refused.json()).detail).toMatch(/Épandage interdit : Champ Maïs 2026 : Urée 46 : Période d'interdiction.*indiquez un motif/);
    const ok = await post(`/interventions/${id}/complete`, fertilizing("2026-01-12", { compliance: { usages: {}, reason: "Dérogation préfectorale" } }));
    expect(ok.status).toBe(200);
    const saved = (await ok.json()).intervention;
    expect(saved.nitrateCheck).toMatchObject({ level: "danger", reason: "Dérogation préfectorale", nitrogen: { totalKgHa: 46 } });
    // Hors période : enregistré sans motif ; le contrôle reste joint à l'intervention.
    const may = crypto.randomUUID();
    await post("/interventions", { id: may, procedure: "fertilizing" });
    const done = await post(`/interventions/${may}/complete`, fertilizing("2026-05-20"));
    expect(done.status).toBe(200);
    expect((await done.json()).intervention.nitrateCheck).toMatchObject({ reason: null, indicators: expect.arrayContaining([expect.objectContaining({ code: "fert_calendar", level: "ok" })]) });
    await sql`DELETE FROM stock_movements WHERE intervention_id IN (${id}, ${may})`;
    await sql`DELETE FROM interventions WHERE id IN (${id}, ${may})`;
  });

  it("date d'ouverture, période d'implantation et couvert d'interculture (MrCi) ; cahier", async () => {
    const before = await plan();
    expect(before.context.opening).toEqual({ on: "2026-04-01", origin: "default" });
    const p = (await (await putDraft({ yieldTarget: 100, openingOn: "2026-03-15", sowingPeriod: "15 avril – 10 mai" })).json()) as FertilizationPlan;
    expect(p.context.opening).toEqual({ on: "2026-03-15", origin: "entered" });
    expect(p.context.sowing.period).toBe("15 avril – 10 mai");

    const cover = { campaign: 2026, family: "cruciferes", species: "Moutarde blanche", sownOn: "2025-09-05", destroyedOn: "2025-12-10", biomass: "1_3", destructionMode: "mechanical" };
    expect((await app.request(`${base()}/land-parcels/${p2026}/cover-crop`, { method: "PUT", headers: worker.headers, body: JSON.stringify(cover) })).status).toBe(403);
    expect((await app.request(`${base()}/land-parcels/${p2026}/cover-crop`, { method: "PUT", headers, body: JSON.stringify({ ...cover, destroyedOn: "2025-08-01" }) })).status).toBe(400);
    const saved = (await (await app.request(`${base()}/land-parcels/${p2026}/cover-crop`, { method: "PUT", headers, body: JSON.stringify(cover) })).json()) as CoverCrop;
    expect(saved).toMatchObject({ parcelId: p2026, family: "cruciferes", destroyedOn: "2025-12-10", exported: false });
    const withCover = await plan();
    expect(withCover.context.cover).toMatchObject({ species: "Moutarde blanche" });
    expect(withCover.result.terms.MrCi).toMatchObject({ value: expect.any(Number) });
    const r = (await (await app.request(`${base()}/fertilization/record?campaign=2026`, { headers: worker.headers })).json()) as FertilizationRecord;
    expect(r.parcels[0]!.cover).toMatchObject({ species: "Moutarde blanche", sownOn: "2025-09-05" });

    // Justificatif joint au couvert, supprimé avec lui.
    const form = new FormData();
    form.set("ownerType", "cover_crop");
    form.set("ownerId", saved.id);
    form.set("file", new File([new TextEncoder().encode("%PDF-1.4\n%%EOF\n")], "photo couvert.pdf", { type: "application/pdf" }));
    const auth = { authorization: headers.authorization! };
    const up = await app.request(`${base()}/fertilization/documents`, { method: "POST", headers: auth, body: form });
    expect(up.status).toBe(201);
    const doc = (await up.json()) as RegulatoryDocument;
    expect(doc).toMatchObject({ name: "photo couvert.pdf", contentType: "application/pdf", ownerType: "cover_crop" });
    const fake = new FormData();
    fake.set("ownerType", "cover_crop");
    fake.set("ownerId", saved.id);
    fake.set("file", new File(["<script>"], "x.pdf", { type: "application/pdf" }));
    expect((await app.request(`${base()}/fertilization/documents`, { method: "POST", headers: auth, body: fake })).status).toBe(400);
    const list = await (await app.request(`${base()}/fertilization/documents?ownerType=cover_crop&ownerId=${saved.id}`, { headers: worker.headers })).json();
    expect(list.items).toHaveLength(1);
    const dl = await app.request(`${base()}/fertilization/documents/${doc.id}`, { headers: worker.headers });
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect((await dl.text()).startsWith("%PDF")).toBe(true);

    expect((await app.request(`${base()}/land-parcels/${p2026}/cover-crop?campaign=2026`, { method: "DELETE", headers })).status).toBe(204);
    expect((await app.request(`${base()}/fertilization/documents/${doc.id}`, { headers })).status).toBe(404);
  });

  it("pilotage : une mesure fixe l'apport de pilotage et justifie le dépassement (lot AJ)", async () => {
    const check = async (startedAt: string, quantity: number, weather: object | null = null) =>
      (await (
        await app.request(`${base()}/fertilization/check`, {
          method: "POST",
          headers: worker.headers,
          body: JSON.stringify({ startedAt, parcelIds: [p2026], inputs: [{ articleId: urea, quantity, per: "hectare" }], weather }),
        })
      ).json()) as FertilizationCheck;
    // 450 kg d'urée : 207 kg N pour 180 prévus (version 3, sans apport réservé).
    expect((await check("2026-05-10T09:00:00+02:00", 450)).indicators.find((i) => i.code === "fert_plan")).toMatchObject({ level: "warning", message: expect.stringContaining("Justifiez-le par une mesure de pilotage") });
    const body = { measuredOn: "2026-05-05", stage: "8 feuilles", tool: "N-Tester", value: "620", advisedKgNHa: 30 };
    expect((await app.request(`${base()}/fertilization/plans/${planId}/steering`, { method: "POST", headers: worker.headers, body: JSON.stringify(body) })).status).toBe(403);
    const m = (await (await app.request(`${base()}/fertilization/plans/${planId}/steering`, { method: "POST", headers, body: JSON.stringify(body) })).json()) as SteeringMeasurement;
    expect(m).toMatchObject({ tool: "N-Tester", advisedKgNHa: 30 });
    expect((await plan()).steering).toMatchObject({ reservedKgNHa: 0, allowedDose: 210, measurements: [expect.objectContaining({ id: m.id })] });
    expect((await check("2026-05-10T09:00:00+02:00", 450)).indicators.find((i) => i.code === "fert_plan")).toMatchObject({
      level: "info",
      message: "207 kg N apportés pour 180 kg prévus : dépassement justifié par la mesure N-Tester du 05/05/2026 (210 kg permis).",
    });
    expect((await check("2026-05-10T09:00:00+02:00", 500)).indicators.find((i) => i.code === "fert_plan")?.level).toBe("warning");

    // Conditions d'épandage : gel annoncé, ruisseau à une vingtaine de mètres.
    await sql`INSERT INTO water_items (id, farm_id, kind, name, ditch, geom) VALUES ('test-luy', ${farmId}, 'line', 'Le Luy', false, ST_GeomFromText('LINESTRING(-0.21 43.3811, -0.19 43.3811)', 4326))`;
    const frost = await check("2026-05-10T07:00:00+02:00", 100, { minTemperatureC: -3, precipitationMm: 0 });
    expect(frost.indicators.find((i) => i.code === "fert_frost")).toMatchObject({ level: "warning", parcelName: "Champ Maïs 2026" });
    expect(frost.indicators.find((i) => i.code === "fert_slope")).toMatchObject({ level: "info", message: expect.stringContaining("« Le Luy » à moins de 100 m") });
    expect(frost.indicators.some((i) => i.code === "fert_water")).toBe(false); // type III : 2 m seulement
    await sql`DELETE FROM water_items WHERE farm_id = ${farmId}`;
    expect((await app.request(`${base()}/fertilization/steering/${m.id}`, { method: "DELETE", headers })).status).toBe(204);
  });

  it("cahier : couverture des sols après le précédent, épandages forcés (lot AJ)", async () => {
    // Précédent : le maïs grain 2025 de la parcelle qui recouvre celle de 2026, récolté le 15/10/2025.
    const forced = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at, nitrate_check) VALUES (${forced}, ${farmId}, 'fertilizing', 'done', 'web', '2026-01-20T08:00:00Z', '2026-01-20T09:00:00Z', ${sql.json({ level: "danger", indicators: [], nitrogen: null, reason: "Dérogation", checkedAt: "2026-01-20T10:00:00Z" })})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${forced}, 'target', 'land_parcel', ${p2026})`;
    const record = async () => (await (await app.request(`${base()}/fertilization/record?campaign=2026`, { headers: worker.headers })).json()) as FertilizationRecord;

    const r = await record();
    expect(r.forced).toEqual([{ interventionId: forced, date: "2026-01-20", parcels: ["Champ Maïs 2026"], reason: "Dérogation" }]);
    expect(r.parcels[0]!.soilCover).toMatchObject({ level: "warning", situation: "long", messages: [expect.stringContaining("cannes à broyer finement et enfouir dans les 15 jours (au plus tard le 30/10/2025)")] });

    const grind = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${grind}, ${farmId}, 'crop_residues_grinding', 'done', 'web', '2025-10-20T08:00:00Z', '2025-10-20T12:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${grind}, 'target', 'land_parcel', ${p2025})`;
    expect((await record()).parcels[0]!.soilCover).toMatchObject({ level: "ok", messages: ["Cannes broyées ou enfouies le 20/10/2025, dans les 15 jours suivant la récolte."] });

    // Repousses : sans famille ; pas de référence MrCi, le terme reste à 0.
    const regrowth = { campaign: 2026, kind: "regrowth_cereal", species: "Repousses de blé", sownOn: "2025-10-25", destroyedOn: null };
    expect((await app.request(`${base()}/land-parcels/${p2026}/cover-crop`, { method: "PUT", headers, body: JSON.stringify({ ...regrowth, family: "cruciferes" }) })).status).toBe(400);
    const saved = (await (await app.request(`${base()}/land-parcels/${p2026}/cover-crop`, { method: "PUT", headers, body: JSON.stringify(regrowth) })).json()) as CoverCrop;
    expect(saved).toMatchObject({ kind: "regrowth_cereal", family: null });
    expect((await plan()).result.terms.MrCi).toMatchObject({ value: 0 });
    await sql`DELETE FROM interventions WHERE id IN (${forced}, ${grind})`;
  });

  it("APLSH : plafond de 70 kg sur le couvert d'interculture, au contrôle et au cahier (lot AK)", async () => {
    const slurry = crypto.randomUUID();
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES (${slurry}, ${farmId}, 'Lisier de porc', 'fertilizer', 'cubic_meter')`;
    await sql`INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, nitrate_type, aplsh_product, origin)
              VALUES (${slurry}, ${farmId}, 'kg_per_m3', 4, 0.6, 'II', 'lisier_mixte_de_porc', 'confirmed')`;
    await sql`INSERT INTO parcel_nitrate_zones (land_parcel_id, farm_id, insee, commune, status, referential) VALUES (${p2025}, ${farmId}, '64389', 'Monassut-Audiracq', 'in', 'test')`;
    // Couvert de la campagne 2026, sur la parcelle 2026 qui recouvre celle de 2025 ; précédent récolté le 15/10/2025.
    await app.request(`${base()}/land-parcels/${p2026}/cover-crop`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ campaign: 2026, family: "cruciferes", species: "Moutarde", sownOn: "2025-10-18", destroyedOn: "2026-01-20", biomass: "1_3", destructionMode: "mechanical" }),
    });
    const check = async (quantity: number) =>
      (await (
        await app.request(`${base()}/fertilization/check`, {
          method: "POST",
          headers: worker.headers,
          body: JSON.stringify({ startedAt: "2025-10-20T09:00:00+02:00", parcelIds: [p2025], inputs: [{ articleId: slurry, quantity, per: "hectare" }] }),
        })
      ).json()) as FertilizationCheck;
    // 30 m³ × 4 kg = 120 kg N ; lisier mixte de porc au 15/10, bassin du Sud-Ouest : 75 % → 90 kg.
    expect((await check(30)).indicators.find((i) => i.code === "fert_aplsh")).toMatchObject({
      level: "warning",
      parcelName: "Champ Maïs 2025",
      message: "APLSH depuis la récolte du précédent (15/10/2025), sur le couvert d'interculture : 90 kg N/ha pour un plafond de 70 kg (PAN 7).",
    });
    expect((await check(15)).indicators.find((i) => i.code === "fert_aplsh")).toMatchObject({ level: "ok", message: expect.stringContaining("45 kg N/ha sur 70 kg permis") });

    const spread = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${spread}, ${farmId}, 'fertilizing', 'done', 'web', '2025-10-20T08:00:00Z', '2025-10-20T10:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${spread}, 'target', 'land_parcel', ${p2025})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${spread}, 'input', 'article', ${slurry}, 30, 'cubic_meter_per_hectare')`;
    const r = (await (await app.request(`${base()}/fertilization/record?campaign=2026`, { headers: worker.headers })).json()) as FertilizationRecord;
    expect(r.parcels.find((x) => x.parcelId === p2026)!.aplsh).toEqual({ from: "2025-10-15", to: "2026-01-20", kgNHa: 90, ceiling: 70, over: true, missing: [] });
    await sql`DELETE FROM stock_movements WHERE intervention_id = ${spread}`;
    await sql`DELETE FROM interventions WHERE id = ${spread}`;
  });
});
