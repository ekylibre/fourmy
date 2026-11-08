import { describe, it, expect } from "vitest";
import { dominantIcon, iconFromWmo, meteoblueForecast, openMeteoHours, openWeatherForecast, sprayCondition, summarize, type WeatherHour } from "../src/index.js";

const hour = (at: string, patch: Partial<WeatherHour> = {}): WeatherHour => ({
  at,
  temperatureC: 15,
  humidityPct: 80,
  windKmh: 5,
  gustKmh: 9,
  precipitationMm: 0,
  stepHours: 1,
  ...patch,
});

describe("fournisseurs ramenés au même format", () => {
  it("Open-Meteo : archive au-delà de 80 jours, prévision sinon ; heures UTC", async () => {
    const urls: string[] = [];
    const fake = (async (u: string) => {
      urls.push(u);
      return Response.json({ hourly: { time: ["2025-09-23T06:00", "2025-09-23T07:00"], temperature_2m: [12.5, 14], relative_humidity_2m: [90, 85], wind_speed_10m: [4, 6], wind_gusts_10m: [10, 12], precipitation: [0, 0.2], weather_code: [2, 61], is_day: [1, 1] } });
    }) as unknown as typeof fetch;
    const hours = await openMeteoHours(43.38, -0.21, new Date("2025-09-23T06:00:00Z"), new Date("2025-09-23T08:00:00Z"), fake);
    expect(urls[0]).toMatch(/^https:\/\/archive-api\.open-meteo\.com/);
    expect(hours[0]).toEqual({ at: "2025-09-23T06:00:00.000Z", temperatureC: 12.5, humidityPct: 90, windKmh: 4, gustKmh: 10, precipitationMm: 0, stepHours: 1, icon: "03d" });
    expect(hours[1]!.icon).toBe("10d"); // code WMO 61 : pluie
    await openMeteoHours(43.38, -0.21, new Date(), new Date(Date.now() + 86_400_000), fake);
    expect(urls[1]).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  });

  it("OpenWeather : pas de 3 h, vent m/s → km/h, pluie sur 3 h", async () => {
    const fake = (async () => Response.json({ list: [{ dt: 1758607200, main: { temp: 18, humidity: 70 }, wind: { speed: 2, gust: 4 }, rain: { "3h": 0.6 }, weather: [{ icon: "10n" }] }] })) as unknown as typeof fetch;
    const [h] = await openWeatherForecast("k", 43, 0, fake);
    expect(h).toMatchObject({ temperatureC: 18, humidityPct: 70, windKmh: 7.2, gustKmh: 14.4, precipitationMm: 0.6, stepHours: 3, icon: "10n" });
  });

  it("meteoblue : heures sans fuseau lues en UTC", async () => {
    const fake = (async () => Response.json({ data_1h: { time: ["2026-11-09 08:00"], temperature: [9], relativehumidity: [88], windspeed: [6], precipitation: [0], pictocode: [22], isdaylight: [1] } })) as unknown as typeof fetch;
    const [h] = await meteoblueForecast("k", 43, 0, fake);
    expect(h).toMatchObject({ at: "2026-11-09T08:00:00.000Z", temperatureC: 9, humidityPct: 88, windKmh: 6, icon: "04d" }); // pictocode 22 : couvert
  });

  it("une clé refusée donne un message clair", async () => {
    const fake = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(openWeatherForecast("mauvaise", 43, 0, fake)).rejects.toThrow("OpenWeather : clé d'API refusée.");
  });
});

describe("météo d'une intervention", () => {
  const hours = [
    hour("2025-09-23T05:00:00Z", { temperatureC: 10 }),
    hour("2025-09-23T06:00:00Z", { temperatureC: 12, windKmh: 4, icon: "02d" }),
    hour("2025-09-23T07:00:00Z", { temperatureC: 16, windKmh: 10, precipitationMm: 0.4, icon: "10d" }),
    hour("2025-09-23T08:00:00Z", { temperatureC: 20 }),
  ];
  it("moyennes sur les périodes, vent maximal, pluie cumulée ; observée si passée", () => {
    const s = summarize(hours, [{ startedAt: "2025-09-23T06:00:00Z", stoppedAt: "2025-09-23T08:00:00Z" }], "open_meteo", new Date("2026-01-01"));
    expect(s).toMatchObject({ source: "open_meteo", kind: "observed", temperatureC: 14, humidityPct: 80, windKmh: 7, windMaxKmh: 10, precipitationMm: 0.4 });
    // Temps dominant : la pluie l'emporte ; frise des heures de la période.
    expect(s!.icon).toBe("10d");
    expect(s!.hours.map((h) => [h.at.slice(11, 13), h.icon])).toEqual([["06", "02d"], ["07", "10d"]]);
  });
  it("prévision si la période est à venir ; rien si aucune heure ne la couvre", () => {
    expect(summarize(hours, [{ startedAt: "2025-09-23T06:00:00Z", stoppedAt: "2025-09-23T07:00:00Z" }], "open_meteo", new Date("2025-09-22"))!.kind).toBe("forecast");
    expect(summarize(hours, [{ startedAt: "2025-10-01T06:00:00Z", stoppedAt: "2025-10-01T07:00:00Z" }], "open_meteo")).toBeNull();
  });
  it("un pas de 3 h qui chevauche la période compte", () => {
    const three = [hour("2025-09-23T06:00:00Z", { stepHours: 3, temperatureC: 18 })];
    expect(summarize(three, [{ startedAt: "2025-09-23T07:00:00Z", stoppedAt: "2025-09-23T08:00:00Z" }], "openweather")!.temperatureC).toBe(18);
  });
});

describe("conditions de pulvérisation (seuils d'Ekylibre)", () => {
  it("favorable : vent faible, air humide, doux, sec", () => {
    expect(sprayCondition(hour("t", { windKmh: 6, humidityPct: 85, temperatureC: 15, precipitationMm: 0 }))).toMatchObject({ level: "go", reasons: [] });
  });
  it("à surveiller : vent entre 2 et 5 m/s, hygrométrie 60 %", () => {
    const c = sprayCondition(hour("t", { windKmh: 12, humidityPct: 60 }));
    expect(c.level).toBe("caution");
    expect(c.reasons).toEqual(["vent 12 km/h", "hygrométrie 60 %"]);
  });
  it("défavorable : vent ≥ 5 m/s (18 km/h), pluie, chaleur", () => {
    expect(sprayCondition(hour("t", { windKmh: 19 })).level).toBe("stop");
    expect(sprayCondition(hour("t", { precipitationMm: 1.2 })).reasons).toEqual(["pluie 1,2 mm"]);
    expect(sprayCondition(hour("t", { temperatureC: 31 })).level).toBe("stop");
  });
});

describe("icônes (codes OpenWeather)", () => {
  it("codes WMO et temps dominant", () => {
    expect([0, 1, 2, 3, 45, 53, 63, 75, 95].map((c) => iconFromWmo(c, true))).toEqual(["01d", "02d", "03d", "04d", "50d", "09d", "10d", "13d", "11d"]);
    expect(iconFromWmo(0, false)).toBe("01n");
    expect(dominantIcon(["01n", "03d", null])).toBe("03d");
    expect(dominantIcon([null, undefined])).toBeNull();
  });
});
