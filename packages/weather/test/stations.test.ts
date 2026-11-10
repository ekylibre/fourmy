import { describe, it, expect } from "vitest";
import { SencropClient, StationError, WeenatClient, windows } from "../src/stations.js";

/** Clients des stations (lot W) : réponses simulées d'après les plugins Ekylibre. */
type Call = { url: string; init?: RequestInit };
function fake(routes: (url: string, init?: RequestInit) => unknown) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = routes(url, init);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("Weenat", () => {
  it("jeton JWT une fois, parcelles-stations, mesures horaires par fenêtres de 30 jours", async () => {
    const { impl, calls } = fake((url) => {
      if (url.endsWith("/api-token-auth/")) return { token: "jwt-1" };
      if (url.endsWith("/v2/access/plots/")) return [{ id: 42, name: "Station du Pré", latitude: 44.8, longitude: 0.5, device_count: 1 }];
      if (url.includes("/measures/")) {
        const start = Number(new URL(url).searchParams.get("start"));
        return { [String(start)]: { RR: 0.4, T: 15.3, U: 54, FF: 7.2, FXY: 18, SSI: 737 } };
      }
      return new Response("", { status: 404 });
    });
    const c = new WeenatClient("pierre@ferme.fr", "secret", impl);
    expect(await c.stations()).toEqual([{ externalId: "42", name: "Station du Pré", lat: 44.8, lon: 0.5 }]);
    const m = await c.measures("42", new Date("2026-01-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"));
    expect(m).toHaveLength(2); // 59 jours → 2 fenêtres
    expect(m[0]).toMatchObject({ at: "2026-01-01T00:00:00.000Z", temperatureC: 15.3, humidityPct: 54, windKmh: 7.2, gustKmh: 18, precipitationMm: 0.4 });
    expect(calls.filter((x) => x.url.endsWith("/api-token-auth/"))).toHaveLength(1);
    expect((calls[1]!.init!.headers as Record<string, string>).authorization).toBe("JWT jwt-1");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ email: "pierre@ferme.fr", password: "secret" });
  });

  it("mauvais identifiants : message lisible", async () => {
    const { impl } = fake(() => new Response('{"non_field_errors":["Bad Request"]}', { status: 400 }));
    await expect(new WeenatClient("x", "y", impl).stations()).rejects.toThrow("Weenat refuse l'accès : vérifiez l'e-mail et le mot de passe.");
  });
});

describe("Sencrop", () => {
  it("OAuth2 Basic, utilisateur, stations, mesures horaires dans la fenêtre", async () => {
    const { impl, calls } = fake((url) => {
      if (url.endsWith("/oauth2/token")) return { access_token: "tok", expires_in: 3600 };
      if (url.endsWith("/me")) return { item: 7 };
      if (url.includes("/devices?")) return { items: [11, 12], devicesStatuses: { "11": { contents: { name: "Sencrop vigne", latitude: 44.81, longitude: 0.49 } } } };
      if (url.includes("/data/hourly")) {
        const before = Date.parse(new URL(url).searchParams.get("beforeDate")!);
        return {
          measures: {
            interval: "1h",
            data: [
              { key: before - 3_600_000, TEMPERATURE: { value: 12.5 }, RAIN_FALL: { value: 1.2 }, RELATIVE_HUMIDITY: { value: 88 }, WIND_SPEED: { value: 4 }, LEAF_WETNESS: { value: 45 } },
              { key: Date.parse("2020-01-01"), TEMPERATURE: { value: 0 } }, // hors fenêtre
            ],
          },
        };
      }
      return new Response("", { status: 404 });
    });
    const c = new SencropClient("app-id", "app-secret", impl);
    expect(await c.stations()).toEqual([
      { externalId: "11", name: "Sencrop vigne", lat: 44.81, lon: 0.49 },
      { externalId: "12", name: "Sencrop 12", lat: null, lon: null },
    ]);
    const m = await c.measures("11", new Date("2026-06-01T00:00:00Z"), new Date("2026-06-03T00:00:00Z"));
    expect(m).toEqual([
      expect.objectContaining({ at: "2026-06-02T23:00:00.000Z", temperatureC: 12.5, precipitationMm: 1.2, humidityPct: 88, windKmh: 4, leafWetnessMin: 45, gustKmh: null }),
    ]);
    const token = calls.find((x) => x.url.endsWith("/oauth2/token"))!;
    expect((token.init!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("app-id:app-secret").toString("base64")}`);
    expect(calls.filter((x) => x.url.endsWith("/oauth2/token"))).toHaveLength(1);
    expect(calls.find((x) => x.url.includes("/data/hourly"))!.url).toContain("/users/7/devices/11/data/hourly?beforeDate=2026-06-03T00%3A00%3A00.000Z&days=2");
  });

  it("401 : erreur d'accès, sans nouvel essai", async () => {
    const { impl, calls } = fake(() => new Response("", { status: 401 }));
    await expect(new SencropClient("a", "b", impl).stations()).rejects.toBeInstanceOf(StationError);
    expect(calls).toHaveLength(1);
  });
});

describe("fenêtres", () => {
  it("découpe sans chevauchement", () => {
    const w = windows(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-20T00:00:00Z"), 7);
    expect(w.map((x) => x.to.toISOString().slice(0, 10))).toEqual(["2026-01-08", "2026-01-15", "2026-01-20"]);
  });
});
