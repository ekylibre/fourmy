import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Attelages dans l'intervention (lot N3) : un chantier de déchaumage avec
 * deux tracteurs en même temps. Attelage 1 : Tracteur A + Déchaumeur, Camille,
 * 8 h-10 h puis 11 h-12 h. Attelage 2 : Tracteur B + Herse, sans conducteur
 * connu, 9 h-12 h. Chantier de 4 h, 6 h de travail.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const tractorA = crypto.randomUUID();
const tractorB = crypto.randomUUID();
const stubble = crypto.randomUUID();
const harrow = crypto.randomUUID();
const camille = crypto.randomUUID();
const parcel = crypto.randomUUID();
const crew1 = crypto.randomUUID();
const crew2 = crypto.randomUUID();

const P = (from: string, to: string) => ({ startedAt: `2026-09-15T${from}:00.000Z`, stoppedAt: `2026-09-15T${to}:00.000Z` });
const crews = () => [
  { id: crew1, label: "Déchaumage", tools: [{ equipmentId: tractorA }, { equipmentId: stubble }], doers: [{ personId: camille }], periods: [P("08:00", "10:00"), P("11:00", "12:00")] },
  { id: crew2, tools: [{ equipmentId: tractorB }, { equipmentId: harrow }], periods: [P("09:00", "12:00")] },
];

