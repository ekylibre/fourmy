import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  COVER_REMOVING_PROCEDURES,
  DEFAULT_TAW_MM,
  IRRIGATION_PROCEDURES,
  PROCEDURES,
  type CropAlert,
  type CropModelAt,
  type CropStageDate,
  type ParcelCropSeries,
  type ParcelCropState,
  type ParcelSoil,
  type ParcelSoilWrite,
  type WaterSupply,
  type WeatherBasis,
} from "@fourmy/contracts";
import { addDays, cropModelFor, dailyNormals, simulateSeason, stateAt, weatherSeries, type ModelWeatherDay, type Simulation } from "@fourmy/domain";
import { openMeteoDays, type WeatherDay } from "@fourmy/weather";
import { NotFound } from "../routes/helpers.js";

/**
 * Modèle de croissance (lot AB, docs/modele-croissance.md) : pour chaque
 * parcelle semée (semis réalisé saisi), stades par degrés-jours et bilan
 * hydrique, sur la météo journalière Open-Meteo du centre de la ferme mise en
 * cache (`daily_weather`).
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Années d'archive qui fondent les normales. */
const NORMAL_YEARS = 5;
/** L'archive ERA5 d'Open-Meteo a quelques jours de retard ; au-delà, l'API de prévision (7 jours passés). */
const ARCHIVE_LAG_DAYS = 6;
/** Rafraîchissement de la prévision. */
const FORECAST_TTL_MS = 6 * 3_600_000;
/** Un semis plus ancien n'est plus celui de la culture en place. */
const SEASON_MAX_DAYS = 400;
/** Fenêtres des signalements. */
const FLOWERING_SOON_DAYS = 10;
const HARVESTABLE_SOON_DAYS = 15;
const IRRIGATION_SOON_DAYS = 3;

const SOWING = PROCEDURES.filter((p) => p.shape === "sowing" && p.category === "crops").map((p) => p.code);
const parisToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// --- Météo journalière --------------------------------------------------------

interface CachedDay {
  day: string;
  tmin: number | null;
  tmax: number | null;
  rain: number | null;
  et0: number | null;
  source: "archive" | "forecast";
}

async function farmCenter(tx: Tx, farmId: string): Promise<{ lat: number; lon: number } | null> {
  const [p] = await rows<{ lat: number | null; lon: number | null }>(
    tx,
    sql`SELECT ST_Y(c) AS lat, ST_X(c) AS lon FROM (SELECT ST_Centroid(ST_Collect(v.shape)) AS c FROM land_parcel_versions v
        JOIN land_parcels lp ON lp.id = v.land_parcel_id WHERE lp.farm_id = ${farmId}) x`,
  );
  return p?.lat == null || p.lon == null ? null : { lat: p.lat, lon: p.lon };
}

async function store(tx: Tx, farmId: string, days: WeatherDay[], source: "archive" | "forecast") {
  const usable = days.filter((d) => d.temperatureMinC !== null && d.temperatureMaxC !== null);
  for (let i = 0; i < usable.length; i += 500) {
    const chunk = usable.slice(i, i + 500);
    const values = sql.join(
      chunk.map((d) => sql`(${farmId}, ${d.day}::date, ${d.temperatureMinC}, ${d.temperatureMaxC}, ${d.precipitationMm}, ${d.et0Mm}, ${d.windMaxKmh ?? null}, true, ${source})`),
      sql`, `,
    );
    // L'archive est définitive ; une prévision ne remplace jamais une journée d'archive.
    await tx.execute(sql`
      INSERT INTO daily_weather (farm_id, day, tmin_c, tmax_c, rain_mm, et0_mm, wind_max_kmh, with_wind, source) VALUES ${values}
      ON CONFLICT (farm_id, day) DO UPDATE SET tmin_c = excluded.tmin_c, tmax_c = excluded.tmax_c, rain_mm = excluded.rain_mm,
        et0_mm = excluded.et0_mm, wind_max_kmh = excluded.wind_max_kmh, with_wind = true, source = excluded.source, fetched_at = now()
      WHERE daily_weather.source = 'forecast' OR (excluded.source = 'archive' AND NOT daily_weather.with_wind)`);
  }
}

/** Mises à jour du cache en cours, par ferme et période : partagées entre requêtes simultanées. */
const refreshing = new Map<string, Promise<void>>();

