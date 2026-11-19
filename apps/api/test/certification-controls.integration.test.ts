import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Contrôles HVE et AB, lot CT1 : menu selon les certifications de la
 * campagne, rapport gardé tant que les données ne changent pas, réglages.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const parcelId = crypto.randomUUID();

describe.skipIf(!url)("contrôles HVE et AB (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let users: string[] = [];
  let headers: Record<string, string> = {};
  let worker: Record<string, string> = {};

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test contrôles");
    farmId = owner.farmId;
    headers = owner.headers;
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users = [owner.userId, w.userId];
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Le Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10000, tstzrange('2020-01-01', NULL))`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown, h = headers) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (method: string, path: string, body?: unknown) => {
    const res = await send(method, path, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };

  it("menu : contrôle disponible seulement pendant les campagnes certifiées", async () => {
    expect(await json("GET", "/control/availability?campaign=2025")).toEqual({ hve: false, ab: false });
    const created = await send("POST", `/land-parcels/${parcelId}/certifications`, { kind: "organic", level: "conversion", startedOn: "2025-03-01", stoppedOn: "2026-06-30" });
    expect(created.status).toBe(201);
    expect(await json("GET", "/control/availability?campaign=2024")).toEqual({ hve: false, ab: false });
    expect(await json("GET", "/control/availability?campaign=2025")).toEqual({ hve: false, ab: true });
    expect(await json("GET", "/control/availability?campaign=2026")).toEqual({ hve: false, ab: true });
    expect(await json("GET", "/control/availability?campaign=2027")).toEqual({ hve: false, ab: false });
    expect((await send("GET", "/control/availability?campaign=abc")).status).toBe(400);
  });

  it("rapport : périmètre, calcul gardé tant que rien ne change", async () => {
    const r1 = await json("GET", "/control/ab?campaign=2025");
    expect(r1).toMatchObject({ kind: "ab", campaign: 2025, period: { from: "2025-01-01", to: "2025-12-31" }, verdict: "ok", exportedAt: null, changedSinceExport: false });
    expect(r1.sections[0].findings[0]).toMatchObject({ ruleId: "ab.perimeter", level: "ok", value: 1, refs: { parcelIds: [parcelId] } });
    const r2 = await json("GET", "/control/ab?campaign=2025");
    expect(r2.computedAt).toBe(r1.computedAt);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM certification_runs WHERE farm_id = ${farmId}`;
    expect(n).toBe(1);
    // Nouvelle certification : nouveau calcul.
    await send("POST", `/land-parcels/${parcelId}/certifications`, { kind: "hve", level: "3", startedOn: "2025-01-01" });
    expect((await json("GET", "/control/ab?campaign=2025")).computedAt).not.toBe(r1.computedAt);
    expect((await send("GET", "/control/xyz")).status).toBe(400);
  });

  it("réglages : lecture par défaut, écriture par le responsable, période HVE décalée", async () => {
    expect(await json("GET", "/settings/certification")).toMatchObject({ hveCampaignStartMd: "01-01", rotationYears: 5, rotationSameSpeciesMax: 2 });
    const write = { hveCampaignStartMd: "07-01", rotationYears: 4 };
    expect((await send("PUT", "/settings/certification", write, worker)).status).toBe(403);
    expect((await send("PUT", "/settings/certification", { ...write, hveCampaignStartMd: "13-01" })).status).toBe(400);
    expect(await json("PUT", "/settings/certification", write)).toMatchObject({ hveCampaignStartMd: "07-01", rotationYears: 4 });
    expect((await json("GET", "/control/hve?campaign=2026")).period).toEqual({ from: "2025-07-01", to: "2026-06-30" });
  });

  it("saisie : pas de constat hors certification", async () => {
    const body = { procedure: "sowing", plannedAt: "2024-04-01T08:00:00Z", targets: [{ kind: "land_parcel", id: parcelId }], inputs: [] };
    expect(await json("POST", "/control/check", body)).toEqual({ check: null });
  });
});
