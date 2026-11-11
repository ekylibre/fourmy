import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { CropModelAt, ParcelCropSeries, Vegetation3dAt } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { cropModelDeps } from "../src/routes/crop-model.js";
import { weatherDeps } from "../src/routes/plan3d.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * Modèle de croissance (lot AB) : météo journalière mise en cache, stades du
 * maïs depuis le semis saisi, stress hydrique en sec puis besoin d'irrigation,
 * sol saisi par le responsable, relais du NDVI dans le plan 3D.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SHAPE = "MULTIPOLYGON(((-0.2 43.38,-0.195 43.38,-0.195 43.3809,-0.2 43.3809,-0.2 43.38)))";
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Open-Meteo simulé : chaque jour 12 / 26 °C (13 °Cj base 6), ET0 5 mm, 10 mm de pluie tous les 10 jours. */
function fakeOpenMeteo(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u.hostname.startsWith("archive") ? "archive" : "forecast");
    const today = new Date().toISOString().slice(0, 10);
    const from = u.searchParams.get("start_date") ?? addDays(today, -7);
    const to = u.searchParams.get("end_date") ?? addDays(today, 15);
    const time: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) time.push(d);
    return Response.json({
      daily: {
        time,
        temperature_2m_min: time.map(() => 12),
        temperature_2m_max: time.map(() => 26),
        precipitation_sum: time.map((d) => (Number(d.slice(8, 10)) % 10 === 0 ? 10 : 0)),
        et0_fao_evapotranspiration: time.map(() => 5),
      },
    });
  }) as typeof fetch;
}

