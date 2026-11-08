import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { encryptSecret } from "../src/secrets.js";
import { fillInterventionWeather, interventionWeather, sprayingForecast } from "../src/repos/weather.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Météo des interventions (lot 3), avec des fournisseurs simulés : historique
 * Open-Meteo pour le passé, prévision OpenWeather quand l'intégration de la
 * ferme est active (Open-Meteo sinon, ou en secours), météo enregistrée avec
 * la saisie, complétée par le worker.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const parcelId = crypto.randomUUID();

const HOUR = 3_600_000;
/** Faux fournisseurs : chaque appel est noté ; OpenWeather peut être « en panne ». */
function fakeWeather(opts: { openWeatherDown?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const u = new URL(String(input));
    calls.push(`${u.host}${u.pathname}`);
    if (u.host === "api.openweathermap.org") {
      if (opts.openWeatherDown) return new Response("{}", { status: 500 });
      const start = Math.ceil(Date.now() / (3 * HOUR)) * 3 * HOUR - 3 * HOUR;
      return Response.json({
        list: Array.from({ length: 40 }, (_, i) => ({ dt: (start + i * 3 * HOUR) / 1000, main: { temp: 17, humidity: 85 }, wind: { speed: 1.5 }, rain: {} })),
      });
    }
    // Open-Meteo (prévision ou archive) : 15 °C toute la journée, 0,2 mm à 7 h.
    const from = new Date(`${u.searchParams.get("start_date")}T00:00:00Z`).getTime();
    const to = new Date(`${u.searchParams.get("end_date")}T23:00:00Z`).getTime();
    const time: string[] = [];
    for (let t = from; t <= to; t += HOUR) time.push(new Date(t).toISOString().slice(0, 16));
    return Response.json({
      hourly: {
        time,
        temperature_2m: time.map(() => 15),
        relative_humidity_2m: time.map(() => 80),
        wind_speed_10m: time.map((t) => (t.endsWith("T07:00") ? 9 : 5)),
        wind_gusts_10m: time.map(() => 12),
        precipitation: time.map((t) => (t.endsWith("T07:00") ? 0.2 : 0)),
      },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe.skipIf(!url)("météo des interventions (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url);
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test météo"));
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Les Prés')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10287, tstzrange('2020-01-01', NULL))`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  const period = { startedAt: "2025-09-23T06:00:00Z", stoppedAt: "2025-09-23T09:00:00Z" };

  it("passé : historique Open-Meteo au centre de la parcelle, moyennes sur la période", async () => {
    const fake = fakeWeather();
    const w = await interventionWeather(db, farmId, { periods: [period], targets: [{ kind: "land_parcel", id: parcelId }] }, fake.fetchImpl);
    expect(w).toMatchObject({ source: "open_meteo", kind: "observed", temperatureC: 15, humidityPct: 80, windKmh: 6.3, windMaxKmh: 9, precipitationMm: 0.2 }); // 6 h, 7 h, 8 h : (5 + 9 + 5) / 3
    expect(fake.calls).toEqual(["archive-api.open-meteo.com/v1/archive"]);
  });

  it("à venir : OpenWeather de la ferme quand il est actif ; Open-Meteo s'il tombe en panne", async () => {
    const tomorrow = new Date(Date.now() + 24 * HOUR);
    tomorrow.setUTCHours(8, 0, 0, 0);
    const req = { periods: [], plannedAt: tomorrow.toISOString(), targets: [{ kind: "land_parcel" as const, id: parcelId }] };
    expect((await interventionWeather(db, farmId, req, fakeWeather().fetchImpl))!.source).toBe("open_meteo");

    await sql`INSERT INTO integrations (id, farm_id, provider, settings, secret_ciphertext, secret_hint, enabled, status)
              VALUES (${crypto.randomUUID()}, ${farmId}, 'openweather', '{}', ${encryptSecret("cle-de-test-openweather")}, 'ther', true, 'ok')`;
    const ok = await interventionWeather(db, farmId, req, fakeWeather().fetchImpl);
    expect(ok).toMatchObject({ source: "openweather", kind: "forecast", temperatureC: 17, humidityPct: 85, windKmh: 5.4 });

    const down = fakeWeather({ openWeatherDown: true });
    expect((await interventionWeather(db, farmId, req, down.fetchImpl))!.source).toBe("open_meteo");
    expect(down.calls).toEqual(["api.openweathermap.org/data/2.5/forecast", "api.open-meteo.com/v1/forecast"]);
  });

  it("créneaux de pulvérisation des 3 prochains jours, avec leur niveau", async () => {
    const f = await sprayingForecast(db, farmId, 3, fakeWeather().fetchImpl);
    expect(f!.source).toBe("openweather");
    expect(f!.slots.length).toBeGreaterThanOrEqual(23);
    expect(f!.slots[0]).toMatchObject({ stepHours: 3, level: "go", reasons: [] });
  });

  it("la météo saisie part avec l'intervention ; le worker complète celles qui n'en ont pas", async () => {
    const id = crypto.randomUUID();
    const weather = { source: "manual", kind: "manual", temperatureC: 11, humidityPct: 90, windKmh: 3, precipitationMm: 0 };
    await app.request(`/api/v1/farms/${farmId}/interventions`, { method: "POST", headers, body: JSON.stringify({ id, procedure: "plowing" }) });
    const done = await app.request(`/api/v1/farms/${farmId}/interventions/${id}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ periods: [period], targets: [{ kind: "land_parcel", id: parcelId }], weather }),
    });
    expect(done.status).toBe(200);
    expect((await done.json()).intervention.weather).toMatchObject(weather);

    // Sans météo : le worker la complète depuis l'historique, une seule fois.
    const other = crypto.randomUUID();
    await app.request(`/api/v1/farms/${farmId}/interventions`, { method: "POST", headers, body: JSON.stringify({ id: other, procedure: "plowing" }) });
    await app.request(`/api/v1/farms/${farmId}/interventions/${other}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ periods: [period], targets: [{ kind: "land_parcel", id: parcelId }] }),
    });
    const filled = await fillInterventionWeather(db, farmId, other, fakeWeather().fetchImpl);
    expect(filled).toMatchObject({ source: "open_meteo", kind: "observed", temperatureC: 15 });
    const [row] = await sql`SELECT weather FROM interventions WHERE id = ${other}`;
    expect(row!.weather).toMatchObject({ source: "open_meteo", temperatureC: 15 });
    const [kept] = await sql`SELECT weather FROM interventions WHERE id = ${id}`;
    expect(kept!.weather).toMatchObject({ source: "manual", temperatureC: 11 });
  });
});
