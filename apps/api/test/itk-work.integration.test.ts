import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { osrmTable } from "../src/repos/itk-work.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Temps de travaux (lot IT4) : contexte (matériels, proposition du barème,
 * débits observés, trajets estimés sans OSRM puis en cache), recherche dans
 * le barème, rattachement d'un matériel.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SQUARE = (x: number) => `MULTIPOLYGON(((${x} 44.8,${x + 0.01} 44.8,${x + 0.01} 44.809,${x} 44.809,${x} 44.8)))`;

const tractor = crypto.randomUUID();
const plough = crypto.randomUUID();
const parcel = crypto.randomUUID();
let site = "";
let siteName = "";

describe.skipIf(!url)("temps de travaux (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test temps de travaux");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${tractor}, ${farmId}, 'Arion 630', 'tractor'), (${plough}, ${farmId}, 'Charrue 5 corps 2.5m', 'trailed_equipment')`;
    await sql`UPDATE equipments SET equipment_type = 'plough' WHERE id = ${plough}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Le Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText(${SQUARE(0.5)}, 4326), 100000, tstzrange('2020-01-01', NULL))`;
    // Le siège créé avec la ferme, localisé.
    const [hq] = await sql`UPDATE farm_sites SET location = ST_SetSRID(ST_MakePoint(0.48, 44.8), 4326), location_source = 'manual', geocode_score = NULL, geocode_type = NULL
                           WHERE farm_id = ${farmId} AND is_headquarters RETURNING id, name`;
    site = hq!.id;
    siteName = hq!.name;
    // Trois labours à l'heure près de 4 h sur 10 ha : 2,5 ha/h observés pour la charrue et le tracteur.
    for (const day of ["2025-10-01", "2025-10-03", "2025-10-06"]) {
      const id = crypto.randomUUID();
      await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${id}, ${farmId}, 'plowing', 'done', 'web', ${`${day}T06:00:00Z`}, ${`${day}T10:00:00Z`})`;
      await sql`INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at) VALUES (${crypto.randomUUID()}, ${id}, ${`${day}T06:00:00Z`}, ${`${day}T10:00:00Z`})`;
      await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${id}, 'target', 'land_parcel', ${parcel}),
        (${crypto.randomUUID()}, ${id}, 'tool', 'equipment', ${tractor}), (${crypto.randomUUID()}, ${id}, 'tool', 'equipment', ${plough})`;
    }
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  it("contexte : matériels, proposition du barème, débits observés, trajet estimé puis en cache", async () => {
    const c = await (await send(worker, "GET", "/crop-plans/2026/itk-context")).json();
    const p = c.equipments.find((e: { id: string }) => e.id === plough);
    expect(p).toMatchObject({ widthM: 2.5, carrier: false, machineryRateId: null });
    expect(c.machineryRates[p.suggestedRateId].family).toBe("Travail du sol profond ou semi-profond");
    expect(c.equipments.find((e: { id: string }) => e.id === tractor)).toMatchObject({ carrier: true, suggestedRateId: null });
    expect(c.observed).toEqual(expect.arrayContaining([{ procedure: "plowing", equipmentId: plough, haH: 2.5, samples: 3 }]));
    expect(c.site).toEqual({ id: site, name: siteName });
    const route = c.routes[`p:${parcel}`];
    expect(route.method).toBe("estimate");
    expect(route.distanceM).toBeGreaterThan(1500);
    expect(c.settings).toEqual({ workdayHours: 8, weeklyHoursPerPerson: 45, defaultSiteId: null });
    expect(c.familyPerMeter.plowing).toBeGreaterThan(0);
    expect(c.rateSource).toMatch(/BCMA/);
    const [cached] = await sql`SELECT method FROM parcel_routes WHERE farm_id = ${farmId} AND parcel_key = ${parcel}`;
    expect(cached!.method).toBe("estimate");
  });

  it("barème : recherche par procédure ; rattachement par le responsable seulement", async () => {
    const found = await (await send(worker, "GET", "/machinery-rates?procedure=plowing&q=charrue%205%20corps")).json();
    expect(found.items.length).toBeGreaterThan(0);
    expect(found.items.every((r: { family: string }) => r.family === "Travail du sol profond ou semi-profond")).toBe(true);
    const id = found.items[0].id;
    expect((await send(worker, "PUT", `/equipments/${plough}/machinery-rate`, { machineryRateId: id })).status).toBe(403);
    expect((await send(owner, "PUT", `/equipments/${plough}/machinery-rate`, { machineryRateId: "inconnue" })).status).toBe(400);
    const res = await send(owner, "PUT", `/equipments/${plough}/machinery-rate`, { machineryRateId: id });
    expect(await res.json()).toMatchObject({ machineryRateId: id, rate: { id } });
    const list = await (await send(worker, "GET", "/equipments-rates")).json();
    expect(list.items.find((e: { id: string }) => e.id === plough).rate.id).toBe(id);
  });

  it("OSRM : service table, morceaux de 90 points, échec → null", async () => {
    const calls: string[] = [];
    const fake = (async (u: string) => {
      calls.push(u);
      const n = u.split("?")[0]!.split("/").at(-1)!.split(";").length;
      return new Response(JSON.stringify({ code: "Ok", durations: [Array.from({ length: n }, (_, i) => i * 60)], distances: [Array.from({ length: n }, (_, i) => i * 1000)] }));
    }) as typeof fetch;
    const points = Array.from({ length: 95 }, (_, i) => [0.5 + i / 1000, 44.8] as [number, number]);
    const r = await osrmTable([0.48, 44.8], points, "http://osrm", fake);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/table/v1/driving/0.480000,44.800000;");
    expect(r![0]).toEqual({ durationS: 60, distanceM: 1000 });
    expect(r![90]).toEqual({ durationS: 60, distanceM: 1000 });
    expect(await osrmTable([0, 0], points, "http://osrm", (async () => new Response("", { status: 500 })) as typeof fetch)).toBeNull();
  });
});
