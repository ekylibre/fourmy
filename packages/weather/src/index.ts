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
  /** Code d'icône au format OpenWeather (`01d`…`50n`), quel que soit le fournisseur. */
  icon?: string | null;
}

/** Heure résumée gardée avec la météo d'une intervention (frise horaire de la fiche). */
export interface WeatherHourBrief {
  at: string;
  icon: string | null;
  temperatureC: number | null;
  precipitationMm: number | null;
  windKmh: number | null;
}

export type WeatherProviderName = "open_meteo" | "openweather" | "meteoblue" | "weenat" | "sencrop";

export interface WeatherSummary {
  source: WeatherProviderName;
  kind: "observed" | "forecast";
  temperatureC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  windMaxKmh: number | null;
  precipitationMm: number | null;
  /** Temps dominant de la période (code OpenWeather). */
  icon: string | null;
  /** Heures de la période (frise de la fiche). */
  hours: WeatherHourBrief[];
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

// --- Icônes ---------------------------------------------------------------------
//
// Référence commune : les codes d'icône d'OpenWeather
// (https://openweathermap.org/weather-conditions#Icon-list), `d` le jour,
// `n` la nuit. Open-Meteo (codes WMO) et meteoblue (pictocodes) y sont ramenés.

/** Code WMO (Open-Meteo) → code d'icône OpenWeather. */
export function iconFromWmo(code: number | null, isDay: boolean): string | null {
  if (code === null) return null;
  const s = isDay ? "d" : "n";
  if (code === 0) return `01${s}`;
  if (code === 1) return `02${s}`;
  if (code === 2) return `03${s}`;
  if (code === 3) return `04${s}`;
  if (code === 45 || code === 48) return `50${s}`;
  if ((code >= 51 && code <= 57) || (code >= 80 && code <= 82)) return `09${s}`;
  if (code >= 61 && code <= 67) return `10${s}`;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return `13${s}`;
  if (code >= 95) return `11${s}`;
  return null;
}

/** Pictocode horaire meteoblue (1 à 35) → code d'icône OpenWeather. */
export function iconFromMeteoblue(code: number | null, isDay: boolean): string | null {
  if (code === null) return null;
  const s = isDay ? "d" : "n";
  const base: Record<number, string> = {
    1: "01", 2: "01", 3: "01", 4: "02", 5: "02", 6: "02", 7: "03", 8: "03", 9: "03",
    10: "11", 11: "11", 12: "11", 13: "50", 14: "50", 15: "50", 16: "50", 17: "50", 18: "50",
    19: "04", 20: "04", 21: "04", 22: "04", 23: "10", 24: "13", 25: "10", 26: "13", 27: "11",
    28: "09", 29: "13", 30: "13", 31: "09", 32: "13", 33: "09", 34: "13", 35: "13",
  };
  return base[code] ? `${base[code]}${s}` : null;
}

/** Gravité d'un temps (le temps dominant d'une période est le plus marquant). */
const SEVERITY = ["01", "02", "03", "04", "50", "09", "10", "13", "11"];

/** Temps dominant de quelques heures : le plus marquant ; jour si une heure l'est. */
export function dominantIcon(icons: (string | null | undefined)[]): string | null {
  const known = icons.filter((i): i is string => !!i && /^\d\d[dn]$/.test(i));
  if (known.length === 0) return null;
  const worst = known.reduce((w, i) => (SEVERITY.indexOf(i.slice(0, 2)) > SEVERITY.indexOf(w.slice(0, 2)) ? i : w));
  return `${worst.slice(0, 2)}${known.some((i) => i.endsWith("d")) ? "d" : "n"}`;
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
    hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,weather_code,is_day",
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
    icon: iconFromWmo(num(h.weather_code?.[i]), h.is_day?.[i] !== 0),
  }));
}

/** Journée météo agronomique (Open-Meteo, heure de Paris). */
export interface WeatherDay {
  day: string;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  precipitationMm: number | null;
  /** Évapotranspiration de référence FAO-56 (Penman-Monteith). */
  et0Mm: number | null;
  /** Vent maximal du jour à 10 m (km/h). */
  windMaxKmh?: number | null;
}

/**
 * Journées météo Open-Meteo : l'archive (réanalyse ERA5, quelques jours de
 * retard) pour `source: "archive"`, sinon l'API de prévision avec 7 jours
 * passés et 16 jours de prévision (dates ignorées).
 */
export async function openMeteoDays(
  lat: number,
  lon: number,
  range: { source: "archive"; from: string; to: string } | { source: "forecast" },
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    daily: "temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration,wind_speed_10m_max",
    timezone: "Europe/Paris",
    wind_speed_unit: "kmh",
  });
  if (range.source === "archive") {
    params.set("start_date", range.from);
    params.set("end_date", range.to);
  } else {
    params.set("past_days", "7");
    params.set("forecast_days", "16");
  }
  const body = (await getJson(`${range.source === "archive" ? OPEN_METEO_ARCHIVE : OPEN_METEO}?${params}`, fetchImpl, "Open-Meteo")) as {
    daily?: Record<string, unknown[]>;
  };
  const d = body.daily ?? {};
  const times = (d.time as string[] | undefined) ?? [];
  return times.map((t, i) => ({
    day: t,
    temperatureMinC: num(d.temperature_2m_min?.[i]),
    temperatureMaxC: num(d.temperature_2m_max?.[i]),
    precipitationMm: num(d.precipitation_sum?.[i]),
    et0Mm: num(d.et0_fao_evapotranspiration?.[i]),
    windMaxKmh: num(d.wind_speed_10m_max?.[i]),
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
    list?: {
      dt: number;
      main?: { temp?: number; humidity?: number };
      wind?: { speed?: number; gust?: number };
      rain?: Record<string, number>;
      weather?: { icon?: string }[];
    }[];
  };
  return (body.list ?? []).map((e) => ({
    at: new Date(e.dt * 1000).toISOString(),
    temperatureC: num(e.main?.temp),
    humidityPct: num(e.main?.humidity),
    windKmh: num(e.wind?.speed) === null ? null : e.wind!.speed! * 3.6,
    gustKmh: num(e.wind?.gust) === null ? null : e.wind!.gust! * 3.6,
    precipitationMm: e.rain?.["3h"] ?? 0,
    stepHours: 3,
    icon: /^\d\d[dn]$/.test(e.weather?.[0]?.icon ?? "") ? e.weather![0]!.icon! : null,
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
    icon: iconFromMeteoblue(num(d.pictocode?.[i]), d.isdaylight?.[i] !== 0),
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
    icon: dominantIcon(inside.map((h) => h.icon)),
    // Frise : au plus 48 pas, pour garder la météo enregistrée légère.
    hours: inside.slice(0, 48).map((h) => ({
      at: h.at,
      icon: h.icon ?? null,
      temperatureC: h.temperatureC,
      precipitationMm: h.precipitationMm,
      windKmh: h.windKmh,
    })),
  };
}

// Conditions de pulvérisation : règle et seuils dans @fourmy/domain (sprayingHour),
// pour un seul calcul dans toute l'application, aux seuils de la ferme.

export * from "./stations.js";
