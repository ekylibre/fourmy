import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SentinelClient, SentinelError, decodeGrayPng, type SentinelUsage } from "../src/index.js";

/** Réponses synthétiques (aucune donnée de ferme réelle). */
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    calls.push({ url, body, auth: headers.get("authorization") });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const tokenResponse = (n = 1) => Response.json({ access_token: `jeton-${n}`, expires_in: 600 });
const json = (body: unknown, pu?: number, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(pu !== undefined ? { "x-processingunits-spent": String(pu) } : {}) } });

const geom = { epsg: 32630, geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] } };
const stats = (mean: number | string, sample: number, nodata: number) => ({
  stats: { mean, stDev: 0.05, sampleCount: sample, noDataCount: nodata, percentiles: { "10.0": 0.6, "50.0": 0.7, "90.0": 0.8 } },
});

describe("SentinelClient", () => {
  it("obtient un jeton, le réutilise, et ne renvoie jamais le secret dans l'erreur", async () => {
    let tokens = 0;
    const { f, calls } = fakeFetch((url) => (url.includes("openid-connect") ? tokenResponse(++tokens) : json({ data: [] }, 0.04)));
    const c = new SentinelClient({ clientId: "sh-id", clientSecret: "TRES-SECRET" }, { fetch: f });
    await c.parcelStats(geom, "2026-06-01", "2026-06-10");
    await c.parcelStats(geom, "2026-06-01", "2026-06-10");
    expect(tokens).toBe(1);
    expect(calls[0]!.body).toMatchObject({ grant_type: "client_credentials", client_id: "sh-id" });
    expect(calls[1]!.auth).toBe("Bearer jeton-1");

    const refused = fakeFetch(() => new Response("invalid_client", { status: 401 }));
    const bad = new SentinelClient({ clientId: "sh-id", clientSecret: "TRES-SECRET" }, { fetch: refused.f });
    const err = await bad.token().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SentinelError);
    expect(String((err as Error).message)).not.toContain("TRES-SECRET");
  });

  it("construit la requête statistique en UTM à 10 m, P1D, et lit les pixels valides", async () => {
    const { f, calls } = fakeFetch((url) =>
      url.includes("openid-connect")
        ? tokenResponse()
        : json(
            {
              data: [
                { interval: { from: "2026-06-26T00:00:00Z", to: "2026-06-27T00:00:00Z" }, outputs: { idx: { bands: { ndvi: stats(0.79, 1500, 400), ndre: stats(0.65, 1500, 400), ndmi: stats(0.37, 1500, 400) } } } },
                // Passage entièrement nuageux : moyenne « NaN », aucune valeur gardée.
                { interval: { from: "2026-06-28T00:00:00Z", to: "2026-06-29T00:00:00Z" }, outputs: { idx: { bands: { ndvi: stats("NaN", 1500, 1500), ndre: stats("NaN", 1500, 1500), ndmi: stats("NaN", 1500, 1500) } } } },
                { interval: { from: "2026-06-30T00:00:00Z", to: "2026-07-01T00:00:00Z" }, error: { type: "EXECUTION_ERROR" } },
              ],
            },
            0.12,
          ),
    );
    const c = new SentinelClient({ clientId: "a", clientSecret: "b" }, { fetch: f });
    const { rows, pu } = await c.parcelStats(geom, "2026-06-20", "2026-06-30");
    expect(pu).toBe(0.12);
    const req = calls[1]!.body as Record<string, any>;
    expect(calls[1]!.url).toBe("https://sh.dataspace.copernicus.eu/api/v1/statistics");
    expect(req.input.bounds.properties.crs).toBe("http://www.opengis.net/def/crs/EPSG/0/32630");
    expect(req.aggregation).toMatchObject({ resx: 10, resy: 10, aggregationInterval: { of: "P1D" } });
    expect(req.aggregation.evalscript).toContain("[0,1,3,8,9,10,11]");
    expect(rows).toHaveLength(6);
    const ndvi = rows.find((r) => r.date === "2026-06-26" && r.index === "ndvi")!;
    expect(ndvi).toMatchObject({ mean: 0.79, p10: 0.6, p50: 0.7, p90: 0.8, validPx: 1100 });
    expect(rows.find((r) => r.date === "2026-06-28" && r.index === "ndvi")).toMatchObject({ mean: null, p90: null, validPx: 0 });
  });

  it("renouvelle le jeton une fois sur 401, réessaie sur 429, et compte l'usage", async () => {
    let tokens = 0;
    let n = 0;
    const usage: SentinelUsage[] = [];
    const slept: number[] = [];
    const { f } = fakeFetch((url) => {
      if (url.includes("openid-connect")) return tokenResponse(++tokens);
      n++;
      if (n === 1) return new Response("expired", { status: 401 });
      if (n === 2) return new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
      return json({ features: [{ properties: { datetime: "2026-06-26T11:05:00Z", "eo:cloud_cover": 40 } }, { properties: { datetime: "2026-06-26T11:05:30Z", "eo:cloud_cover": 3 } }, { properties: { datetime: "2026-06-23T11:00:00Z", "eo:cloud_cover": 90 } }] });
    });
    const c = new SentinelClient({ clientId: "a", clientSecret: "b" }, { fetch: f, onUsage: (u) => void usage.push(u), sleep: async (ms) => void slept.push(ms) });
    const acq = await c.acquisitions([-0.21, 43.33, -0.16, 43.4], "2026-06-20", "2026-06-30");
    expect(acq).toEqual([
      { date: "2026-06-23", cloudCover: 90 },
      { date: "2026-06-26", cloudCover: 3 },
    ]);
    expect(tokens).toBe(2);
    expect(slept).toEqual([2000]);
    expect(usage).toEqual([{ kind: "catalog", pu: 0, ok: true }]);
  });

  it("s'arrête avant la requête si le budget le refuse", async () => {
    const { f, calls } = fakeFetch(() => tokenResponse());
    const c = new SentinelClient({ clientId: "a", clientSecret: "b" }, {
      fetch: f,
      beforeRequest: () => {
        throw new Error("budget atteint");
      },
    });
    await expect(c.parcelStats(geom, "2026-06-01", "2026-06-02")).rejects.toThrow("budget atteint");
    expect(calls).toHaveLength(0);
  });

  it("attend quand le plafond de PU par minute est atteint", async () => {
    let t = 0;
    const slept: number[] = [];
    const { f } = fakeFetch((url) => (url.includes("openid-connect") ? tokenResponse() : json({ data: [] }, 150)));
    const c = new SentinelClient({ clientId: "a", clientSecret: "b" }, {
      fetch: f,
      puPerMinute: 200,
      now: () => t,
      sleep: async (ms) => {
        slept.push(ms);
        t += ms;
      },
    });
    await c.parcelStats(geom, "2026-06-01", "2026-06-02");
    await c.parcelStats(geom, "2026-06-01", "2026-06-02"); // 150 < 200 : passe
    await c.parcelStats(geom, "2026-06-01", "2026-06-02"); // 300 ≥ 200 : attend une minute
    expect(slept).toHaveLength(1);
    expect(slept[0]).toBeGreaterThanOrEqual(60_000);
  });

  it("rend un PNG sur l'emprise WGS84 d'une date", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { f, calls } = fakeFetch((url) => (url.includes("openid-connect") ? tokenResponse() : new Response(png, { headers: { "content-type": "image/png", "x-processingunits-spent": "0.7" } })));
    const c = new SentinelClient({ clientId: "a", clientSecret: "b" }, { fetch: f });
    const out = await c.render({ type: "MultiPolygon", coordinates: [] }, "2026-06-26", "ndvi", { width: 400, height: 300 });
    expect(Array.from(out.png)).toEqual(Array.from(png));
    expect(out.pu).toBe(0.7);
    const req = calls[1]!.body as Record<string, any>;
    expect(req.input.data[0].dataFilter.timeRange).toEqual({ from: "2026-06-26T00:00:00Z", to: "2026-06-26T23:59:59Z" });
    expect(req.output).toMatchObject({ width: 400, height: 300 });
    expect(req.evalscript).toContain("colorBlend");
  });
});

