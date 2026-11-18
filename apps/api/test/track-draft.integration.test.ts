import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Parcours → intervention (lot P) : brouillon, rattachement à
 * l'enregistrement, ajout à une intervention existante, libération à
 * l'annulation et à la suppression. Un tracteur suivi, une charrue, Camille
 * (conductrice habituelle d'après une intervention du mois précédent).
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const tractor = crypto.randomUUID();
const other = crypto.randomUUID();
const plough = crypto.randomUUID();
const camille = crypto.randomUUID();
const parcelA = crypto.randomUUID();
const parcelB = crypto.randomUUID();
const binding = crypto.randomUUID();
const binding2 = crypto.randomUUID();
const [s1, s2, s3, s4, s5] = [0, 1, 2, 3, 4].map(() => crypto.randomUUID()) as [string, string, string, string, string];
const T = (hm: string) => `2026-10-05T${hm}:00.000Z`;
const square = (lon: number, lat: number, d: number) =>
  `MULTIPOLYGON(((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d * 0.7},${lon} ${lat + d * 0.7},${lon} ${lat})))`;

describe.skipIf(!url)("parcours → intervention (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let base = "";
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const session = (id: string, eq: string, b: string, kind: string, from: string, to: string, parcels: unknown[], cover: string | null, tool: string | null) =>
    sql`INSERT INTO track_sessions (id, farm_id, equipment_id, binding_id, kind, started_at, stopped_at, position_count, distance_m,
                                    covered_area_m2, coverage, parcels, tool_hint, tool_equipment_id, settings_hash)
        VALUES (${id}, ${farmId}, ${eq}, ${b}, ${kind}, ${T(from)}, ${T(to)}, 100, 2000,
                ${cover ? sql`ST_Area(ST_GeomFromText(${cover}, 4326)::geography)` : null},
                ${cover ? sql`ST_GeomFromText(${cover}, 4326)` : null}, ${sql.json(parcels as never)}, ${tool ? "Charrue X" : null}, ${tool}, 'h')`;
  const state = async (ids: string[]) =>
    (await sql<{ id: string; intervention_id: string | null; crew_id: string | null; linked: boolean }[]>`
      SELECT id, intervention_id, crew_id, linked_extent IS NOT NULL AS linked FROM track_sessions WHERE id IN ${sql(ids)}`);

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test parcours → intervention"));
    base = `/api/v1/farms/${farmId}`;
    for (const [id, name, lon] of [[parcelA, "La Plaine", 0.5], [parcelB, "Le Bas", 0.51]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${square(lon, 44.8, 0.0013)}, 4326), 10000, tstzrange('2024-01-01', NULL))`;
    }
    await sql`INSERT INTO equipments (id, farm_id, name, kind, external_ids) VALUES
      (${tractor}, ${farmId}, 'Tracteur suivi', 'tractor', '{}'), (${other}, ${farmId}, 'Autre tracteur', 'tractor', '{}'),
      (${plough}, ${farmId}, 'Charrue', 'trailed_equipment', '{"traccarTool": "Charrue X"}')`;
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${camille}, ${farmId}, 'Camille')`;
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid) VALUES
      (${binding}, ${farmId}, ${tractor}, 'pd1', tstzrange('2026-01-01', NULL)), (${binding2}, ${farmId}, ${other}, 'pd2', tstzrange('2026-01-01', NULL))`;
    // Habitude : un labour du mois précédent, Tracteur suivi + Charrue, Camille.
    const past = crypto.randomUUID();
    expect((await send("POST", "/interventions", { id: past, procedure: "plowing" })).status).toBe(201);
    const done = await send("POST", `/interventions/${past}/complete`, {
      periods: [{ startedAt: "2026-09-02T08:00:00Z", stoppedAt: "2026-09-02T10:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelA }],
      tools: [{ equipmentId: tractor }, { equipmentId: plough }],
      doers: [{ personId: camille }],
    });
    expect(done.status).toBe(200);
    const pA = (area: number, share: number) => [{ landParcelId: parcelA, name: "La Plaine", areaM2: area, share }];
    await session(s1, tractor, binding, "work", "08:00", "09:00", pA(4000, 0.4), square(0.5001, 44.8001, 0.0005), plough);
    await session(s2, tractor, binding, "work", "09:05", "10:00", pA(3000, 0.3), square(0.5006, 44.8001, 0.0005), plough);
    await session(s3, tractor, binding, "transit", "10:00", "10:20", [], null, null);
    await session(s4, other, binding2, "work", "08:00", "09:00", pA(1000, 0.1), square(0.5001, 44.8001, 0.0002), null);
    await session(s5, tractor, binding, "work", "14:00", "15:00", [{ landParcelId: parcelB, name: "Le Bas", areaM2: 2000, share: 0.2 }], square(0.5101, 44.8001, 0.0004), null);
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  let draft: { body: Record<string, unknown> & { crews: { tools: { equipmentId: string }[]; doers: unknown[]; periods: unknown[] }[]; targets: { id: string; workedAreaM2?: number; workingZone?: unknown }[] }; procedureSuggestions: string[]; hints: string[] };

  it("brouillon : attelage, périodes fusionnées, cible et zone, procédure suggérée", async () => {
    const res = await send("POST", "/track-sessions/draft", { sessionIds: [s2, s1, s3] });
    expect(res.status).toBe(200);
    draft = await res.json();
    expect(draft.body).toMatchObject({ staffing: "crews", trackSessionIds: [s1, s2, s3] });
    expect(draft.body.crews).toEqual([
      { tools: [{ equipmentId: tractor }, { equipmentId: plough }], doers: [{ personId: camille }], periods: [{ startedAt: T("08:00"), stoppedAt: T("10:20") }] },
    ]);
    expect(draft.body.targets).toHaveLength(1);
    const [target] = draft.body.targets;
    expect(target!.id).toBe(parcelA);
    // Union des deux couvertures découpée par la parcelle (deux carrés côte à côte, sans recouvrement).
    const [{ union }] = await sql<{ union: number }[]>`
      SELECT ST_Area(ST_Union(coverage)::geography)::float8 AS union FROM track_sessions WHERE id IN (${s1}, ${s2})`;
    expect(Math.abs(target!.workedAreaM2! - union)).toBeLessThan(2);
    expect(target!.workingZone).toMatchObject({ type: "MultiPolygon" });
    expect(draft.procedureSuggestions).toEqual(["plowing"]);
    expect(draft.hints).toEqual([]);
  });

  it("refus : plusieurs matériels (409), parcours inconnu (404), corps invalide (400)", async () => {
    expect((await send("POST", "/track-sessions/draft", { sessionIds: [s1, s4] })).status).toBe(409);
    expect((await send("POST", "/track-sessions/draft", { sessionIds: [crypto.randomUUID()] })).status).toBe(404);
    expect((await send("POST", "/track-sessions/draft", { sessionIds: [] })).status).toBe(400);
  });

  const iid = crypto.randomUUID();
  it("enregistrer le brouillon rattache les parcours à l'attelage ; la fiche les liste", async () => {
    expect((await send("POST", "/interventions", { id: iid, procedure: "plowing" })).status).toBe(201);
    const res = await send("POST", `/interventions/${iid}/complete`, draft.body);
    expect(res.status).toBe(200);
    const { intervention } = await res.json();
    expect(intervention.crews).toHaveLength(1);
    const rows = await state([s1, s2, s3]);
    expect(rows.every((r) => r.intervention_id === iid && r.linked && r.crew_id === intervention.crews[0].id)).toBe(true);
    const list = await (await send("GET", `/interventions/${iid}/track-sessions`)).json();
    expect(list.items.map((s: { id: string }) => s.id)).toEqual([s1, s2, s3]);
    expect(list.items[0].intervention).toMatchObject({ id: iid, status: "done" });
  });

  it("double rattachement : brouillon et enregistrement refusés (409)", async () => {
    expect((await send("POST", "/track-sessions/draft", { sessionIds: [s1] })).status).toBe(409);
    const other = crypto.randomUUID();
    await send("POST", "/interventions", { id: other, procedure: "plowing" });
    const res = await send("POST", `/interventions/${other}/complete`, { ...draft.body, trackSessionIds: [s1] });
    expect(res.status).toBe(409);
    expect((await state([s1]))[0]!.intervention_id).toBe(iid); // transaction annulée
  });

  it("modifier sans renvoyer la surface travaillée ne la perd pas : elle vient de la zone", async () => {
    const before = await (await send("GET", `/interventions/${iid}`)).json();
    const worked = before.targets[0].workedAreaM2 as number;
    const res = await send("PUT", `/interventions/${iid}`, {
      procedure: "plowing",
      staffing: "crews",
      crews: before.crews.map((c: Record<string, unknown>) => ({ id: c.id, tools: c.tools, doers: c.doers, periods: c.periods })),
      // Comme une modification qui ne renvoie que la zone (correction du 18/11) : pas de workedAreaM2.
      targets: before.targets.map((t: { kind: string; id: string; workingZone?: unknown }) => ({ kind: t.kind, id: t.id, workingZone: t.workingZone })),
    });
    expect(res.status).toBe(200);
    const after = await (await send("GET", `/interventions/${iid}`)).json();
    expect(Math.abs(after.targets[0].workedAreaM2 - worked)).toBeLessThan(2);
    // Lecture d'une ligne ancienne sans surface enregistrée : la zone suffit.
    await sql`UPDATE intervention_parameters SET attrs = NULL WHERE intervention_id = ${iid} AND role = 'target'`;
    const legacy = await (await send("GET", `/interventions/${iid}`)).json();
    expect(Math.abs(legacy.targets[0].workedAreaM2 - worked)).toBeLessThan(2);
  });

  it("modifier l'intervention ne détache pas ses parcours (attelage conservé)", async () => {
    const before = await (await send("GET", `/interventions/${iid}`)).json();
    const res = await send("PUT", `/interventions/${iid}`, {
      procedure: "plowing",
      staffing: "crews",
      crews: before.crews.map((c: Record<string, unknown>) => ({ id: c.id, tools: c.tools, doers: c.doers, periods: c.periods })),
      targets: before.targets,
      notes: "Terre humide",
    });
    expect(res.status).toBe(200);
    const rows = await state([s1, s2, s3]);
    expect(rows.every((r) => r.intervention_id === iid && r.crew_id === before.crews[0].id)).toBe(true);
  });

  it("ajouter un parcours à l'intervention : période et parcelle ajoutées, correction tracée", async () => {
    const res = await send("POST", `/interventions/${iid}/track-sessions`, { sessionIds: [s5] });
    expect(res.status).toBe(200);
    const { intervention } = await res.json();
    expect(intervention.crews[0].periods).toEqual([
      { startedAt: T("08:00"), stoppedAt: T("10:20") },
      { startedAt: T("14:00"), stoppedAt: T("15:00") },
    ]);
    expect(intervention.targets.map((t: { id: string }) => t.id).sort()).toEqual([parcelA, parcelB].sort());
    expect(intervention.notes).toBe("Terre humide");
    expect((await state([s5]))[0]).toMatchObject({ intervention_id: iid, crew_id: intervention.crews[0].id });
    const detail = await (await send("GET", `/interventions/${iid}`)).json();
    expect(detail.history.at(-1)).toMatchObject({ action: "corrected", reason: "Parcours GPS ajoutés" });
    expect((await send("POST", `/interventions/${iid}/track-sessions`, { sessionIds: [s5] })).status).toBe(409);
  });

  it("annuler libère les parcours ; supprimer une intervention aussi", async () => {
    expect((await send("POST", `/interventions/${iid}/cancel`, { reason: "erreur de saisie" })).status).toBe(200);
    expect((await state([s1, s2, s3, s5])).every((r) => !r.intervention_id && !r.crew_id && !r.linked)).toBe(true);
    // Suppression (base) : le déclencheur libère avant la clé étrangère.
    const gone = crypto.randomUUID();
    await send("POST", "/interventions", { id: gone, procedure: "plowing" });
    expect((await send("POST", `/interventions/${gone}/complete`, { ...draft.body, trackSessionIds: [s1] })).status).toBe(200);
    await sql`DELETE FROM interventions WHERE id = ${gone}`;
    expect((await state([s1]))[0]).toMatchObject({ intervention_id: null, linked: false });
  });
});