describe.skipIf(!url)("attelages (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let base = "";
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test attelages"));
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Grand champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcel},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10000, tstzrange('2024-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES
      (${tractorA}, ${farmId}, 'Tracteur A', 'tractor'), (${tractorB}, ${farmId}, 'Tracteur B', 'tractor'),
      (${stubble}, ${farmId}, 'Déchaumeur', 'trailed_equipment'), (${harrow}, ${farmId}, 'Herse', 'trailed_equipment')`;
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${camille}, ${farmId}, 'Camille')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  const id = crypto.randomUUID();

  it("planifier en attelages, relire : détail, forme aplatie, durées", async () => {
    const res = await send("POST", "/interventions", { id, procedure: "plowing", staffing: "crews", crews: crews(), targets: [{ kind: "land_parcel", id: parcel }] });
    expect(res.status).toBe(201);
    const i = await res.json();
    expect(i.staffing).toBe("crews");
    expect(i.crews).toHaveLength(2);
    expect(i.crews[0]).toMatchObject({ id: crew1, rank: 0, label: "Déchaumage", doers: [{ personId: camille }] });
    expect(i.crews[0].tools.map((t: { equipmentId: string }) => t.equipmentId).sort()).toEqual([tractorA, stubble].sort());
    expect(i.crews[1]).toMatchObject({ id: crew2, label: null, doers: [], periods: [P("09:00", "12:00")] });
    // Anciens clients : réunion des matériels et intervenants, périodes fusionnées.
    expect(i.tools).toHaveLength(4);
    expect(i.doers).toEqual([{ personId: camille }]);
    expect(i.periods).toEqual([P("08:00", "12:00")]);
    expect(i).toMatchObject({ startedAt: P("08:00", "12:00").startedAt, stoppedAt: P("08:00", "12:00").stoppedAt, spanS: 4 * 3600, workDurationS: 6 * 3600 });
    const list = await (await send("GET", "/interventions?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z")).json();
    expect(list.items.find((x: { id: string }) => x.id === id).crews).toHaveLength(2);
  });

  it("règles : même matériel dans deux attelages simultanés refusé, avec son nom", async () => {
    const bad = crews();
    bad[1]!.tools.push({ equipmentId: stubble });
    const res = await send("POST", "/interventions", { procedure: "plowing", staffing: "crews", crews: bad });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toMatch(/Déchaumeur/);
  });

  it("réaliser en attelages ; avertissement si un matériel travaille ailleurs au même moment", async () => {
    // Autre intervention réalisée, mode libre : la Herse de 11 h à 13 h.
    const other = crypto.randomUUID();
    await send("POST", "/interventions", { id: other, procedure: "harrowing" });
    expect(
      (await send("POST", `/interventions/${other}/complete`, { periods: [P("11:00", "13:00")], tools: [{ equipmentId: harrow }], targets: [{ kind: "land_parcel", id: parcel }] })).status,
    ).toBe(200);
    const res = await send("POST", `/interventions/${id}/complete`, { staffing: "crews", crews: crews(), targets: [{ kind: "land_parcel", id: parcel }] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intervention).toMatchObject({ status: "done", staffing: "crews" });
    expect(body.warnings.join(" ")).toMatch(/Herse travaille aussi dans une autre intervention/);
    expect(body.warnings.join(" ")).not.toMatch(/Tracteur A/);
  });

  it("rejeu 3D : outils du même attelage, sur ses périodes", async () => {
    const q = (eq: string) => send("GET", `/tracks/hitches?equipment=${eq}&from=2026-09-15T00:00:00Z&to=2026-09-16T00:00:00Z`);
    const a = (await (await q(tractorA)).json()).items as { toolId: string; from: string }[];
    expect(new Set(a.map((h) => h.toolId))).toEqual(new Set([stubble]));
    expect(a.map((h) => h.from).sort()).toEqual([P("08:00", "10:00").startedAt, P("11:00", "12:00").startedAt]);
    const b = (await (await q(tractorB)).json()).items as { toolId: string }[];
    expect(new Set(b.map((h) => h.toolId))).toEqual(new Set([harrow]));
  });

  it("corriger : ids d'attelage conservés, parcours rattaché gardé, historique des attelages", async () => {
    // Un parcours GPS rattaché à l'attelage 2.
    const binding = crypto.randomUUID();
    const session = crypto.randomUUID();
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid) VALUES (${binding}, ${farmId}, ${tractorB}, 'b', tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO track_sessions (id, farm_id, equipment_id, binding_id, kind, started_at, stopped_at, position_count, distance_m,
                                          settings_hash, intervention_id, crew_id, linked_extent)
              VALUES (${session}, ${farmId}, ${tractorB}, ${binding}, 'work', ${P("09:00", "12:00").startedAt}, ${P("09:00", "12:00").stoppedAt},
                      100, 5000, 'h', ${id}, ${crew2}, tstzrange(${P("09:00", "12:00").startedAt}, ${P("09:00", "12:00").stoppedAt}))`;
    const next = crews();
    next[1]!.doers = [{ personId: camille }];
    next[0]!.doers = [];
    const res = await send("PUT", `/interventions/${id}`, { procedure: "plowing", staffing: "crews", crews: next, targets: [{ kind: "land_parcel", id: parcel }], reason: "conducteur" });
    expect(res.status).toBe(200);
    const i = (await res.json()).intervention;
    expect(i.crews.map((c: { id: string }) => c.id)).toEqual([crew1, crew2]);
    expect(i.crews[1].doers).toEqual([{ personId: camille }]);
    const [s] = await sql`SELECT crew_id, intervention_id FROM track_sessions WHERE id = ${session}`;
    expect(s).toMatchObject({ crew_id: crew2, intervention_id: id });
    const detail = await (await send("GET", `/interventions/${id}`)).json();
    const last = detail.history.at(-1);
    expect(last.action).toBe("corrected");
    expect(Object.keys(last.changes)).toEqual(["crews"]); // ni matériels, ni périodes : déduits des attelages
  });

  it("changer de mode : attelages → libre, puis annuler (parcours libérés)", async () => {
    const res = await send("PUT", `/interventions/${id}`, {
      procedure: "plowing",
      staffing: "free",
      periods: [P("08:00", "12:00")],
      tools: [{ equipmentId: tractorA }, { equipmentId: stubble }],
      doers: [{ personId: camille }],
      targets: [{ kind: "land_parcel", id: parcel }],
    });
    expect(res.status).toBe(200);
    const i = (await res.json()).intervention;
    expect(i).toMatchObject({ staffing: "free", crews: [], periods: [P("08:00", "12:00")] });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM intervention_crews WHERE intervention_id = ${id}`;
    expect(n).toBe(0);
    const detail = await (await send("GET", `/interventions/${id}`)).json();
    // Périodes aplaties inchangées (8 h-12 h) : seuls le mode, les attelages et les matériels changent.
    expect(Object.keys(detail.history.at(-1).changes).sort()).toEqual(["crews", "staffing", "tools"]);

    expect((await send("POST", `/interventions/${id}/cancel`, { reason: "erreur de saisie" })).status).toBe(200);
    const [s] = await sql`SELECT intervention_id, crew_id, linked_extent FROM track_sessions WHERE intervention_id IS NULL AND equipment_id = ${tractorB}`;
    expect(s).toMatchObject({ intervention_id: null, crew_id: null, linked_extent: null });
  });
});