/**
 * Météo journalière de la ferme de `from` à aujourd'hui + 15 jours, et les
 * 5 années civiles qui précèdent `from` (normales). Ne télécharge que ce qui
 * manque au cache ; une panne d'Open-Meteo laisse le cache servir.
 */
export async function farmDailyWeather(
  db: Database,
  farmId: string,
  from: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ known: Map<string, Omit<ModelWeatherDay, "day">>; normals: ReturnType<typeof dailyNormals>; until: string | null }> {
  const today = parisToday();
  const histStart = `${Number(from.slice(0, 4)) - NORMAL_YEARS}-01-01`;
  const archiveEnd = addDays(today, -ARCHIVE_LAG_DAYS);
  const { point, span } = await withFarm(db, farmId, async (tx) => ({
    point: await farmCenter(tx, farmId),
    span: (
      await rows<{ lo: string | null; hi: string | null; fresh: string | null; windless: string | null }>(
        tx,
        sql`SELECT min(day) FILTER (WHERE source = 'archive')::text AS lo, max(day) FILTER (WHERE source = 'archive')::text AS hi,
                   max(fetched_at) FILTER (WHERE source = 'forecast')::text AS fresh,
                   -- Vent ajouté au cache (lot AL) : la dernière année d'archive est rechargée une fois si le vent y manque.
                   min(day) FILTER (WHERE source = 'archive' AND NOT with_wind AND day >= ${addDays(today, -400)}::date)::text AS windless
            FROM daily_weather WHERE farm_id = ${farmId}`,
      )
    )[0],
  }));
  // Une seule mise à jour à la fois par ferme : les requêtes simultanées (plans imprimés, liste) l'attendent au lieu de la relancer.
  const key = `${farmId}|${histStart}`;
  const running = refreshing.get(key);
  if (running) await running;
  else if (point) {
    const job = (async () => {
      const ranges: [string, string][] = [];
      if (!span?.lo || !span.hi) ranges.push([histStart, archiveEnd]);
      else {
        if (span.lo > histStart) ranges.push([histStart, addDays(span.lo, -1)]);
        if (span.hi < archiveEnd) ranges.push([addDays(span.hi, 1), archiveEnd]);
        if (span.windless) ranges.push([span.windless, span.hi < archiveEnd ? span.hi : archiveEnd]);
      }
      // Téléchargements hors transaction ; chaque lot reçu est enregistré aussitôt.
      try {
        for (const [a, b] of ranges) {
          if (a > b) continue;
          const days = await openMeteoDays(point.lat, point.lon, { source: "archive", from: a, to: b }, fetchImpl);
          await withFarm(db, farmId, (tx) => store(tx, farmId, days, "archive"));
        }
        if (!span?.fresh || Date.now() - Date.parse(span.fresh) > FORECAST_TTL_MS) {
          const days = await openMeteoDays(point.lat, point.lon, { source: "forecast" }, fetchImpl);
          await withFarm(db, farmId, (tx) => store(tx, farmId, days, "forecast"));
        }
      } catch (e) {
        console.warn(`[modèle de croissance] Open-Meteo indisponible, cache seul : ${e instanceof Error ? e.message : e}`);
      }
    })().finally(() => refreshing.delete(key));
    refreshing.set(key, job);
    await job;
  }
  const cached = await withFarm(db, farmId, (tx) =>
    rows<CachedDay>(
      tx,
      sql`SELECT day::text AS day, tmin_c AS tmin, tmax_c AS tmax, rain_mm AS rain, et0_mm AS et0, source
          FROM daily_weather WHERE farm_id = ${farmId} AND day >= ${histStart}::date ORDER BY day`,
    ),
  );
  const complete = cached.filter((d) => d.tmin !== null && d.tmax !== null);
  const year = `${from.slice(0, 4)}-01-01`;
  const normals = dailyNormals(
    complete
      .filter((d) => d.source === "archive" && d.day < year)
      .map((d) => ({ day: d.day, tminC: d.tmin!, tmaxC: d.tmax!, rainMm: d.rain ?? 0, et0Mm: d.et0 ?? 0 })),
  );
  const known = new Map<string, Omit<ModelWeatherDay, "day">>();
  for (const d of complete.filter((x) => x.day >= from)) {
    const basis: WeatherBasis = d.source === "archive" || d.day < today ? "observed" : "forecast";
    known.set(d.day, { tminC: d.tmin!, tmaxC: d.tmax!, rainMm: d.rain ?? 0, et0Mm: d.et0 ?? 0, basis });
  }
  return { known, normals, until: complete.length ? complete[complete.length - 1]!.day : null };
}

