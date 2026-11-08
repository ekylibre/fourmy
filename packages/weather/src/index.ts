/**
 * @fourmy/weather — météo des interventions (exigences MET-1 à MET-3).
 *
 * Trois fournisseurs ramenés à un même format horaire :
 * - Open-Meteo : sans clé, prévision (jusqu'à 16 jours) et historique (depuis
 *   1940) — fournisseur par défaut ;
 * - OpenWeather : clé de la ferme, prévision 5 jours au pas de 3 h (l'API
 *   gratuite n'a pas d'historique) ;
 * - meteoblue : clé de la ferme, paquet `basic-1h_agro-1h` (prévision).
 * Pour une date passée hors de portée du fournisseur choisi, Open-Meteo
 * (historique) prend le relais ; la source est toujours indiquée.
 */

export interface WeatherHour {
  /** Début de l'heure (ISO, UTC). */
  at: string;
  temperatureC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  /** Pluie sur le pas de temps (mm). */
  precipitationMm: number | null;
  /** Durée du pas (h) : 1, ou 3 pour OpenWeather. */
  stepHours: number;
}

export type WeatherProviderName = "open_meteo" | "openweather" | "meteoblue";

export interface WeatherSummary {
  source: WeatherProviderName;
  kind: "observed" | "forecast";
  temperatureC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  windMaxKmh: number | null;
  precipitationMm: number | null;
}

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const OPENWEATHER = "https://api.openweathermap.org/data/2.5";
const METEOBLUE = "https://my.meteoblue.com/packages/basic-1h_agro-1h";
const HOUR = 3_600_000;
const DAY = 86_400_000;

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function getJson(url: string, fetchImpl: typeof fetch, label: string): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`${label} : clé d'API refusée.`);
    throw new Error(`${label} : HTTP ${res.status}`);
  }
  return res.json().catch(() => {
    throw new Error(`${label} : réponse illisible.`);
  });
}

// --- Open-Meteo ---------------------------------------------------------------

/**
 * Heures météo entre deux instants, Open-Meteo. Au-delà de 80 jours dans le
 * passé : l'archive (réanalyse ERA5) ; sinon l'API de prévision, qui couvre
 * aussi les jours récents.
 */
export async function openMeteoHours(lat: number, lon: number, from: Date, to: Date, fetchImpl: typeof fetch = fetch): Promise<WeatherHour[]> {
  const archive = to.getTime() < Date.now() - 80 * DAY;
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation",
    start_date: day(from),
    end_date: day(to),
    timezone: "UTC",
    wind_speed_unit: "kmh",
  });
  const body = (await getJson(`${archive ? OPEN_METEO_ARCHIVE : OPEN_METEO}?${params}`, fetchImpl, "Open-Meteo")) as {
    hourly?: Record<string, unknown[]>;
  };
  const h = body.hourly ?? {};
  const times = (h.time as string[] | undefined) ?? [];
  return times.map((t, i) => ({
    at: new Date(`${t}:00Z`).toISOString(),
    temperatureC: num(h.temperature_2m?.[i]),
    humidityPct: num(h.relative_humidity_2m?.[i]),
    windKmh: num(h.wind_speed_10m?.[i]),
    gustKmh: num(h.wind_gusts_10m?.[i]),
    precipitationMm: num(h.precipitation?.[i]),
    stepHours: 1,
  }));
}

// --- OpenWeather --------------------------------------------------------------

/** Vérifie la clé (météo actuelle au point). */
export async function openWeatherTest(apiKey: string, lat: number, lon: number, fetchImpl: typeof fetch = fetch) {
  const p = new URLSearchParams({ lat: String(lat), lon: String(lon), units: "metric", appid: apiKey });
  const body = (await getJson(`${OPENWEATHER}/weather?${p}`, fetchImpl, "OpenWeather")) as { name?: string; main?: { temp?: number } };
  return { place: body.name ?? null, temperatureC: num(body.main?.temp) };
}