/** PNG gris 8 bits synthétique (filtres 0 « aucun » et 1 « sub » alternés). */
function grayPng(width: number, height: number, gray: number[]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = gray.slice(y * width, (y + 1) * width);
    if (y % 2 === 0) raw.push(0, ...row);
    else raw.push(1, ...row.map((v, x) => (v - (x > 0 ? row[x - 1]! : 0)) & 0xff));
  }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]));
}

describe("raster d'indice (lot AD)", () => {
  it("décode le PNG et demande une grille calée sur l'emprise", async () => {
    // 3 × 2 pixels : 0 = hors parcelle ou nuage ; 128 = indice 0 ; 255 = 1.
    const png = grayPng(3, 2, [0, 128, 255, 1, 64, 200]);
    expect([...decodeGrayPng(png).gray]).toEqual([0, 128, 255, 1, 64, 200]);
    const { f, calls } = fakeFetch((url) => (url.includes("openid-connect") ? tokenResponse() : new Response(png, { headers: { "content-type": "image/png", "x-processingunits-spent": "0.1" } })));
    const c = new SentinelClient({ clientId: "sh-id", clientSecret: "s" }, { fetch: f });
    const r = await c.indexRaster(geom, [700_000, 4_800_000, 700_030, 4_800_020], "2026-06-10", "ndvi");
    expect(r.width).toBe(3);
    expect(r.height).toBe(2);
    expect(r.values[0]).toBeNull();
    expect(r.values[1]).toBeCloseTo(0, 5);
    expect(r.values[2]).toBeCloseTo(1, 5);
    expect(r.values[3]).toBeCloseTo(-1, 5);
    const body = calls[1]!.body as { input: { bounds: { bbox: number[] } }; output: { width: number; height: number }; evalscript: string };
    expect(body.input.bounds.bbox).toEqual([700_000, 4_800_000, 700_030, 4_800_020]);
    expect(body.output).toMatchObject({ width: 3, height: 2 });
    expect(body.evalscript).toContain("nd(s.B08, s.B04)");
  });
});