// --- Saisons ------------------------------------------------------------------

interface Season {
  parcelId: string;
  parcelName: string;
  species: string | null;
  sownOn: string;
  endedOn: string | null;
  soil: ParcelSoil;
  /** Irrigations réalisées saisies sur la parcelle pendant la saison : dose (mm) par jour. */
  applied: Map<string, number>;
}

/** Parcelles valides au jour, leur dernier semis réalisé (400 jours au plus), leur culture et leur sol. */
async function seasons(tx: Tx, farmId: string, at: string, parcelId?: string): Promise<{ parcelId: string; parcelName: string; season: Season | null; species: string | null }[]> {
  const noon = sql`${at}::date::timestamptz + interval '12 hours'`;
  const sowing = sql.join(SOWING.map((c) => sql`${c}`), sql`, `);
  const removing = sql.join(COVER_REMOVING_PROCEDURES.map((c) => sql`${c}`), sql`, `);
  const watering = sql.join(IRRIGATION_PROCEDURES.map((c) => sql`${c}`), sql`, `);
  const list = await rows<{
    id: string;
    name: string;
    sown_on: string | null;
    ended_on: string | null;
    species: string | null;
    taw: number | null;
    irrigated: boolean | null;
    applied: { day: string; mm: number }[] | null;
  }>(
    tx,
    sql`
      SELECT lp.id, lp.name, s.sown_on, e.ended_on, prod.species, ps.taw_mm AS taw, ps.irrigated, w.applied
      FROM land_parcels lp
      JOIN land_parcel_versions v ON v.land_parcel_id = lp.id AND v.valid @> ${noon}
      LEFT JOIN LATERAL (
        SELECT (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS sown_on
        FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = lp.id
        WHERE i.status = 'done' AND i.procedure IN (${sowing})
          AND (i.started_at AT TIME ZONE 'Europe/Paris')::date BETWEEN ${at}::date - ${SEASON_MAX_DAYS}::int AND ${at}::date
        ORDER BY i.started_at DESC LIMIT 1) s ON true
      LEFT JOIN LATERAL (
        SELECT min((i.started_at AT TIME ZONE 'Europe/Paris')::date)::text AS ended_on
        FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = lp.id
        WHERE i.status = 'done' AND i.procedure IN (${removing}) AND s.sown_on IS NOT NULL
          AND (i.started_at AT TIME ZONE 'Europe/Paris')::date > s.sown_on::date) e ON true
      -- Irrigations réalisées de la saison (dose en mm sur la parcelle), cumulées par jour.
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('day', d.day, 'mm', d.mm) ORDER BY d.day) AS applied FROM (
          SELECT (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day, sum((i.irrigation->>'depthMm')::numeric)::float8 AS mm
          FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = lp.id
          WHERE i.status = 'done' AND i.procedure IN (${watering}) AND i.irrigation IS NOT NULL AND s.sown_on IS NOT NULL
            AND (i.started_at AT TIME ZONE 'Europe/Paris')::date >= s.sown_on::date
            AND (e.ended_on IS NULL OR (i.started_at AT TIME ZONE 'Europe/Paris')::date <= e.ended_on::date)
          GROUP BY 1) d) w ON true
      -- Culture : la production de la campagne du semis (un semis d'automne prépare la campagne suivante).
      LEFT JOIN LATERAL (
        SELECT coalesce(p.cultivation, p.species) AS species FROM productions p JOIN campaigns c ON c.id = p.campaign_id
        WHERE p.land_parcel_id = lp.id AND NOT p.declared
          AND c.year = coalesce(extract(year FROM s.sown_on::date + interval '5 months')::int, extract(year FROM ${at}::date)::int)
        ORDER BY p.updated_at DESC LIMIT 1) prod ON true
      LEFT JOIN parcel_soils ps ON ps.land_parcel_id = lp.id
      WHERE lp.farm_id = ${farmId} ${parcelId ? sql`AND lp.id = ${parcelId}` : sql``}
      ORDER BY lp.name`,
  );
  return list.map((r) => ({
    parcelId: r.id,
    parcelName: r.name,
    species: r.species,
    season: r.sown_on
      ? {
          parcelId: r.id,
          parcelName: r.name,
          species: r.species,
          sownOn: r.sown_on,
          endedOn: r.ended_on,
          // Fiche sol sans réserve utile (type de sol seul, lot AF) : réserve par défaut, irrigation saisie.
          soil: { tawMm: r.taw ?? DEFAULT_TAW_MM, irrigated: !!r.irrigated, auto: r.taw === null && !r.irrigated },
          applied: new Map((r.applied ?? []).map((a) => [a.day, a.mm])),
        }
      : null,
  }));
}