describe.skipIf(!url)("modèle de croissance (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const maize = crypto.randomUUID();
  const fallow = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  const calls: string[] = [];
  const original = { crop: cropModelDeps.fetch, plan: weatherDeps.fetch };

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test modèle de croissance"));
    worker = await addMember(sql, farmId, "worker");
    cropModelDeps.fetch = fakeOpenMeteo(calls);
    weatherDeps.fetch = fakeOpenMeteo(calls);
    const campaign = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    for (const [id, name] of [[maize, "Maïs"], [fallow, "Jachère"]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${SHAPE}, 4326), 40000, tstzrange('2026-01-01', NULL))`;
    }
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species, cultivation) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${maize}, 'field_crop', 'DKC5432', 'zea_mays')`;
    const sowing = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${sowing}, ${farmId}, 'all_in_one_sowing', 'done', 'web', '2026-04-07T08:00:00Z', '2026-04-07T12:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${sowing}, 'target', 'land_parcel', ${maize})`;
  });
  afterAll(async () => {
    cropModelDeps.fetch = original.crop;
    weatherDeps.fetch = original.plan;
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  const get = async <T>(path: string, h = headers) => {
    const res = await app.request(`/api/v1/farms/${farmId}${path}`, { headers: h });
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };

  it("stades du maïs datés depuis le semis ; floraison proche et stress hydrique signalés ; météo en cache", async () => {
    const body = await get<CropModelAt>("/crop-model?at=2026-06-15");
    expect(body.items).toHaveLength(1); // la jachère n'a pas de semis
    const [s] = body.items;
    expect(s).toMatchObject({ parcelId: maize, model: "maize", sownOn: "2026-04-07", stage: { code: "v10" }, soil: { tawMm: 100, irrigated: false, auto: true } });
    // 13 °Cj par jour, le jour du semis compris : floraison (950 °Cj) au 74e jour.
    expect(s!.stages.find((x) => x.code === "flowering")).toMatchObject({ on: "2026-06-19", basis: "observed" });
    expect(s!.gdd).toBe(13 * 70);
    expect(body.alerts.map((a) => a.kind).sort()).toEqual(["flowering_soon", "water_stress"]);
    expect(s!.water!.ks).toBeLessThan(1);
    const archive = calls.filter((c) => c === "archive").length;
    expect(archive).toBeGreaterThan(0);
    // Second appel : tout vient du cache.
    await get<CropModelAt>("/crop-model?at=2026-06-16");
    expect(calls.filter((c) => c === "archive").length).toBe(archive);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM daily_weather WHERE farm_id = ${farmId} AND day < '2026-01-01'`;
    expect(n).toBeGreaterThan(365 * 5); // normales : les 5 années précédentes
  });

  it("fiche : série journalière jusqu'après le stade récoltable ; parcelle sans semis expliquée", async () => {
    const series = await get<ParcelCropSeries>(`/land-parcels/${maize}/crop-model?at=2026-06-15`);
    expect(series.days[0]!.date).toBe("2026-04-07");
    expect(series.days.at(-1)!.date).toBe(addDays(series.state!.stages.find((x) => x.code === "harvestable")!.on!, 15));
    expect((await get<ParcelCropSeries>(`/land-parcels/${fallow}/crop-model?at=2026-06-15`)).reason).toBe("no_sowing");
  });

  it("sol saisi par le responsable (refusé à un ouvrier) : irriguée, plus de stress mais l'irrigation à prévoir", async () => {
    const put = (h: Record<string, string>, body: unknown) =>
      app.request(`/api/v1/farms/${farmId}/land-parcels/${maize}/soil`, { method: "PUT", headers: h, body: JSON.stringify(body) });
    expect((await put(worker.headers, { tawMm: 150, irrigated: true })).status).toBe(403);
    expect((await put(headers, { tawMm: 5, irrigated: true })).status).toBe(400);
    expect((await put(headers, { tawMm: 150, irrigated: true })).status).toBe(204);
    const body = await get<CropModelAt>("/crop-model?at=2026-07-20");
    const s = body.items[0]!;
    expect(s.soil).toEqual({ tawMm: 150, irrigated: true, auto: false });
    expect(s.water!.stressDays).toBe(0);
    expect(s.water!.irrigationMm).toBeGreaterThan(100);
    expect(body.alerts.some((a) => a.kind === "water_stress")).toBe(false);
    const del = await app.request(`/api/v1/farms/${farmId}/land-parcels/${maize}/soil`, { method: "DELETE", headers });
    expect(del.status).toBe(204);
    expect((await get<CropModelAt>("/crop-model?at=2026-07-20")).items[0]!.soil.auto).toBe(true);
  });

  it("irrigations saisies (lot AC) : dose obligatoire, relue, corrigeable ; le bilan hydrique les compte", async () => {
    const send = (method: string, path: string, body: unknown) =>
      app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, body: JSON.stringify(body) });
    const dry = (await get<CropModelAt>("/crop-model?at=2026-07-20")).items[0]!;
    expect(dry.waterSupply).toBe("rainfed");
    const drySeries = await get<ParcelCropSeries>(`/land-parcels/${maize}/crop-model?at=2026-07-20`);
    const ids: string[] = [];
    for (const day of ["2026-06-20", "2026-07-10"]) {
      const plan = { procedure: "watering", targets: [{ kind: "land_parcel", id: maize }], plannedAt: `${day}T06:00:00Z` };
      const created = await send("POST", "/interventions", plan);
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      ids.push(id);
      const periods = [{ startedAt: `${day}T06:00:00Z`, stoppedAt: `${day}T10:00:00Z` }];
      const refused = await send("POST", `/interventions/${id}/complete`, { targets: plan.targets, periods });
      expect(refused.status).toBe(422);
      expect(await refused.text()).toContain("dose d'eau");
      const done = await send("POST", `/interventions/${id}/complete`, { targets: plan.targets, periods, irrigation: { depthMm: 30, method: "reel" } });
      expect(done.status).toBe(200);
    }
    const read = await get<{ irrigation: unknown; history: { action: string }[] }>(`/interventions/${ids[0]}`);
    expect(read.irrigation).toEqual({ depthMm: 30, method: "reel" });
    // Dose sur une autre procédure : refusée.
    expect((await send("POST", "/interventions", { procedure: "plowing", targets: [{ kind: "land_parcel", id: maize }], irrigation: { depthMm: 10 } })).status).toBe(422);

    const body = await get<CropModelAt>("/crop-model?at=2026-07-20");
    const s = body.items[0]!;
    expect(s.waterSupply).toBe("recorded");
    expect(s.water).toMatchObject({ appliedMm: 60, appliedDays: 2, lastAppliedOn: "2026-07-10", irrigationMm: 0 });
    expect(s.water!.stressDays).toBeLessThanOrEqual(dry.water!.stressDays);
    const stress = body.alerts.find((a) => a.kind === "water_stress");
    if (stress) expect(stress.text).toContain("dernière irrigation le 10/07");
    const series = await get<ParcelCropSeries>(`/land-parcels/${maize}/crop-model?at=2026-07-20`);
    expect(series.days.find((d) => d.date === "2026-06-20")!.appliedMm).toBe(30);
    // 30 mm de plus dans le réservoir le jour de l'apport (réserve accessible de 100 mm à cette date).
    const reserveOn = (x: ParcelCropSeries, d: string) => x.days.find((y) => y.date === d)!.reserve;
    expect(reserveOn(series, "2026-07-10") - reserveOn(drySeries, "2026-07-10")).toBeGreaterThan(0.25);

    // Correction de la seule dose : tracée, et prise en compte.
    const current = await get<Record<string, unknown>>(`/interventions/${ids[1]}`);
    const fix = await send("PUT", `/interventions/${ids[1]}`, {
      procedure: "watering",
      targets: current.targets,
      periods: current.periods,
      irrigation: { depthMm: 45, method: "reel" },
      reason: "Compteur relu",
    });
    expect(fix.status).toBe(200);
    expect((await get<CropModelAt>("/crop-model?at=2026-07-20")).items[0]!.water!.appliedMm).toBe(75);
    const history = (await get<{ history: { action: string; changes: Record<string, unknown> | null }[] }>(`/interventions/${ids[1]}`)).history;
    expect(history.find((h) => h.action === "corrected")!.changes).toHaveProperty("irrigation");
  });

  it("récolte saisie : saison close ; plan 3D sans NDVI : couvert d'après le modèle", async () => {
    const veg = await get<Vegetation3dAt>("/vegetation3d?at=2026-06-01");
    const p = veg.parcels.find((x) => x.parcelId === maize)!;
    expect(p.canopy).toMatchObject({ phase: "growing", source: "model", ndvi: null });
    expect(p.canopy.heightM).toBeGreaterThan(0.5);
    const harvest = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${harvest}, ${farmId}, 'grains_harvest', 'done', 'web', '2026-09-20T08:00:00Z', '2026-09-20T18:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${harvest}, 'target', 'land_parcel', ${maize})`;
    const after = await get<CropModelAt>("/crop-model?at=2026-10-01");
    expect(after.items[0]).toMatchObject({ endedOn: "2026-09-20", stage: { code: "ended" }, water: null });
    expect(after.alerts).toEqual([]);
    expect((await get<Vegetation3dAt>("/vegetation3d?at=2026-10-01")).parcels.find((x) => x.parcelId === maize)!.canopy.phase).toBe("harvested");
  });
});
