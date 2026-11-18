import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { terrainDeps } from "../src/routes/plan3d.js";
import { clearLandscapeCache } from "../src/repos/landscape3d.js";
import { lonLatToTile } from "@fourmy/geo-ign";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Paysage du plan 3D (conception §4.3, §7) avec un faux WFS de l'IGN : une
 * haie qui traverse une parcelle, un bois, une ligne 400 kV et son pylône.
 * Attendu : arbres hors de la parcelle, pylône à sa hauteur IGN, tension
 * reprise de la ligne, puis réponse servie sans rappeler l'IGN.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const realFetch = terrainDeps.fetch;

// Lieu isolé (aucune autre fixture) : tuiles de zoom 14 propres à ce test.
const LAT0 = 45.123;
const LON0 = 2.456;
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const at = (x: number, y: number) => [LON0 + x * M_LON, LAT0 + y * M_LAT];

/** Arbre isolé du faux MNH. */
const PEAK = at(50, -200) as [number, number];

let calls: string[] = [];
let mode: "ok" | "down" | "429-once" = "ok";
const fakeWfs: typeof fetch = async (input) => {
  const u = new URL(String(input));
  const type = u.searchParams.get("TYPENAMES") ?? u.searchParams.get("LAYERS") ?? "";
  calls.push(type);
  if (mode === "down") return new Response("<ServiceException/>", { status: 503 });
  if (mode === "429-once") {
    mode = "ok";
    return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "0" } });
  }
  if (u.pathname === "/wms-r") {
    // MNH : pas de donnée partout, sauf une cime de 15 m isolée (au sud de la parcelle, loin des haies et du bois).
    const n = Number(u.searchParams.get("WIDTH"));
    const [south, west, north, east] = u.searchParams.get("BBOX")!.split(",").map(Number);
    const [plon, plat] = PEAK;
    const [pi, pj] = [Math.floor(((plon - west!) / (east! - west!)) * n), Math.floor(((north! - plat) / (north! - south!)) * n)];
    const buf = new ArrayBuffer(n * n * 4);
    const v = new DataView(buf);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v.setFloat32((j * n + i) * 4, Math.abs(i - pi) <= 1 && Math.abs(j - pj) <= 1 ? (i === pi && j === pj ? 15 : 9) : -99999, true);
    return new Response(buf, { headers: { "content-type": "image/x-bil;bits=32" } });
  }
  const features: Record<string, unknown[]> = {
    "BDTOPO_V3:haie": [{ geometry: { type: "LineString", coordinates: [at(-50, 50), at(150, 50)] }, properties: { cleabs: "HAIE_TEST" } }],
    "BDTOPO_V3:zone_de_vegetation": [
      { geometry: { type: "Polygon", coordinates: [[at(200, 0), at(300, 0), at(300, 100), at(200, 100), at(200, 0)]] }, properties: { cleabs: "BOIS_TEST", nature: "Bois" } },
    ],
    "BDTOPO_V3:ligne_electrique": [
      { geometry: { type: "LineString", coordinates: [[...at(-100, -50), 400], [...at(400, -50), 380]] }, properties: { cleabs: "LIGNE_TEST", voltage: "400 kV", etat_de_l_objet: "En service" } },
    ],
    "BDTOPO_V3:pylone": [{ geometry: { type: "Point", coordinates: at(-100, -50) }, properties: { cleabs: "PYLONE_TEST", hauteur: 51.1, etat_de_l_objet: "En service" } }],
  };
  return Response.json({ features: features[type] ?? [] });
};

describe.skipIf(!url)("paysage du plan 3D (intégration, faux IGN)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test paysage"));
    const parcel = crypto.randomUUID();
    // Parcelle de 100 m × 100 m que la haie traverse en son milieu.
    const ring = [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(0, 0)].map(([x, y]) => `${x} ${y}`).join(",");
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${farmId}, 'Carré')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcel}, ST_GeomFromText(${`MULTIPOLYGON(((${ring})))`}, 4326), 10000, tstzrange('2026-01-01', NULL))`;
    terrainDeps.fetch = fakeWfs;
  });
  beforeEach(() => {
    calls = [];
    mode = "ok";
    clearLandscapeCache();
  });
  afterAll(async () => {
    terrainDeps.fetch = realFetch;
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  const get = (q = "") => app.request(`/api/v1/farms/${farmId}/landscape3d?at=2026-10-05${q}`, { headers });

  it("arbres hors des parcelles, pylône et ligne avec leur hauteur et leur tension", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    const inParcel = (body.trees.items as [number, number][]).filter(([lon, lat]) => lon > at(0, 0)[0] && lon < at(100, 0)[0] && lat > at(0, 0)[1] && lat < at(0, 100)[1]);
    expect(inParcel).toHaveLength(0);
    const kinds = new Set((body.trees.items as number[][]).map((t) => body.trees.kinds[t[4]!]));
    expect(kinds).toEqual(new Set(["hedge", "deciduous"]));
    expect(body.pylons).toEqual([expect.objectContaining({ id: "PYLONE_TEST", heightM: 51.1, voltageKv: 400 })]);
    expect(body.lines).toEqual([expect.objectContaining({ id: "LIGNE_TEST", voltageKv: 400 })]);
    expect(body.lines[0].coords[0]).toHaveLength(2); // altitude NGF retirée
    expect(body.attribution).toEqual(["IGN – BD TOPO", "IGN – LiDAR HD"]);
    // LiDAR : les arbres de la BD TOPO sans donnée gardent leur hauteur ; la cime isolée devient un feuillu de 15 m.
    expect(body.canopy).toMatchObject({ removed: 0, added: 1 });
    const isolated = (body.trees.items as number[][]).find((t) => Math.abs(t[0]! - PEAK[0]) < 5 * M_LON && Math.abs(t[1]! - PEAK[1]) < 5 * M_LAT);
    expect(isolated?.[2]).toBe(15);
    expect(body.trees.kinds[isolated![4]!]).toBe("deciduous");
    expect(calls.length).toBeGreaterThan(0);

    // Deuxième appel : tuiles en cache disque, aucun appel à l'IGN.
    calls = [];
    clearLandscapeCache();
    expect((await get()).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("emprise demandée ; 429 repris ; IGN en panne sans cache : 502", async () => {
    const [w, s] = at(180, -20);
    const [e, n] = at(320, 120);
    const box = await (await get(`&bbox=${w},${s},${e},${n}`)).json();
    expect(box.trees.items.length).toBeGreaterThan(0);
    expect((box.trees.items as number[][]).every((t) => t[0]! >= w! && t[0]! <= e!)).toBe(true);
    expect((await get("&bbox=1,2,0,3")).status).toBe(400);

    // Tuile de ce test retirée du cache : un 429 est repris, une panne renvoie 502.
    // (Seule cette tuile : la base de développement garde celles des vraies fermes.)
    const t = lonLatToTile(LON0, LAT0, 14);
    const forget = () => sql`DELETE FROM ign_tiles WHERE layer IN ('landscape', 'canopy') AND z = 14 AND x BETWEEN ${t.x - 1} AND ${t.x + 1} AND y BETWEEN ${t.y - 1} AND ${t.y + 1}`;
    await forget();
    mode = "429-once";
    expect((await get()).status).toBe(200);
    await forget();
    clearLandscapeCache();
    mode = "down";
    expect((await get()).status).toBe(502);
  });
});