// --- Simulation et état ---------------------------------------------------------

const supplyOf = (season: Season): WaterSupply => (season.applied.size > 0 ? "recorded" : season.soil.irrigated ? "ideal" : "rainfed");

/**
 * Avec des irrigations saisies, elles seules comptent jusqu'à aujourd'hui ;
 * le pilotage idéal d'une parcelle irriguée ne prévoit que les apports à
 * venir, à partir de demain.
 */
function simulate(season: Season, weather: Awaited<ReturnType<typeof farmDailyWeather>>, today = parisToday()): Simulation | null {
  const model = cropModelFor(season.species);
  if (!model) return null;
  const series = weatherSeries(season.sownOn, addDays(season.sownOn, 365), weather.known, weather.normals);
  if (series.length === 0) return null;
  return simulateSeason({
    model,
    sownOn: season.sownOn,
    weather: series,
    tawMm: season.soil.tawMm,
    irrigated: season.soil.irrigated,
    endOn: season.endedOn,
    applied: season.applied,
    autoFrom: season.applied.size > 0 ? addDays(today, 1) : null,
  });
}

function cropState(season: Season, sim: Simulation, at: string, until: string | null): ParcelCropState {
  const st = stateAt(sim, at);
  const ended = season.endedOn !== null && season.endedOn <= at;
  const stage = (s: (typeof sim.stages)[number]): CropStageDate => ({ code: s.code, label: s.label, gdd: s.gdd, on: s.on, basis: s.basis });
  return {
    parcelId: season.parcelId,
    parcelName: season.parcelName,
    species: season.species,
    model: sim.model.kind,
    modelLabel: sim.model.label,
    sownOn: season.sownOn,
    endedOn: season.endedOn,
    stage: ended ? { code: "ended", label: "Récoltée" } : st.stage ? { code: st.stage.code, label: st.stage.label } : null,
    next: ended || !st.next ? null : stage(st.next),
    gdd: st.day?.gdd ?? null,
    stages: sim.stages.map(stage),
    soil: season.soil,
    waterSupply: supplyOf(season),
    water:
      ended || !st.day
        ? null
        : {
            reserve: st.day.reserve,
            tawMm: st.day.tawMm,
            ks: st.day.ks,
            stressBelow: Math.round((1 - sim.model.p) * 100) / 100,
            stressDays: st.stressDays,
            floweringStressDays: st.floweringStressDays,
            irrigationMm: st.irrigationMm,
            appliedMm: st.appliedMm,
            appliedDays: st.appliedDays,
            lastAppliedOn: st.lastAppliedOn,
          },
    weatherUntil: until,
  };
}

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Signalements au jour : floraison et récolte proches, stress hydrique (en
 * sec, ou malgré les irrigations saisies), irrigation à prévoir (parcelle
 * irriguée).
 */
function alertsFor(s: ParcelCropState, sim: Simulation, at: string): CropAlert[] {
  if (s.stage?.code === "ended") return [];
  const base = { parcelId: s.parcelId, parcelName: s.parcelName };
  const out: CropAlert[] = [];
  const soon = (code: string, days: number) => s.stages.find((x) => x.code === code && x.on !== null && x.on > at && x.on <= addDays(at, days));
  const flowering = soon(sim.model.flowering, FLOWERING_SOON_DAYS);
  if (flowering) out.push({ ...base, kind: "flowering_soon", on: flowering.on, text: `vers le ${fmt(flowering.on!)}` });
  const harvestable = soon("harvestable", HARVESTABLE_SOON_DAYS);
  if (harvestable) out.push({ ...base, kind: "harvestable_soon", on: harvestable.on, text: `vers le ${fmt(harvestable.on!)}` });
  const emerged = s.stage !== null;
  const matured = s.stages.some((x) => x.code === sim.model.maturity && x.on !== null && x.on <= at);
  if (s.water && emerged && !matured) {
    // Pilotage idéal : pas de stress par construction. Sinon le stress simulé est réel (pluie et doses saisies).
    if (s.waterSupply !== "ideal" && s.water.ks < 1) {
      const irrigatedText = s.water.lastAppliedOn ? `, dernière irrigation le ${fmt(s.water.lastAppliedOn)}` : "";
      out.push({ ...base, kind: "water_stress", on: null, text: `réserve à ${Math.round(s.water.reserve * 100)} %${irrigatedText}` });
    }
    if (s.soil.irrigated) {
      const next = sim.days.find((d) => d.date >= at && d.date <= addDays(at, IRRIGATION_SOON_DAYS) && d.irrigationMm > 0);
      if (next) out.push({ ...base, kind: "irrigation_due", on: next.date, depthMm: Math.round(next.irrigationMm), text: `vers le ${fmt(next.date)}, environ ${Math.round(next.irrigationMm)} mm` });
    }
  }
  return out;
}

