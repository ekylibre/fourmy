import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * API des parcours (lot O3) : liste d'un matériel (filtres, curseur), onglet
 * d'un outil, détail, réglages et recalcul (owner). Volume : 90 jours de
 * parcours pour 3 matériels suivis, liste en moins de 2 s.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1, 6, 0, 0); // 1er juillet 2026, 8 h

describe.skipIf(!url)("parcours : API (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const tractors = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const bindings = tractors.map(() => crypto.randomUUID());
  const plough = crypto.randomUUID();
  const parcel = crypto.randomUUID();
  let farmId = "";
  let ownerId = "";
  let owner: Record<string, string> = {};
  let worker: { userId: string; headers: Record<string, string> };
  let base = "";

  beforeAll(async () => {
    ({ farmId, userId: ownerId, headers: owner } = await setupFarm(sql, "Ferme test parcours API"));
    worker = await addMember(sql, farmId, "worker");
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'La Plaine')`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${plough}, ${farmId}, 'Charrue', 'trailed_equipment')`;
    for (const [k, id] of tractors.entries()) {
      await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${id}, ${farmId}, ${`Tracteur ${k + 1}`}, 'tractor')`;
      await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid) VALUES (${bindings[k]!}, ${farmId}, ${id}, ${`b${k}`}, tstzrange('2026-01-01', NULL))`;
    }
    // 90 jours × 3 tracteurs × 10 parcours d'une demi-heure (2 700 lignes).
    const values: unknown[][] = [];
    for (let d = 0; d < 90; d++) {
      for (const [k, id] of tractors.entries()) {
        for (let n = 0; n < 10; n++) {
          const start = T0 + d * DAY + n * 3_600_000;
          const work = n % 2 === 0;
          values.push([
            crypto.randomUUID(), farmId, id, bindings[k]!, work ? "work" : "transit",
            new Date(start).toISOString(), new Date(start + 1_800_000).toISOString(), 120, 3000,
            work ? 12_000 : null,
            JSON.stringify(work ? [{ landParcelId: parcel, name: "La Plaine", areaM2: 9000, share: 0.3 }] : []),
            work ? "charrue" : null, work && k === 0 ? plough : null, "h",
          ]);
        }
      }
    }
    for (let i = 0; i < values.length; i += 500) {
      await sql`INSERT INTO track_sessions ${sql(
        values.slice(i, i + 500).map((v) => ({
          id: v[0], farm_id: v[1], equipment_id: v[2], binding_id: v[3], kind: v[4], started_at: v[5], stopped_at: v[6],
          position_count: v[7], distance_m: v[8], covered_area_m2: v[9], parcels: v[10], tool_hint: v[11], tool_equipment_id: v[12], settings_hash: v[13],
        })) as never,
      )}`;
    }
    // Insertion par lot : le JSON arrive en chaîne ; on le remet en tableau.
    await sql`UPDATE track_sessions SET parcels = (parcels #>> '{}')::jsonb WHERE farm_id = ${farmId} AND jsonb_typeof(parcels) = 'string'`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [ownerId, worker.userId]);
    await sql.end();
  });

  const list = (equipment: string, q: string, headers = worker.headers) => app.request(`${base}/equipments/${equipment}/track-sessions?${q}`, { headers });
  const range = (from: number, days: number) => `from=${new Date(T0 + from * DAY - 3_600_000).toISOString()}&to=${new Date(T0 + (from + days) * DAY).toISOString()}`;

  it("liste d'un tracteur : plus récents d'abord, filtres type, parcelle et état", async () => {
    const res = await list(tractors[1]!, `${range(0, 2)}&limit=200`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(20);
    expect(body.items[0].startedAt > body.items[1].startedAt).toBe(true);
    expect(body.items[0]).toMatchObject({ equipmentId: tractors[1], tracker: null, intervention: null, durationS: 1800 });
    const work = (await (await list(tractors[1]!, `${range(0, 2)}&kind=work`)).json()).items;
    expect(work.every((s: { kind: string }) => s.kind === "work")).toBe(true);
    expect(work).toHaveLength(10);
    const onParcel = (await (await list(tractors[1]!, `${range(0, 2)}&parcel=${parcel}`)).json()).items;
    expect(onParcel).toHaveLength(10);
    expect((await (await list(tractors[1]!, `${range(0, 2)}&state=linked`)).json()).items).toHaveLength(0);
    expect((await list(tractors[1]!, `${range(0, 2)}&kind=flight`)).status).toBe(400);
  });

  it("pagination : curseur jusqu'à la fin, sans doublon", async () => {
    const seen = new Set<string>();
    let cursor: string | null = "";
    let pages = 0;
    while (cursor !== null) {
      const body = (await (await list(tractors[2]!, `${range(0, 3)}&limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json()) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      for (const s of body.items) seen.add(s.id);
      cursor = body.nextCursor;
      pages++;
    }
    expect(seen.size).toBe(30);
    expect(pages).toBe(5);
  });

  it("onglet d'un outil : les parcours où il était attelé, avec le tracteur", async () => {
    const body = (await (await list(plough, `${range(0, 1)}`)).json()) as { items: { tracker: { name: string } | null; tool: { id: string } }[] };
    expect(body.items).toHaveLength(5);
    expect(body.items.every((s) => s.tracker?.name === "Tracteur 1" && s.tool.id === plough)).toBe(true);
  });

  it("détail : trace et couverture (vides sans positions)", async () => {
    const [first] = (await (await list(tractors[0]!, `${range(0, 1)}&limit=1`)).json()).items;
    const res = await app.request(`${base}/track-sessions/${first.id}`, { headers: worker.headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: first.id, samples: [], coverage: null });
    expect((await app.request(`${base}/track-sessions/${crypto.randomUUID()}`, { headers: worker.headers })).status).toBe(404);
  });

  it("volume : 90 jours, 3 matériels → la liste répond en moins de 2 s", async () => {
    const started = performance.now();
    const res = await list(tractors[0]!, `${range(0, 90)}&limit=200`);
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(200);
    expect(elapsed).toBeLessThan(2000);
  });

  // En dernier : le recalcul supprime les parcours libres de ce jeu (aucune position derrière).
  it("réglages : lus par tout membre, modifiés et recalculés par le responsable", async () => {
    const read = await app.request(`${base}/settings/tracks`, { headers: worker.headers });
    expect(await read.json()).toMatchObject({ stopMin: 15, minDurationMin: 3 });
    const next = { stopMin: 20, minDurationMin: 5, minDistanceM: 300, movingKmh: 3, parcelMinShare: 0.1, parcelMinAreaM2: 800 };
    const put = (headers: Record<string, string>, body: unknown) => app.request(`${base}/settings/tracks`, { method: "PUT", headers, body: JSON.stringify(body) });
    expect((await put(worker.headers, next)).status).toBe(403);
    expect((await put(owner, { ...next, stopMin: 1 })).status).toBe(400);
    expect(await (await put(owner, next)).json()).toEqual(next);
    expect((await app.request(`${base}/track-sessions/recompute`, { method: "POST", headers: worker.headers })).status).toBe(403);
    const r = await app.request(`${base}/track-sessions/recompute`, { method: "POST", headers: owner });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ bindings: 3 });
  });

});
