import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Traces et couverture sur un cas géométrique connu : une parcelle de
 * 100 m × 100 m traversée de part en part par un passage au travail d'un
 * outil de 10 m, un point tous les 10 m et toutes les 5 s.
 * Attendu : 100 m × 10 m = 1 000 m², 10 segments × 5 s = 50 s.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
let farmId = "";
let userId = "";
let headers: Record<string, string> = {};
let base = "";
const equipmentId = crypto.randomUUID();

const LAT0 = 44.8;
const LON0 = 0.5;
const M_LAT = 1 / 111_320; // degrés par mètre (latitude)
const M_LON = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const at = (x: number, y: number) => [LON0 + x * M_LON, LAT0 + y * M_LAT] as const;

describe.skipIf(!url)("traces (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });

  beforeAll(async () => {
    const parcel = crypto.randomUUID();
    const binding = crypto.randomUUID();
    const ring = [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(0, 0)].map(([x, y]) => `${x} ${y}`).join(",");
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test traces"));
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Carré')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText(${`MULTIPOLYGON(((${ring})))`}, 4326),
              10000, tstzrange('2026-01-01', NULL))`;
    await sql`INSERT INTO equipments (id, farm_id, name, kind) VALUES (${equipmentId}, ${farmId}, 'Pulvé', 'tractor')`;
    await sql`INSERT INTO tracker_bindings (id, farm_id, equipment_id, device_id, valid)
      VALUES (${binding}, ${farmId}, ${equipmentId}, 'test', tstzrange('2026-01-01', NULL))`;
    // y de -10 à 110 m au milieu de la parcelle (x = 50 m) : 13 points.
    for (let i = 0; i <= 12; i++) {
      const [lon, lat] = at(50, -10 + i * 10);
      await sql`INSERT INTO positions (farm_id, binding_id, time, point, speed, attrs)
        VALUES (${farmId}, ${binding}, ${new Date(Date.UTC(2026, 9, 5, 12, 0, i * 5)).toISOString()},
                ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 7.2,
                ${sql.json({ working: true, widthM: 10, tool: "Rampe 10 m" })})`;
    }
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  const win = () => `equipment=${equipmentId}&from=2026-10-05T00:00:00Z&to=2026-10-06T00:00:00Z`;

  it("calcule la couverture attendue (1 000 m², 50 s)", async () => {
    const res = await app.request(`${base}/tracks/coverage?${win()}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.byParcel).toHaveLength(1);
    const p = body.byParcel[0];
    expect(p.parcelName).toBe("Carré");
    expect(p.durationS).toBe(50);
    expect(p.areaM2).toBeGreaterThan(980);
    expect(p.areaM2).toBeLessThan(1020);
    expect(p.tools).toEqual(["Rampe 10 m"]);
  });

  it("simplifie une trace rectiligne en conservant le temps, et produit du CZML", async () => {
    const json = await (await app.request(`${base}/tracks?${win()}&tolerance=1`, { headers })).json();
    expect(json.rawCount).toBe(13);
    expect(json.samples).toHaveLength(2); // une ligne droite se réduit à ses extrémités
    expect(json.samples[0][0]).toBe("2026-10-05T12:00:00.000Z");
    expect(json.samples[1][0]).toBe("2026-10-05T12:01:00.000Z");

    const czml = await (await app.request(`${base}/tracks?${win()}&format=czml&name=Pulvé`, { headers })).json();
    expect(czml[0].clock.interval).toBe("2026-10-05T12:00:00.000Z/2026-10-05T12:01:00.000Z");
    expect(czml[1].position.cartographicDegrees.slice(0, 1)).toEqual([0]);
    expect(czml[1].position.cartographicDegrees.at(-4)).toBe(60);
  });

  it("valide les paramètres (UUID, fenêtre bornée)", async () => {
    expect((await app.request(`${base}/tracks?equipment=x&from=a&to=b`, { headers })).status).toBe(400);
    const tooLong = `equipment=${equipmentId}&from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z`;
    expect((await app.request(`${base}/tracks?${tooLong}`, { headers })).status).toBe(400);
  });
});