/** État du modèle de toutes les parcelles semées à la date. */
export async function cropModelAt(db: Database, farmId: string, at: string, fetchImpl: typeof fetch = fetch): Promise<CropModelAt> {
  const list = await withFarm(db, farmId, (tx) => seasons(tx, farmId, at));
  const sown = list.flatMap((l) => (l.season && cropModelFor(l.season.species) ? [l.season] : []));
  if (sown.length === 0) return { at, items: [], alerts: [], weatherMissing: false };
  const from = sown.reduce((m, s) => (s.sownOn < m ? s.sownOn : m), sown[0]!.sownOn);
  const weather = await farmDailyWeather(db, farmId, from, fetchImpl);
  const items: ParcelCropState[] = [];
  const alerts: CropAlert[] = [];
  for (const season of sown) {
    const sim = simulate(season, weather);
    if (!sim) continue;
    const state = cropState(season, sim, at, weather.until);
    items.push(state);
    alerts.push(...alertsFor(state, sim, at));
  }
  return { at, items, alerts, weatherMissing: items.length === 0 };
}

/** Modèle d'une parcelle avec sa série journalière (graphique de la fiche). */
export async function parcelCropModel(db: Database, farmId: string, parcelId: string, at: string, fetchImpl: typeof fetch = fetch): Promise<ParcelCropSeries> {
  const [row] = await withFarm(db, farmId, async (tx) => {
    const [exists] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!exists) throw new NotFound("Parcelle introuvable.");
    return seasons(tx, farmId, at, parcelId);
  });
  if (!row?.season) return { at, state: null, days: [], reason: "no_sowing" };
  if (!cropModelFor(row.season.species)) return { at, state: null, days: [], reason: "no_model" };
  const weather = await farmDailyWeather(db, farmId, row.season.sownOn, fetchImpl);
  const sim = simulate(row.season, weather);
  if (!sim) return { at, state: null, days: [], reason: "weather_missing" };
  // La série s'arrête à la récolte saisie, sinon 15 jours après le stade « récoltable ».
  const harvestable = sim.stages.find((s) => s.code === "harvestable")?.on;
  const stop = row.season.endedOn ?? (harvestable ? addDays(harvestable, 15) : null);
  return {
    at,
    state: cropState(row.season, sim, at, weather.until),
    days: sim.days
      .filter((d) => !stop || d.date <= stop)
      .map((d) => ({ date: d.date, basis: d.basis, gdd: d.gdd, reserve: d.reserve, ks: d.ks, rainMm: d.rainMm, etcMm: d.etcMm, irrigationMm: d.irrigationMm, appliedMm: d.appliedMm })),
    reason: null,
  };
}

export async function setParcelSoil(db: Database, farmId: string, userId: string, parcelId: string, input: ParcelSoilWrite | null): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [parcel] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!parcel) throw new NotFound("Parcelle introuvable.");
    if (input === null) {
      // Retour aux valeurs par défaut du modèle ; le type de sol et le point d'eau (lot AF) restent.
      await tx.execute(sql`UPDATE parcel_soils SET taw_mm = NULL, irrigated = false, updated_by = ${userId}, updated_at = now() WHERE land_parcel_id = ${parcelId}`);
      return;
    }
    await tx.execute(sql`
      INSERT INTO parcel_soils (land_parcel_id, farm_id, taw_mm, irrigated, updated_by)
      VALUES (${parcelId}, ${farmId}, ${input.tawMm}, ${input.irrigated}, ${userId})
      ON CONFLICT (land_parcel_id) DO UPDATE SET taw_mm = excluded.taw_mm, irrigated = excluded.irrigated,
        updated_by = excluded.updated_by, updated_at = now()`);
  });
}
