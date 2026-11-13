import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { createDb } from "@fourmy/db";
import { geocodeConfig, geocodeDeps, resetGeocode } from "../src/geocode.js";
import { sprayingForecast } from "../src/repos/weather.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * « Ma ferme », lot F1 : fiche, droits, compatibilité de /settings/identity,
 * certificats, sites (siège indestructible, parcelles hors zone),
 * géocodage relayé (succès, panne, limite de débit) sans appel réseau.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const square = (lon: number, lat: number, d = 0.002) =>
  `SRID=4326;MULTIPOLYGON(((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat})))`;
const emptyAddress = { line1: null, line2: null, postalCode: null, city: null, inseeCode: null };

const IGN_FEATURE = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-0.578803, 44.838168] },
  properties: { label: "1 Place Pey Berland 33000 Bordeaux", score: 0.977, name: "1 Place Pey Berland", postcode: "33000", citycode: "33063", city: "Bordeaux", type: "housenumber" },
};

describe.skipIf(!url)("Ma ferme (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let worker: { userId: string; headers: Record<string, string> };
  const base = () => `/api/v1/farms/${farmId}`;
  const get = async (headers = owner.headers) => (await app.request(`${base()}/farm`, { headers })).json();
  const send = (method: string, path: string, body: unknown, headers = owner.headers) => app.request(`${base()}${path}`, { method, headers, body: JSON.stringify(body) });
  const realFetch = geocodeDeps.fetch;

  beforeAll(async () => {
    ({ farmId, ...owner } = await setupFarm(sql, "Ferme fiche"));
    worker = await addMember(sql, farmId, "worker");
  });
  afterEach(() => {
    geocodeDeps.fetch = realFetch;
    resetGeocode();
  });
  afterAll(async () => {
    await teardown(sql, farmId, [owner.userId, worker.userId]);
    await sql.end();
  });

  it("toute ferme a son siège, sans point, et la fiche le montre", async () => {
    const p = await get();
    expect(p.canEdit).toBe(true);
    expect(p.identity).toMatchObject({ name: "Ferme fiche", siret: null, legalRep: null });
    expect(p.sites).toEqual([expect.objectContaining({ name: "Siège", isHeadquarters: true, location: null, radiusM: 10000 })]);
    expect(p.parcelsOutside).toBeNull();
  });

  it("le salarié lit la fiche sans pouvoir la modifier", async () => {
    const p = await get(worker.headers);
    expect(p.canEdit).toBe(false);
    expect((await send("PUT", "/farm/identity", { ...p.identity, name: "Autre" }, worker.headers)).status).toBe(403);
    expect((await app.request(`${base()}/geocode?q=bordeaux`, { headers: worker.headers })).status).toBe(403);
  });

  it("enregistre l'identité, refuse un SIRET faux, et reste compatible avec /settings/identity", async () => {
    const identity = (await get()).identity;
    const bad = await send("PUT", "/farm/identity", { ...identity, siret: "73282932000075" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).detail).toMatch(/clé de contrôle/);

    const people = await sql<{ id: string }[]>`INSERT INTO people (id, farm_id, name, active) VALUES (${crypto.randomUUID()}, ${farmId}, 'Jeanne', true) RETURNING id`;
    const ok = await send("PUT", "/farm/identity", {
      ...identity,
      legalName: "GAEC du Pré",
      legalForm: "gaec",
      siret: "732 829 320 00074",
      vatNumber: "FR83404833048",
      pacage: "033123456",
      legalRep: { personId: people[0]!.id },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ siret: "73282932000074", legalForm: "gaec", legalRep: { personId: people[0]!.id } });
    // Le registre phyto lit les mêmes colonnes.
    expect(await (await app.request(`${base()}/settings/identity`, { headers: owner.headers })).json()).toEqual({ siret: "73282932000074", pacage: "033123456" });
    const [log] = await sql`SELECT action FROM audit_log WHERE farm_id = ${farmId} AND entity = 'farm' ORDER BY at DESC LIMIT 1`;
    expect(log?.action).toBe("update_identity");
  });

  it("refuse un responsable légal pris dans une autre ferme", async () => {
    const other = await setupFarm(sql, "Autre ferme");
    try {
      const [p] = await sql<{ id: string }[]>`INSERT INTO people (id, farm_id, name, active) VALUES (${crypto.randomUUID()}, ${other.farmId}, 'Étranger', true) RETURNING id`;
      const res = await send("PUT", "/farm/identity", { ...(await get()).identity, legalRep: { personId: p!.id } });
      expect(res.status).toBe(400);
    } finally {
      await teardown(sql, other.farmId, [other.userId]);
    }
  });

  it("gère les certificats de l'exploitation", async () => {
    const created = await send("POST", "/farm/certifications", { kind: "organic", body: "Ecocert", number: "FR-BIO-01/123", level: null, expiresOn: "2026-12-31" });
    expect(created.status).toBe(201);
    const cert = await created.json();
    expect((await send("PUT", `/farm/certifications/${cert.id}`, { kind: "organic", body: "Ecocert", number: "FR-BIO-01/123", level: "2", expiresOn: null })).status).toBe(400);
    expect((await send("PUT", `/farm/certifications/${cert.id}`, { kind: "hve", body: null, number: null, level: "3", expiresOn: "2027-06-30" })).status).toBe(200);
    expect((await get()).certifications).toEqual([{ id: cert.id, kind: "hve", body: null, number: null, level: "3", expiresOn: "2027-06-30" }]);
    expect((await app.request(`${base()}/farm/certifications/${cert.id}`, { method: "DELETE", headers: owner.headers })).status).toBe(204);
    expect((await get()).certifications).toEqual([]);
  });

  it("place le siège, ajoute un site, signale les parcelles hors zone et protège le siège", async () => {
    // Une parcelle près de Bordeaux, une autre à une trentaine de kilomètres.
    for (const [name, lon, lat] of [["Près", -0.57, 44.84], ["Loin", -0.2, 44.95]] as const) {
      const id = crypto.randomUUID();
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
                VALUES (${crypto.randomUUID()}, ${id}, ${square(lon, lat)}::geometry, 30000, tstzrange('2020-01-01', NULL))`;
    }
    const hq = (await get()).sites[0];
    const placed = await send("PUT", `/farm/sites/${hq.id}`, {
      name: "Siège",
      address: { line1: "1 Place Pey Berland", line2: null, postalCode: "33000", city: "Bordeaux", inseeCode: "33063" },
      location: { lat: 44.838168, lon: -0.578803 },
      locationSource: "geocoded",
      geocode: { score: 0.977, type: "housenumber" },
      radiusM: 10000,
    });
    expect(placed.status).toBe(200);
    expect((await get()).parcelsOutside).toBe(1);

    const second = await send("POST", "/farm/sites", { name: "Corps de ferme Est", address: emptyAddress, location: { lat: 44.95, lon: -0.2 }, locationSource: "manual", geocode: null, radiusM: 5000 });
    expect(second.status).toBe(201);
    const site = await second.json();
    const p = await get();
    expect(p.parcelsOutside).toBe(0);
    expect(p.sites.map((s: { name: string }) => s.name)).toEqual(["Siège", "Corps de ferme Est"]);

    expect((await send("POST", "/farm/sites", { name: "Trop loin", address: emptyAddress, location: null, locationSource: null, geocode: null, radiusM: 40000 })).status).toBe(400);
    const hqDelete = await app.request(`${base()}/farm/sites/${hq.id}`, { method: "DELETE", headers: owner.headers });
    expect(hqDelete.status).toBe(409);
    expect((await app.request(`${base()}/farm/sites/${site.id}`, { method: "DELETE", headers: owner.headers })).status).toBe(204);
    expect((await get()).parcelsOutside).toBe(1);
  });

  it("enregistre les préférences d'affichage (F2), réservées au responsable", async () => {
    expect((await get()).display).toEqual({ basemap: "ortho", areaUnit: "ha" });
    expect((await send("PUT", "/settings/display", { basemap: "plan", areaUnit: "a" }, worker.headers)).status).toBe(403);
    expect((await send("PUT", "/settings/display", { basemap: "satellite", areaUnit: "a" })).status).toBe(400);
    const ok = await send("PUT", "/settings/display", { basemap: "plan", areaUnit: "a" });
    expect(await ok.json()).toEqual({ basemap: "plan", areaUnit: "a" });
    expect((await get(worker.headers)).display).toEqual({ basemap: "plan", areaUnit: "a" });
  });

  it("prend le siège comme point météo d'une ferme sans parcelle (E11)", async () => {
    const empty = await setupFarm(sql, "Ferme sans parcelle");
    const db = createDb(url);
    const asked: string[] = [];
    const fakeFetch = (async (input: string | URL) => {
      const u = new URL(String(input));
      asked.push(`${u.searchParams.get("latitude")},${u.searchParams.get("longitude")}`);
      const from = new Date(`${u.searchParams.get("start_date")}T00:00:00Z`).getTime();
      const to = new Date(`${u.searchParams.get("end_date")}T23:00:00Z`).getTime();
      const time: string[] = [];
      for (let t = from; t <= to; t += 3_600_000) time.push(new Date(t).toISOString().slice(0, 16));
      const v = (x: number) => time.map(() => x);
      return Response.json({ hourly: { time, temperature_2m: v(15), relative_humidity_2m: v(80), wind_speed_10m: v(5), wind_gusts_10m: v(10), precipitation: v(0) } });
    }) as typeof fetch;
    try {
      expect(await sprayingForecast(db, empty.farmId, 1, fakeFetch)).toBeNull();
      await sql`UPDATE farm_sites SET location = ST_SetSRID(ST_MakePoint(-0.5788, 44.8382), 4326), location_source = 'manual' WHERE farm_id = ${empty.farmId}`;
      expect(await sprayingForecast(db, empty.farmId, 1, fakeFetch)).not.toBeNull();
      expect(asked[0]).toMatch(/^44\.838\d*,-0\.578\d*$/);
    } finally {
      await teardown(sql, empty.farmId, [empty.userId]);
    }
  });

  it("relaie le géocodage de l'IGN et le met en cache", async () => {
    const calls: string[] = [];
    geocodeDeps.fetch = async (input) => {
      calls.push(input);
      return new Response(JSON.stringify({ type: "FeatureCollection", features: [IGN_FEATURE, { properties: { type: "inconnu" } }] }));
    };
    const res = await app.request(`${base()}/geocode?q=1+place+pey+berland`, { headers: owner.headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { label: IGN_FEATURE.properties.label, line1: "1 Place Pey Berland", postalCode: "33000", city: "Bordeaux", inseeCode: "33063", location: { lat: 44.838168, lon: -0.578803 }, score: 0.977, type: "housenumber" },
    ]);
    // Même recherche, casse et espaces différents : servie par le cache.
    await app.request(`${base()}/geocode?q=1%20Place%20%20Pey%20Berland`, { headers: owner.headers });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("data.geopf.fr/geocodage/search?q=1%20place%20pey%20berland");
    // Moins de 3 caractères : pas d'appel.
    expect(await (await app.request(`${base()}/geocode?q=ab`, { headers: owner.headers })).json()).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("répond 503 si l'IGN est en panne, 429 au-delà de la limite de débit", async () => {
    geocodeDeps.fetch = async () => new Response("", { status: 502 });
    const down = await app.request(`${base()}/geocode/reverse?lat=44.8&lon=-0.5`, { headers: owner.headers });
    expect(down.status).toBe(503);
    expect((await down.json()).detail).toMatch(/Placez le point/);

    geocodeDeps.fetch = async () => new Response(JSON.stringify({ features: [] }));
    resetGeocode(); // la requête ci-dessus compte dans la seconde en cours
    const statuses: number[] = [];
    for (let i = 0; i <= geocodeConfig.perUserPerSecond; i++) statuses.push((await app.request(`${base()}/geocode?q=rue+${i}+test`, { headers: owner.headers })).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
  });
});
