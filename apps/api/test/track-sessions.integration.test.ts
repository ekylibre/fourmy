import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { computeTrackSessions, driftOf } from "../src/repos/track-sessions.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Parcours matérialisés (lot O2) sur une trace synthétique : un passage au
 * travail de 120 m à travers une parcelle de 100 m × 100 m (outil de 10 m),
 * puis un déplacement de 240 m. Réglages de la ferme abaissés pour des
 * parcours d'une minute.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const LAT0 = 44.8;
const LON0 = 0.5;
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const at = (x: number, y: number) => [LON0 + x * M_LON, LAT0 + y * M_LAT] as const;
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
const time = (s: number) => new Date(T0 + s * 1000).toISOString();

describe.skipIf(!url)("parcours (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url);
  const tractor = crypto.randomUUID();
  const harrow = crypto.randomUUID();
  const binding = crypto.randomUUID();
  const parcel = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};

  const point = (s: number, x: number, y: number, attrs: Record<string, unknown>, speed = 7.2) => {
    const [lon, lat] = at(x, y);
    return sql`INSERT INTO positions (farm_id, binding_id, time, point, speed, attrs)
      VALUES (${farmId}, ${binding}, ${time(s)}, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), ${speed}, ${sql.json(attrs as never)})`;
  };
  const sessions = () =>
    sql<{ id: string; kind: string; started_at: Date; stopped_at: Date; covered_area_m2: string | null; parcels: { landParcelId: string; areaM2: number; share: number }[]; tool_hint: string | null; tool_equipment_id: string | null; intervention_id: string | null; drift: { startedAt: string } | null; settings_hash: string }[]>`
      SELECT * FROM track_sessions WHERE binding_id = ${binding} ORDER BY started_at`;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test parcours"));
    const ring = [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(0, 0)].map(([x, y]) => `${x} ${y}`).join(",");
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Carré')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText(${`MULTIPOLYGON(((${ring})))`}, 4326), 10000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind, external_ids) VALUES
      (${tractor}, ${farmId}, 'Tracteur', 'tractor', '{}'),
      (${harrow}, ${farmId}, 'Herse rotative 3 m', 'trailed_equipment', ${sql.json({ traccarTool: "HERSE" })})`;
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid)
      VALUES (${binding}, ${farmId}, ${tractor}, 'test', tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO farm_settings (farm_id, tracks) VALUES (${farmId},
      ${sql.json({ stopMin: 15, minDurationMin: 0.5, minDistanceM: 50, movingKmh: 2, parcelMinShare: 0.05, parcelMinAreaM2: 500 })})`;
    // Travail : x = 50 m, y de -10 à 110 m, un point toutes les 5 s (0 à 60 s).
    for (let i = 0; i <= 12; i++) await point(i * 5, 50, -10 + i * 10, { working: true, widthM: 10, tool: "herse" });
    // Déplacement : y = 110 m, x de 50 à 290 m (65 à 125 s).
    for (let i = 1; i <= 13; i++) await point(60 + i * 5, 50 + (i - 1) * 20, 110, { working: false, tool: "herse" }, 14.4);
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("calcul initial : un travail puis un déplacement, parcelle et outil résolus", async () => {
    const r = await computeTrackSessions(db, farmId);
    expect(r).toMatchObject({ bindings: 1, inserted: 2, deleted: 0 });
    const [work, transit] = await sessions();
    expect(work).toMatchObject({ kind: "work", tool_hint: "herse", tool_equipment_id: harrow, intervention_id: null });
    expect(work!.started_at.toISOString()).toBe(time(0));
    expect(work!.stopped_at.toISOString()).toBe(time(60));
    expect(work!.parcels).toHaveLength(1);
    expect(work!.parcels[0]).toMatchObject({ landParcelId: parcel });
    expect(Number(work!.covered_area_m2)).toBeGreaterThan(work!.parcels[0]!.areaM2); // la bande déborde de la parcelle
    expect(transit).toMatchObject({ kind: "transit", covered_area_m2: null, parcels: [] });
  });

  it("surface dans la parcelle cohérente avec la couverture (à 1 % près)", async () => {
    const res = await app.request(
      `/api/v1/farms/${farmId}/tracks/coverage?equipment=${tractor}&from=2026-10-05T00:00:00Z&to=2026-10-06T00:00:00Z&width=3`,
      { headers },
    );
    const coverage = (await res.json()) as { byParcel: { landParcelId: string; areaM2: number }[] };
    const expected = coverage.byParcel.find((p) => p.landParcelId === parcel)!.areaM2;
    const [work] = await sessions();
    expect(Math.abs(work!.parcels[0]!.areaM2 - expected) / expected).toBeLessThan(0.01);
    expect(work!.parcels[0]!.share).toBeCloseTo(expected / 10_000, 2);
  });

  it("liste : largeur de travail annoncée par le boîtier", async () => {
    const res = await app.request(
      `/api/v1/farms/${farmId}/equipments/${tractor}/track-sessions?from=2026-10-05T00:00:00Z&to=2026-10-06T00:00:00Z`,
      { headers },
    );
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { kind: string; widthM: number | null }[] };
    expect(items.find((s) => s.kind === "work")?.widthM).toBe(10);
  });

  it("incrémental : mêmes parcours, mêmes identifiants", async () => {
    const before = (await sessions()).map((s) => s.id);
    await computeTrackSessions(db, farmId);
    expect((await sessions()).map((s) => s.id)).toEqual(before);
  });

  it("une position tardive dans un parcours libre le recalcule", async () => {
    await point(130, 310, 110, { working: false, tool: "herse" }, 14.4);
    await computeTrackSessions(db, farmId);
    const list = await sessions();
    expect(list).toHaveLength(2);
    expect(list[1]!.stopped_at.toISOString()).toBe(time(130));
  });

  it("une position tardive avant un parcours rattaché : il reste, avec sa dérive", async () => {
    const intervention = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin) VALUES (${intervention}, ${farmId}, 'harrowing', 'done', 'web')`;
    const [work] = await sessions();
    await sql`UPDATE track_sessions SET intervention_id = ${intervention},
                linked_extent = tstzrange(started_at, stopped_at, '[]') WHERE id = ${work!.id}`;
    // Le boîtier rend 2 minutes de travail d'avant, juste avant le passage rattaché.
    for (let i = 0; i < 24; i++) await point(-120 + i * 5, 40, -10 + i * 5, { working: true, widthM: 10, tool: "herse" });
    const r = await computeTrackSessions(db, farmId);
    expect(r.drifted).toBe(1);
    const list = await sessions();
    const linked = list.find((s) => s.id === work!.id)!;
    expect(linked).toMatchObject({ intervention_id: intervention });
    expect(linked.started_at.toISOString()).toBe(time(0)); // étendue figée
    expect(linked.drift).toMatchObject({ startedAt: time(-120) });
    // Les positions tardives forment un parcours libre à part, sans chevauchement.
    const early = list.find((s) => s.started_at.toISOString() === time(-120))!;
    expect(early).toMatchObject({ kind: "work", intervention_id: null });
    expect(early.stopped_at.getTime()).toBeLessThan(linked.started_at.getTime());
  });

  it("un changement de réglages ne recalcule que les parcours libres", async () => {
    const [{ settings_hash: oldHash }] = (await sessions()).filter((s) => s.intervention_id);
    await sql`UPDATE farm_settings SET tracks = tracks || '{"minDistanceM": 1000}' WHERE farm_id = ${farmId}`;
    await computeTrackSessions(db, farmId);
    const list = await sessions();
    // Plus aucun parcours libre n'atteint 1 km ; le rattaché reste tel quel.
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ settings_hash: oldHash });
    expect(list[0]!.intervention_id).not.toBeNull();
  });

  it("dérive : rien sous la minute, rien si plus rien ne recouvre la plage", () => {
    const l = { kind: "work", lower: time(0), upper: time(60) };
    const span = (from: number, to: number, kind: "work" | "transit" = "work") => ({
      kind,
      startedAt: time(from),
      stoppedAt: time(to),
      fromIndex: 0,
      toIndex: 1,
      positionCount: 2,
      distanceM: 100,
      toolHint: null,
    });
    expect(driftOf(l, [span(-30, 70)])).toBeNull();
    expect(driftOf(l, [span(-90, 60)])).toEqual({ startedAt: time(-90), stoppedAt: time(60) });
    expect(driftOf(l, [span(-90, 60, "transit")])).toBeNull();
  });
});
