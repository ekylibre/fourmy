import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { StationClient, StationInfo, StationMeasure, WeatherHour } from "@fourmy/weather";

/**
 * Stations météo de l'agriculteur (lot W) : copie des stations du compte
 * Weenat ou Sencrop et de leurs mesures horaires ; mesures de la station la
 * plus proche pour la météo d'une intervention passée.
 */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Première synchronisation : 30 jours d'historique. */
export const FIRST_SYNC_DAYS = 30;
/** Rayon au-delà duquel une station ne représente plus les parcelles. */
export const STATION_RADIUS_M = 5_000;

export interface StationSyncReport {
  stations: { name: string; inserted: number; from: string | null }[];
  measures: number;
}

/** Recopie les stations du compte ; renvoie leur identifiant Fourmy et leur dernière mesure. */
async function upsertStations(tx: Tx, farmId: string, provider: "weenat" | "sencrop", list: StationInfo[]) {
  const out: { id: string; info: StationInfo; lastMeasureAt: Date | null }[] = [];
  for (const s of list) {
    const location = s.lat !== null && s.lon !== null ? sql`ST_SetSRID(ST_MakePoint(${s.lon}, ${s.lat}), 4326)` : sql`NULL`;
    const [r] = await rows<{ id: string; last_measure_at: Date | string | null }>(
      tx,
      sql`INSERT INTO weather_stations (id, farm_id, provider, external_id, name, location)
          VALUES (${crypto.randomUUID()}, ${farmId}, ${provider}, ${s.externalId}, ${s.name}, ${location})
          ON CONFLICT (farm_id, provider, external_id)
          DO UPDATE SET name = EXCLUDED.name, location = coalesce(EXCLUDED.location, weather_stations.location), updated_at = now()
          RETURNING id, last_measure_at`,
    );
    out.push({ id: r!.id, info: s, lastMeasureAt: r!.last_measure_at ? new Date(r!.last_measure_at) : null });
  }
  return out;
}

async function insertMeasures(tx: Tx, farmId: string, stationId: string, list: StationMeasure[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    if (!chunk.length) continue;
    const values = chunk.map(
      (m) => sql`(${stationId}, ${farmId}, ${m.at}::timestamptz, ${m.temperatureC}, ${m.temperatureMinC}, ${m.temperatureMaxC}, ${m.humidityPct},
                  ${m.windKmh}, ${m.gustKmh}, ${m.windDirectionDeg}, ${m.precipitationMm}, ${m.leafWetnessMin}, ${JSON.stringify(m.raw)}::jsonb)`,
    );
    await tx.execute(sql`
      INSERT INTO weather_measures (station_id, farm_id, at, temperature_c, temperature_min_c, temperature_max_c, humidity_pct,
                                    wind_kmh, gust_kmh, wind_direction_deg, precipitation_mm, leaf_wetness_min, raw)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (station_id, at) DO UPDATE SET
        temperature_c = EXCLUDED.temperature_c, temperature_min_c = EXCLUDED.temperature_min_c, temperature_max_c = EXCLUDED.temperature_max_c,
        humidity_pct = EXCLUDED.humidity_pct, wind_kmh = EXCLUDED.wind_kmh, gust_kmh = EXCLUDED.gust_kmh,
        wind_direction_deg = EXCLUDED.wind_direction_deg, precipitation_mm = EXCLUDED.precipitation_mm,
        leaf_wetness_min = EXCLUDED.leaf_wetness_min, raw = EXCLUDED.raw`);
    n += chunk.length;
  }
  if (list.length) {
    await tx.execute(sql`UPDATE weather_stations SET last_measure_at = greatest(coalesce(last_measure_at, '-infinity'), ${list.at(-1)!.at}::timestamptz), updated_at = now() WHERE id = ${stationId}`);
  }
  return n;
}

/**
 * Synchronisation incrémentale : depuis la dernière mesure (2 h de
 * recouvrement, mesures parfois complétées après coup), sinon 30 jours.
 * Idempotente (une ligne par station et par heure).
 */
