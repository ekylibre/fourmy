import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { ParcelFertilizationContext, WaterSource } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { setCommuneLookup } from "../src/repos/fertilization-context.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Contexte de la fertilisation (lot AF) : zonage d'après la commune (API Carto
 * simulée), fiche sol régionale, analyses de sol, points d'eau, droits. La
 * réserve utile du modèle de croissance (lot AB) reste indépendante.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const SHAPE = (x: number) => `MULTIPOLYGON(((${x} 43.38,${x + 0.003} 43.38,${x + 0.003} 43.382,${x} 43.382,${x} 43.38)))`;

describe.skipIf(!url)("contexte de la fertilisation (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const inZv = crypto.randomUUID();
  const elsewhere = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker = { userId: "", headers: {} as Record<string, string> };
  const base = () => `/api/v1/farms/${farmId}`;
  const ctx = async (id: string, h = headers) => (await (await app.request(`${base()}/land-parcels/${id}/fertilization`, { headers: h })).json()) as ParcelFertilizationContext;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test fertilisation"));
    worker = await addMember(sql, farmId, "worker");
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${inZv}, ${farmId}, 'Béarn'), (${elsewhere}, ${farmId}, 'Ailleurs')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES
      (${crypto.randomUUID()}, ${inZv}, ST_GeomFromText(${SHAPE(-0.2)}, 4326), 60000, tstzrange('2026-01-01', NULL)),
      (${crypto.randomUUID()}, ${elsewhere}, ST_GeomFromText(${SHAPE(5)}, 4326), 20000, tstzrange('2026-01-01', NULL))`;
    // Commune simulée : Monassut-Audiracq pour le Béarn, aucune pour l'autre.
    setCommuneLookup(async (lon) => (lon < 1 ? { insee: "64389", name: "Monassut-Audiracq" } : null));
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  it("zonage d'après la commune ; réservé au responsable ; une parcelle sans commune est signalée", async () => {
    expect((await app.request(`${base()}/fertilization/zones/refresh`, { method: "POST", headers: worker.headers })).status).toBe(403);
    const r = (await (await app.request(`${base()}/fertilization/zones/refresh`, { method: "POST", headers })).json()) as { updated: number; failed: string[] };
    expect(r).toEqual({ updated: 1, failed: ["Ailleurs"] });
    const c = await ctx(inZv, worker.headers);
    expect(c.zone).toMatchObject({ status: "in", insee: "64389", commune: "Monassut-Audiracq", confirmedAt: null });
    expect(c.zone!.referential).toContain("Adour-Garonne");
    expect((await ctx(elsewhere)).zone).toBeNull();

    // Confirmation à la main : elle n'est plus recalculée.
    const confirmed = (await (await app.request(`${base()}/land-parcels/${elsewhere}/nitrate-zone`, { method: "PUT", headers, body: JSON.stringify({ status: "out", note: "Hors bassin" }) })).json()) as ParcelFertilizationContext;
    expect(confirmed.zone).toMatchObject({ status: "out", note: "Hors bassin" });
    expect(confirmed.zone!.confirmedAt).not.toBeNull();
    await app.request(`${base()}/fertilization/zones/refresh`, { method: "POST", headers });
    expect((await ctx(elsewhere)).zone).toMatchObject({ status: "out" });
  });

  it("fiche sol : type régional et point d'eau, sans toucher à la réserve utile du modèle", async () => {
    const created = await app.request(`${base()}/water-sources`, { method: "POST", headers, body: JSON.stringify({ name: "Forage", origin: "groundwater", nitrateMgL: 18, measuredOn: "2026-07-01", method: "strip" }) });
    expect(created.status).toBe(201);
    const water = (await created.json()) as WaterSource;
    expect((await app.request(`${base()}/water-sources`, { method: "POST", headers, body: JSON.stringify({ name: "X", origin: "surface", nitrateMgL: 10 }) })).status).toBe(400);

    // Réserve utile et irrigation saisies au lot AB.
    await app.request(`${base()}/land-parcels/${inZv}/soil`, { method: "PUT", headers, body: JSON.stringify({ tawMm: 140, irrigated: true }) });
    const put = (body: object, h = headers) => app.request(`${base()}/land-parcels/${inZv}/soil-profile`, { method: "PUT", headers: h, body: JSON.stringify(body) });
    expect((await put({ soilType: "limoneux", rootingDepthCm: 90, waterSourceId: water.id }, worker.headers)).status).toBe(403);
    expect((await put({ soilType: "terre_inconnue" })).status).toBe(400);
    const c = (await (await put({ soilType: "limoneux", rootingDepthCm: 90, waterSourceId: water.id })).json()) as ParcelFertilizationContext;
    expect(c.soil).toEqual({ soilType: "limoneux", soilTypeRegion: "nouvelle-aquitaine", rootingDepthCm: 90, waterSourceId: water.id, tawMm: 140, irrigated: true });

    // « Revenir aux valeurs par défaut » du modèle garde le type de sol.
    await app.request(`${base()}/land-parcels/${inZv}/soil`, { method: "DELETE", headers });
    expect((await ctx(inZv)).soil).toMatchObject({ soilType: "limoneux", tawMm: null, irrigated: false });

    const list = (await (await app.request(`${base()}/water-sources`, { headers: worker.headers })).json()) as { items: WaterSource[] };
    expect(list.items).toEqual([expect.objectContaining({ name: "Forage", nitrateMgL: 18, method: "strip", parcels: 1 })]);
  });

  it("analyses : reliquat par horizons, analyse de terre ; horizon incohérent refusé", async () => {
    const post = (body: object) => app.request(`${base()}/land-parcels/${inZv}/soil-analyses`, { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post({ sampledOn: "2026-02-10", kind: "rsh", horizons: [] })).status).toBe(400);
    expect((await post({ sampledOn: "2026-02-10", kind: "rsh", horizons: [{ fromCm: 30, toCm: 0, no3KgHa: 10 }] })).status).toBe(400);
    const res = await post({
      sampledOn: "2026-02-10",
      kind: "rsh",
      horizons: [
        { fromCm: 0, toCm: 30, no3KgHa: 20, nh4KgHa: 9 },
        { fromCm: 30, toCm: 60, no3KgHa: 15, nh4KgHa: 6 },
        { fromCm: 60, toCm: 90, no3KgHa: 10, nh4KgHa: 3 },
      ],
      lab: "Labo",
    });
    expect(res.status).toBe(201);
    await post({ sampledOn: "2025-10-01", kind: "soil", values: { organicMatterPct: 2.1, clayGKg: 220, caco3GKg: 5, ph: 6.4 } });
    const c = await ctx(inZv);
    expect(c.analyses.map((a) => a.kind)).toEqual(["rsh", "soil"]);
    expect(c.analyses[1]!.values).toMatchObject({ organicMatterPct: 2.1, clayGKg: 220, ph: 6.4 });

    const all = (await (await app.request(`${base()}/fertilization/parcels?at=2026-06-01`, { headers: worker.headers })).json()) as { items: ParcelFertilizationContext[] };
    expect(all.items.map((p) => p.name)).toEqual(["Ailleurs", "Béarn"]);
    expect(all.items[1]!.analyses).toHaveLength(2);

    const removed = (await (await app.request(`${base()}/land-parcels/${inZv}/soil-analyses/${c.analyses[1]!.id}`, { method: "DELETE", headers })).json()) as ParcelFertilizationContext;
    expect(removed.analyses).toHaveLength(1);
  });
});
