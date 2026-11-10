import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import type { StationClient, StationMeasure } from "@fourmy/weather";
import { createApp } from "../src/app.js";
import { syncStations } from "../src/repos/weather-stations.js";
import { interventionWeather } from "../src/repos/weather.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Stations météo (lot W) : synchro idempotente et incrémentale ; météo d'une
 * intervention passée prise à la station la plus proche (moins de 5 km),
 * sinon au fournisseur habituel.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const HOUR = 3_600_000;

const measure = (at: number, t: number): StationMeasure => ({
  at: new Date(at).toISOString(),
  temperatureC: t,
  temperatureMinC: null,
  temperatureMaxC: null,
  humidityPct: 70,
  windKmh: 6,
  gustKmh: 15,
  windDirectionDeg: null,
  precipitationMm: 0.2,
  leafWetnessMin: null,
  raw: { T: t },
});

describe.skipIf(!url)("stations météo (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url!);
  const parcel = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  const now = new Date("2026-06-11T00:00:00Z");
  const asked: { from: string; to: string }[] = [];
  const client: StationClient = {
    stations: async () => [
      { externalId: "near", name: "Station du Pré", lat: 44.8005, lon: 0.5007 },
      { externalId: "far", name: "Station lointaine", lat: 45.5, lon: 1.5 },
    ],
    measures: async (id, from, to) => {
      asked.push({ from: from.toISOString(), to: to.toISOString() });
      const out: StationMeasure[] = [];
      for (let t = Math.ceil(from.getTime() / HOUR) * HOUR; t <= to.getTime(); t += HOUR) out.push(measure(t, id === "near" ? 21 : 5));
      return out;
    },
  };

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test stations"));
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Le Pré')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10000, tstzrange('2026-01-01', NULL))`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("synchro : 30 jours à la première, puis depuis la dernière mesure ; idempotente", async () => {
    const first = await syncStations(db, farmId, "weenat", client, now);
    expect(first.stations.map((s) => s.name)).toEqual(["Station du Pré", "Station lointaine"]);
    expect(asked[0]!.from).toBe(new Date(now.getTime() - 30 * 24 * HOUR).toISOString());
    expect(first.measures).toBe(2 * (30 * 24 + 1));
    const later = new Date(now.getTime() + 5 * HOUR);
    const second = await syncStations(db, farmId, "weenat", client, later);
    expect(asked.at(-1)!.from).toBe(new Date(now.getTime() - 2 * HOUR).toISOString()); // recouvrement de 2 h
    expect(second.measures).toBe(2 * 8);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM weather_measures WHERE farm_id = ${farmId}`;
    expect(n).toBe(2 * (30 * 24 + 1 + 5));
    const stations = (await (await app.request(`/api/v1/farms/${farmId}/weather/stations`, { headers })).json()).items;
    expect(stations).toHaveLength(2);
    expect(stations[0]).toMatchObject({ provider: "weenat", name: "Station du Pré", measures: 30 * 24 + 1 + 5 });
  });

  it("météo d'une intervention passée : station la plus proche, avec sa distance", async () => {
    const w = await interventionWeather(db, farmId, {
      periods: [{ startedAt: "2026-06-10T08:00:00Z", stoppedAt: "2026-06-10T11:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcel }],
    });
    expect(w).toMatchObject({ source: "weenat", kind: "observed", temperatureC: 21, humidityPct: 70 });
    expect(w!.station!.name).toBe("Station du Pré");
    expect(w!.station!.distanceM).toBeLessThan(200);
  });
});
