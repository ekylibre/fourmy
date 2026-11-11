import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Vegetation3dAt } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { weatherDeps } from "../src/routes/plan3d.js";
import { setupFarm, addMember, teardown } from "./helpers.js";

/**
 * Végétation et météo du plan 3D (lot AA) : état du couvert d'après le NDVI et
 * les interventions, rangs automatiques (grand axe) puis saisis, météo du jour
 * résumée (Open-Meteo simulé), météo absente sans casser la végétation.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

// Parcelle allongée est-ouest (~400 × 100 m) en Béarn : rangs automatiques vers 90°.
const LONG_EW = "MULTIPOLYGON(((-0.2 43.38,-0.195 43.38,-0.195 43.3809,-0.2 43.3809,-0.2 43.38)))";

/** Open-Meteo simulé : chaque heure de la fenêtre, pluie modérée (WMO 63) de 9 h à 16 h UTC le 2026-07-02. */
function fakeOpenMeteo(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const from = Date.parse(`${u.searchParams.get("start_date")}T00:00:00Z`);
    const to = Date.parse(`${u.searchParams.get("end_date")}T23:00:00Z`);
    const time: string[] = [];
    const rain: number[] = [];
    const code: number[] = [];
    for (let t = from; t <= to; t += 3_600_000) {
      const iso = new Date(t).toISOString();
      const wet = iso.startsWith("2026-07-02") && Number(iso.slice(11, 13)) >= 9 && Number(iso.slice(11, 13)) <= 16;
      time.push(iso.slice(0, 16));
      rain.push(wet ? 1.5 : 0);
      code.push(wet ? 63 : 3);
    }
    const n = time.length;
    return Response.json({
      hourly: {
        time,
        temperature_2m: Array.from({ length: n }, (_, i) => 14 + (i % 24) / 3),
        relative_humidity_2m: Array(n).fill(80),
        wind_speed_10m: Array(n).fill(10),
        wind_gusts_10m: Array(n).fill(25),
        precipitation: rain,
        weather_code: code,
        is_day: Array(n).fill(1),
      },
    });
  }) as typeof fetch;
}

describe.skipIf(!url)("végétation et météo du plan 3D (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const maize = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  const original = weatherDeps.fetch;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test végétation 3D"));
    worker = await addMember(sql, farmId, "worker");
    const campaign = crypto.randomUUID();
    const version = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${maize}, ${farmId}, 'Maïs')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${version}, ${maize}, ST_GeomFromText(${LONG_EW}, 4326), 40000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species, cultivation) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${maize}, 'field_crop', 'DKC5432', 'zea_mays')`;
    for (const [d, v] of [["05-21", 0.21], ["06-03", 0.48], ["06-13", 0.74], ["06-26", 0.79], ["07-11", 0.77], ["07-28", 0.56], ["08-07", 0.44], ["08-19", 0.27], ["08-29", 0.19]] as const) {
      await sql`INSERT INTO parcel_indices (farm_id, land_parcel_version_id, acquired_on, vegetation_index, mean, valid_px, parcel_px, method)
        VALUES (${farmId}, ${version}, ${`2026-${d}`}, 'ndvi', ${v}, 3000, 3200, 'test')`;
    }
  });
  afterAll(async () => {
    weatherDeps.fetch = original;
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  const get = async (at: string) => {
    const res = await app.request(`/api/v1/farms/${farmId}/vegetation3d?at=${at}`, { headers });
    expect(res.status).toBe(200);
    return (await res.json()) as Vegetation3dAt;
  };

  it("maïs en croissance début juillet, rangs automatiques sur le grand axe, météo pluvieuse résumée", async () => {
    weatherDeps.fetch = fakeOpenMeteo();
    const body = await get("2026-07-02");
    const [p] = body.parcels;
    expect(p).toMatchObject({ parcelId: maize, species: "zea_mays", nature: "field_crop" });
    expect(p!.canopy.phase).toBe("growing");
    expect(p!.canopy.heightM).toBeGreaterThan(2);
    expect(p!.rows.auto).toBe(true);
    expect(p!.rows.spacingM).toBe(0.75);
    expect(Math.abs(p!.rows.bearingDeg - 90)).toBeLessThan(2);
    expect(body.weather).toMatchObject({ day: "2026-07-02", source: "open_meteo", kind: "observed", icon: "10d", precipitationMm: 12 });
    expect(body.weather!.precipitation48hMm).toBe(12);
  });

  it("récolte saisie : chaumes ; NDVI au sol nu sans récolte : récolté aussi", async () => {
    weatherDeps.fetch = (async () => {
      throw new Error("Open-Meteo injoignable");
    }) as typeof fetch;
    const before = await get("2026-08-12");
    expect(before.parcels[0]!.canopy.phase).toBe("senescent");
    expect(before.weather).toBeNull(); // la météo manque, la végétation reste

    const harvest = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${harvest}, ${farmId}, 'grains_harvest', 'done', 'web', '2026-08-11T08:00:00Z', '2026-08-11T18:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${harvest}, 'target', 'land_parcel', ${maize})`;
    expect((await get("2026-08-12")).parcels[0]!.canopy).toMatchObject({ phase: "harvested", heightM: 0.12 });
    await sql`DELETE FROM interventions WHERE id = ${harvest}`;
    expect((await get("2026-09-01")).parcels[0]!.canopy.phase).toBe("harvested");
  });

  it("rangs saisis par le responsable, refusés à un ouvrier, retour à l'automatique", async () => {
    weatherDeps.fetch = (async () => Response.json({ hourly: {} })) as typeof fetch;
    const put = (h: Record<string, string>, body: unknown) =>
      app.request(`/api/v1/farms/${farmId}/land-parcels/${maize}/rows`, { method: "PUT", headers: h, body: JSON.stringify(body) });
    expect((await put(worker.headers, { bearingDeg: 30, spacingM: 0.8 })).status).toBe(403);
    expect((await put(headers, { bearingDeg: 30, spacingM: 20 })).status).toBe(400);
    expect((await put(headers, { bearingDeg: 210, spacingM: 0.8 })).status).toBe(204);
    expect((await get("2026-07-02")).parcels[0]!.rows).toEqual({ bearingDeg: 30, spacingM: 0.8, auto: false });
    const del = await app.request(`/api/v1/farms/${farmId}/land-parcels/${maize}/rows`, { method: "DELETE", headers });
    expect(del.status).toBe(204);
    expect((await get("2026-07-02")).parcels[0]!.rows.auto).toBe(true);
  });
});