/** Prévision 5 jours, pas de 3 h (vent en m/s converti en km/h). */
export async function openWeatherForecast(apiKey: string, lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<WeatherHour[]> {
  const p = new URLSearchParams({ lat: String(lat), lon: String(lon), units: "metric", appid: apiKey });
  const body = (await getJson(`${OPENWEATHER}/forecast?${p}`, fetchImpl, "OpenWeather")) as {
    list?: { dt: number; main?: { temp?: number; humidity?: number }; wind?: { speed?: number; gust?: number }; rain?: Record<string, number> }[];
  };
  return (body.list ?? []).map((e) => ({
    at: new Date(e.dt * 1000).toISOString(),
    temperatureC: num(e.main?.temp),
    humidityPct: num(e.main?.humidity),
    windKmh: num(e.wind?.speed) === null ? null : e.wind!.speed! * 3.6,
    gustKmh: num(e.wind?.gust) === null ? null : e.wind!.gust! * 3.6,
    precipitationMm: e.rain?.["3h"] ?? 0,
    stepHours: 3,
  }));
}

// --- meteoblue ----------------------------------------------------------------

/** Prévision horaire, paquet agro (vent demandé en km/h, heures UTC). */
export async function meteoblueForecast(apiKey: string, lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<WeatherHour[]> {
  const p = new URLSearchParams({ apikey: apiKey, lat: String(lat), lon: String(lon), format: "json", tz: "UTC", windspeed: "kmh", timeformat: "iso8601" });
  const body = (await getJson(`${METEOBLUE}?${p}`, fetchImpl, "meteoblue")) as { data_1h?: Record<string, unknown[]> };
  const d = body.data_1h ?? {};
  const times = (d.time as string[] | undefined) ?? [];
  return times.map((t, i) => ({
    at: new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(" ", "T")}Z`).toISOString(),
    temperatureC: num(d.temperature?.[i]),
    humidityPct: num(d.relativehumidity?.[i]),
    windKmh: num(d.windspeed?.[i]),
    gustKmh: num(d.gust?.[i]) ?? num(d.windgusts?.[i]),
    precipitationMm: num(d.precipitation?.[i]),
    stepHours: 1,
  }));
}

export async function meteoblueTest(apiKey: string, lat: number, lon: number, fetchImpl: typeof fetch = fetch) {
  const hours = await meteoblueForecast(apiKey, lat, lon, fetchImpl);
  if (hours.length === 0) throw new Error("meteoblue : aucune donnée pour ce paquet.");
  return { hours: hours.length, temperatureC: hours[0]!.temperatureC };
}

// --- Résumé d'une intervention ------------------------------------------------

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * Météo d'une intervention : moyennes sur ses périodes (température,
 * hygrométrie, vent), vent maximal et pluie cumulée. Les pas de temps qui
 * chevauchent une période comptent ; une intervention planifiée sans période
 * prend les trois heures qui suivent sa date prévue.
 */
export function summarize(
  hours: WeatherHour[],
  periods: { startedAt: string; stoppedAt: string }[],
  source: WeatherProviderName,
  now = new Date(),
): WeatherSummary | null {
  const windows = periods.map((p) => [new Date(p.startedAt).getTime(), new Date(p.stoppedAt).getTime()] as const);
  const inside = hours.filter((h) => {
    const s = new Date(h.at).getTime();
    const e = s + h.stepHours * HOUR;
    return windows.some(([a, b]) => s < b && e > a);
  });
  if (inside.length === 0) return null;
  const vals = (k: keyof WeatherHour) => inside.map((h) => h[k]).filter((v): v is number => typeof v === "number");
  const rain = vals("precipitationMm");
  const winds = [...vals("windKmh"), ...vals("gustKmh")];
  const end = Math.max(...windows.map(([, b]) => b));
  return {
    source,
    kind: end <= now.getTime() ? "observed" : "forecast",
    temperatureC: mean(vals("temperatureC")),
    humidityPct: mean(vals("humidityPct")),
    windKmh: mean(vals("windKmh")),
    windMaxKmh: vals("windKmh").length ? Math.round(Math.max(...vals("windKmh")) * 10) / 10 : winds.length ? Math.round(Math.max(...winds) * 10) / 10 : null,
    precipitationMm: rain.length ? Math.round(rain.reduce((a, b) => a + b, 0) * 10) / 10 : null,
  };
}

// --- Conditions de pulvérisation ----------------------------------------------

export type SprayLevel = "go" | "caution" | "stop";

export interface SprayCondition {
  at: string;
  level: SprayLevel;
  /** Raisons d'un créneau défavorable ou à surveiller. */
  reasons: string[];
  hour: WeatherHour;
}

const worse = (a: SprayLevel, b: SprayLevel): SprayLevel => (a === "stop" || b === "stop" ? "stop" : a === "caution" || b === "caution" ? "caution" : "go");

/**
 * Conditions de pulvérisation d'un pas de temps, seuils d'Ekylibre
 * (`weather_spraying_cells_controller.rb`) : vent ≤ 2 m/s favorable, < 5 m/s
 * à surveiller (19 km/h, limite réglementaire), hygrométrie 75–95 %,
 * température 5–25 °C, pluie ≤ 0,1 mm (≤ 0,3 mm à surveiller).
 */
export function sprayCondition(h: WeatherHour): SprayCondition {
  let level: SprayLevel = "go";
  const reasons: string[] = [];
  const flag = (l: SprayLevel, reason: string) => {
    level = worse(level, l);
    if (l !== "go") reasons.push(reason);
  };
  if (h.windKmh !== null) {
    const ms = h.windKmh / 3.6;
    flag(ms <= 2 ? "go" : ms < 5 ? "caution" : "stop", `vent ${Math.round(h.windKmh)} km/h`);
  }
  if (h.humidityPct !== null) {
    const u = h.humidityPct;
    flag(u >= 75 && u <= 95 ? "go" : (u > 50 && u < 75) || (u > 95 && u < 99) ? "caution" : "stop", `hygrométrie ${Math.round(u)} %`);
  }
  if (h.temperatureC !== null) {
    const t = h.temperatureC;
    flag(t >= 5 && t <= 25 ? "go" : (t > 25 && t < 30) || (t > 0 && t < 5) ? "caution" : "stop", `température ${Math.round(t)} °C`);
  }
  if (h.precipitationMm !== null) {
    const p = h.precipitationMm / h.stepHours;
    flag(p <= 0.1 ? "go" : p <= 0.3 ? "caution" : "stop", `pluie ${(Math.round(h.precipitationMm * 10) / 10).toLocaleString("fr-FR")} mm`);
  }
  return { at: h.at, level, reasons, hour: h };
}
