import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { InterventionTarget, InterventionWeather, SprayingForecast, WorkPeriod } from "@fourmy/contracts";
import {
  meteoblueForecast,
  openMeteoHours,
  openWeatherForecast,
  sprayCondition,
  summarize,
  type WeatherHour,
  type WeatherProviderName,
} from "@fourmy/weather";
import { decryptSecret } from "../secrets.js";

/**
 * Météo des interventions (lot 3) côté serveur : les clés des fournisseurs
 * restent sur le serveur. Ordre : meteoblue, OpenWeather (intégrations
 * actives de la ferme), puis Open-Meteo (sans clé) ; pour le passé, toujours
 * l'historique d'Open-Meteo. Un fournisseur en panne laisse la main au
 * suivant ; la source est enregistrée.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const HOUR = 3_600_000;

interface KeyedProvider {
  name: "meteoblue" | "openweather";
  apiKey: string;
}

async function keyedProviders(tx: Tx): Promise<KeyedProvider[]> {
  const list = await rows<{ provider: "meteoblue" | "openweather"; secret_ciphertext: string }>(
    tx,
    sql`SELECT provider, secret_ciphertext FROM integrations
        WHERE provider IN ('meteoblue', 'openweather') AND enabled AND secret_ciphertext IS NOT NULL AND status <> 'error'`,
  );
  const order = { meteoblue: 0, openweather: 1 };
  return list
    .sort((a, b) => order[a.provider] - order[b.provider])
    .map((p) => ({ name: p.provider, apiKey: decryptSecret(p.secret_ciphertext) }));
}

/** Point météo : centre des parcelles ciblées à la date, sinon de toute la ferme. */
async function weatherPoint(tx: Tx, targets: InterventionTarget[] = [], at = new Date().toISOString()): Promise<{ lat: number; lon: number } | null> {
  const ids = targets.filter((t) => t.kind === "land_parcel").map((t) => t.id);
  const [p] = await rows<{ lat: number | null; lon: number | null }>(
    tx,
    ids.length
      ? sql`SELECT ST_Y(c) AS lat, ST_X(c) AS lon FROM (SELECT ST_Centroid(ST_Collect(v.shape)) AS c FROM land_parcel_versions v
             WHERE v.land_parcel_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) AND v.valid @> ${at}::timestamptz) x`
      : // Centre de la ferme : toutes les parcelles connues (les versions closes en fin de campagne comprises).
        sql`SELECT ST_Y(c) AS lat, ST_X(c) AS lon FROM (SELECT ST_Centroid(ST_Collect(v.shape)) AS c FROM land_parcel_versions v
             JOIN land_parcels lp ON lp.id = v.land_parcel_id) x`,
  );
  if (p?.lat == null || p.lon == null) {
    // Parcelles sans version à la date : leur dernière forme connue.
    if (ids.length) return weatherPoint(tx, [], at);
    return null;
  }
  return { lat: p.lat, lon: p.lon };
}

/** Heures météo d'une fenêtre, par le premier fournisseur qui répond. */
async function hoursFor(
  providers: KeyedProvider[],
  lat: number,
  lon: number,
  from: Date,
  to: Date,
  fetchImpl: typeof fetch,
): Promise<{ source: WeatherProviderName; hours: WeatherHour[] }> {
  const future = to.getTime() > Date.now();
  if (future) {
    for (const p of providers) {
      try {
        const hours = p.name === "meteoblue" ? await meteoblueForecast(p.apiKey, lat, lon, fetchImpl) : await openWeatherForecast(p.apiKey, lat, lon, fetchImpl);
        // Couverture de la fenêtre, au pas du fournisseur (3 h pour OpenWeather).
        const covers =
          hours.some((h) => new Date(h.at).getTime() <= from.getTime() + h.stepHours * HOUR) &&
          hours.some((h) => new Date(h.at).getTime() + h.stepHours * HOUR >= to.getTime());
        if (covers) return { source: p.name, hours };
      } catch {
        // Fournisseur indisponible ou fenêtre hors de sa prévision : suivant.
      }
    }
  }
  return { source: "open_meteo", hours: await openMeteoHours(lat, lon, from, to, fetchImpl) };
}

export interface WeatherRequest {
  periods: WorkPeriod[];
  plannedAt?: string;
  targets?: InterventionTarget[];
}