export async function syncStations(db: Database, farmId: string, provider: "weenat" | "sencrop", client: StationClient, now = new Date()): Promise<StationSyncReport> {
  const list = await client.stations();
  const stations = await withFarm(db, farmId, (tx) => upsertStations(tx, farmId, provider, list));
  const report: StationSyncReport = { stations: [], measures: 0 };
  for (const s of stations) {
    const from = s.lastMeasureAt ? new Date(s.lastMeasureAt.getTime() - 2 * HOUR) : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);
    const measures = await client.measures(s.info.externalId, from, now);
    const inserted = await withFarm(db, farmId, (tx) => insertMeasures(tx, farmId, s.id, measures));
    report.stations.push({ name: s.info.name, inserted, from: from.toISOString() });
    report.measures += inserted;
  }
  return report;
}

/**
 * Heures mesurées par la station active la plus proche du point (moins de
 * 5 km), si elles couvrent au moins 80 % des heures de la fenêtre.
 */
export async function stationHours(
  tx: Tx,
  point: { lat: number; lon: number },
  from: Date,
  to: Date,
): Promise<{ source: "weenat" | "sencrop"; station: { name: string; distanceM: number }; hours: WeatherHour[] } | null> {
  const [station] = await rows<{ id: string; name: string; provider: "weenat" | "sencrop"; distance_m: number }>(
    tx,
    sql`SELECT s.id, s.name, s.provider,
               ST_Distance(s.location::geography, ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography) AS distance_m
        FROM weather_stations s
        WHERE s.active AND s.location IS NOT NULL
          AND ST_DWithin(s.location::geography, ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography, ${STATION_RADIUS_M})
          AND EXISTS (SELECT 1 FROM weather_measures m WHERE m.station_id = s.id AND m.at >= ${from.toISOString()}::timestamptz - interval '1 hour' AND m.at <= ${to.toISOString()}::timestamptz)
        ORDER BY distance_m LIMIT 1`,
  );
  if (!station) return null;
  const measures = await rows<{
    at: Date | string;
    temperature_c: string | null;
    humidity_pct: string | null;
    wind_kmh: string | null;
    gust_kmh: string | null;
    precipitation_mm: string | null;
  }>(
    tx,
    sql`SELECT at, temperature_c, humidity_pct, wind_kmh, gust_kmh, precipitation_mm FROM weather_measures
        WHERE station_id = ${station.id} AND at >= ${from.toISOString()}::timestamptz - interval '1 hour' AND at <= ${to.toISOString()}::timestamptz
        ORDER BY at`,
  );
  const expected = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / HOUR));
  if (measures.length < 0.8 * expected) return null;
  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    source: station.provider,
    station: { name: station.name, distanceM: Math.round(Number(station.distance_m)) },
    hours: measures.map((m) => ({
      at: new Date(m.at).toISOString(),
      temperatureC: n(m.temperature_c),
      humidityPct: n(m.humidity_pct),
      windKmh: n(m.wind_kmh),
      gustKmh: n(m.gust_kmh),
      precipitationMm: n(m.precipitation_mm),
      stepHours: 1,
      icon: null,
    })),
  };
}

/** Stations de la ferme et leur dernière mesure (page Intégrations). */
export async function listStations(db: Database, farmId: string) {
  return withFarm(db, farmId, (tx) =>
    rows<{ id: string; provider: string; name: string; lat: number | null; lon: number | null; last_measure_at: string | null; measures: number }>(
      tx,
      sql`SELECT s.id, s.provider, s.name, ST_Y(s.location) AS lat, ST_X(s.location) AS lon, s.last_measure_at,
                 (SELECT count(*)::int FROM weather_measures m WHERE m.station_id = s.id) AS measures
          FROM weather_stations s ORDER BY s.provider, s.name`,
    ),
  );
}
