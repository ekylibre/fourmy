import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { FertilizationCheck, FertilizationPlan, FertilizationPlanSummary, FertilizationRecord } from "@fourmy/contracts";
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
});