/** Météo d'une intervention (pré-remplissage du formulaire, worker). */
export async function interventionWeather(db: Database, farmId: string, req: WeatherRequest, fetchImpl: typeof fetch = fetch): Promise<InterventionWeather | null> {
  const periods = req.periods.length
    ? req.periods
    : req.plannedAt
      ? [{ startedAt: req.plannedAt, stoppedAt: new Date(new Date(req.plannedAt).getTime() + 3 * HOUR).toISOString() }]
      : [];
  if (periods.length === 0) return null;
  const from = new Date(Math.min(...periods.map((p) => new Date(p.startedAt).getTime())));
  const to = new Date(Math.max(...periods.map((p) => new Date(p.stoppedAt).getTime())));
  // Au-delà de la portée des prévisions : rien à proposer.
  if (from.getTime() > Date.now() + 15 * 86_400_000) return null;
  const { point, providers } = await withFarm(db, farmId, async (tx) => ({
    point: await weatherPoint(tx, req.targets ?? [], to.toISOString()),
    providers: await keyedProviders(tx),
  }));
  if (!point) return null;
  const { source, hours } = await hoursFor(providers, point.lat, point.lon, from, to, fetchImpl);
  const s = summarize(hours, periods, source);
  return s ? { ...s, fetchedAt: new Date().toISOString() } : null;
}

/** Créneaux de pulvérisation des prochains jours au centre de la ferme (widget). */
export async function sprayingForecast(db: Database, farmId: string, days = 3, fetchImpl: typeof fetch = fetch): Promise<SprayingForecast | null> {
  const { point, providers } = await withFarm(db, farmId, async (tx) => ({ point: await weatherPoint(tx), providers: await keyedProviders(tx) }));
  if (!point) return null;
  const now = new Date();
  const from = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  const to = new Date(from.getTime() + days * 24 * HOUR);
  const { source, hours } = await hoursFor(providers, point.lat, point.lon, from, to, fetchImpl);
  const slots = hours
    .filter((h) => {
      const t = new Date(h.at).getTime();
      return t + h.stepHours * HOUR > from.getTime() && t < to.getTime();
    })
    .map((h) => {
      const c = sprayCondition(h);
      return {
        at: h.at,
        stepHours: h.stepHours,
        level: c.level,
        reasons: c.reasons,
        temperatureC: h.temperatureC,
        humidityPct: h.humidityPct,
        windKmh: h.windKmh,
        precipitationMm: h.precipitationMm,
      };
    });
  return { source, latitude: Math.round(point.lat * 1e4) / 1e4, longitude: Math.round(point.lon * 1e4) / 1e4, slots };
}

/** Complète la météo d'une intervention réalisée (worker, historique Open-Meteo). */
export async function fillInterventionWeather(db: Database, farmId: string, interventionId: string, fetchImpl: typeof fetch = fetch): Promise<InterventionWeather | null> {
  const req = await withFarm(db, farmId, async (tx) => {
    const periods = await rows<{ startedAt: string; stoppedAt: string }>(
      tx,
      sql`SELECT started_at AS "startedAt", stopped_at AS "stoppedAt" FROM intervention_periods WHERE intervention_id = ${interventionId} ORDER BY started_at`,
    );
    const targets = await rows<{ id: string }>(
      tx,
      sql`SELECT ref_id AS id FROM intervention_parameters WHERE intervention_id = ${interventionId} AND role = 'target' AND ref_type = 'land_parcel'`,
    );
    return {
      periods: periods.map((p) => ({ startedAt: new Date(p.startedAt).toISOString(), stoppedAt: new Date(p.stoppedAt).toISOString() })),
      targets: targets.map((t) => ({ kind: "land_parcel" as const, id: t.id })),
    };
  });
  let weather: InterventionWeather | null;
  try {
    weather = await interventionWeather(db, farmId, req, fetchImpl);
  } catch (e) {
    // Requête refusée (4xx) : erreur permanente pour cette intervention, marquée
    // « sans données » ; panne (5xx, réseau) : réessayée au prochain tour.
    if (!(e instanceof Error) || !/HTTP 4\d\d/.test(e.message)) throw e;
    weather = null;
  }
  // Aucune donnée (pas de période, hors couverture) : marqué pour ne pas réessayer sans fin.
  const stored = weather ?? { source: "open_meteo", kind: "observed", temperatureC: null, humidityPct: null, windKmh: null, precipitationMm: null, fetchedAt: new Date().toISOString() };
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`UPDATE interventions SET weather = ${JSON.stringify(stored)}::jsonb WHERE id = ${interventionId} AND weather IS NULL`),
  );
  return weather;
}

export async function pendingWeather(db: Database, limit = 20): Promise<{ id: string; farm_id: string }[]> {
  return (await db.execute(sql`SELECT id, farm_id FROM fourmy_weather_pending(${limit})`)) as unknown as { id: string; farm_id: string }[];
}
