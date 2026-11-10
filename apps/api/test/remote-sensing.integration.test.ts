import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import type { IndexStatRow, SentinelClient } from "@fourmy/sentinel";
import type { ParcelIndexSeries, ParcelIndicesAt } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { recordUsage, monthUsage, syncRemoteSensing } from "../src/repos/remote-sensing.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Télédétection (lot Y) : synchro depuis un faux client Copernicus (aucun
 * appel réseau), puis lectures. Vérifie l'économie de requêtes (une parcelle
 * n'est redemandée que pour une date exploitable nouvelle), les parcelles trop
 * petites, l'image servie avec ETag, l'isolation entre fermes et la reprise
 * quand la géométrie change.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

// Béarn (UTM 30N) : une parcelle d'environ 300 × 300 m et une de 20 × 20 m.
const BIG = "MULTIPOLYGON(((-0.2 43.38,-0.19629 43.38,-0.19629 43.3827,-0.2 43.3827,-0.2 43.38)))";
const BIGGER = "MULTIPOLYGON(((-0.2 43.38,-0.1955 43.38,-0.1955 43.3827,-0.2 43.3827,-0.2 43.38)))";
const TINY = "MULTIPOLYGON(((-0.19 43.38,-0.18975 43.38,-0.18975 43.38018,-0.19 43.38018,-0.19 43.38)))";

/** Scènes synthétiques : date → part des pixels sans nuage (0 = couvert). */
function fakeClient(scenes: Map<string, number>) {
  const calls = { acquisitions: 0, validPixels: 0, parcelStats: [] as [string, string][], render: 0 };
  const client = {
    async acquisitions(_bbox: unknown, from: string, to: string) {
      calls.acquisitions++;
      return [...scenes.keys()].filter((d) => d >= from && d <= to).sort().map((date) => ({ date, cloudCover: 10 }));
    },
    async validPixels(_g: unknown, from: string, to: string, resolution = 60) {
      calls.validPixels++;
      // Union des deux parcelles réduites de 10 m : ~78 400 m² (la petite est vide).
      const px = 78_400 / (resolution * resolution);
      return { rows: [...scenes].filter(([d]) => d >= from && d <= to).map(([date, ratio]) => ({ date, validPx: Math.floor(px * ratio) })), pu: 0.1 };
    },
    async parcelStats(_g: unknown, from: string, to: string) {
      calls.parcelStats.push([from, to]);
      const rows: IndexStatRow[] = [];
      for (const [date, ratio] of [...scenes].filter(([d]) => d >= from && d <= to)) {
        const validPx = Math.round(784 * ratio);
        const ndvi = 0.2 + (Number(date.slice(5, 7)) - 5) * 0.2 + Number(date.slice(8)) / 100;
        for (const index of ["ndvi", "ndre", "ndmi"] as const) {
          const mean = validPx ? (index === "ndvi" ? ndvi : 0.3) : null;
          rows.push({ date, index, mean, std: mean && 0.05, p10: mean && mean - 0.1, p50: mean, p90: mean && mean + 0.1, validPx });
        }
      }
      return { rows, pu: 0.04 * rows.length };
    },
    async render() {
      calls.render++;
      return { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, calls.render]), pu: 0.7 };
    },
  };
  return { client: client as unknown as SentinelClient, calls };
}

describe.skipIf(!url)("télédétection (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url!);
  const big = crypto.randomUUID();
  const tiny = crypto.randomUUID();
  const bigVersion = crypto.randomUUID();
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let other = { farmId: "", userId: "", headers: {} as Record<string, string> };
  const scenes = new Map([
    ["2026-06-10", 0.95],
    ["2026-06-15", 0],
    ["2026-06-20", 0.9],
  ]);
  const fake = fakeClient(scenes);
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test télédétection"));
    other = await setupFarm(sql, "Autre ferme");
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${big}, ${farmId}, 'Grande'), (${tiny}, ${farmId}, 'Minuscule')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid) VALUES
      (${bigVersion}, ${big}, ST_GeomFromText(${BIG}, 4326), 90000, tstzrange('2026-01-01', NULL)),
      (${crypto.randomUUID()}, ${tiny}, ST_GeomFromText(${TINY}, 4326), 400, tstzrange('2026-01-01', NULL))`;
    const target = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${target}, ${farmId}, 'sowing', 'done', 'web', '2026-04-10T08:00:00Z', '2026-04-10T12:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${target}, 'target', 'land_parcel', ${big})`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await teardown(sql, other.farmId, [other.userId]);
    await sql.end();
  });

  it("première synchro : scènes, images des dates exploitables, indices de la seule grande parcelle", async () => {
    const r = await syncRemoteSensing(db, farmId, fake.client, { today: "2026-06-25" });
    expect(r.window).toEqual({ from: "2025-01-01", to: "2026-06-25" });
    expect(r).toMatchObject({ acquisitions: 3, scenes: 3, usableScenes: 2, images: 4, parcels: 1, parcelsTooSmall: 1, values: 9 });
    expect(fake.calls.parcelStats).toEqual([["2026-01-01", "2026-06-25"]]);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM parcel_indices WHERE farm_id = ${farmId}`;
    expect(n).toBe(9);
  });

  it("sans date exploitable nouvelle, ne redemande ni indices ni images", async () => {
    const before = { stats: fake.calls.parcelStats.length, render: fake.calls.render };
    const r = await syncRemoteSensing(db, farmId, fake.client, { today: "2026-06-26" });
    expect(r).toMatchObject({ images: 0, parcels: 0, values: 0 });
    expect(fake.calls.parcelStats.length).toBe(before.stats);
    expect(fake.calls.render).toBe(before.render);
  });

  it("une date exploitable nouvelle : seule la suite est demandée", async () => {
    scenes.set("2026-06-28", 0.85);
    const r = await syncRemoteSensing(db, farmId, fake.client, { today: "2026-06-30" });
    expect(r).toMatchObject({ images: 2, parcels: 1, values: 3 });
    expect(fake.calls.parcelStats.at(-1)).toEqual(["2026-06-21", "2026-06-30"]);
  });

  it("valeurs à la date de la frise, parcelle trop petite, image avec ETag", async () => {
    const res = await app.request(`${base()}/remote-sensing/parcels?at=2026-06-25`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ParcelIndicesAt;
    const g = body.items.find((i) => i.parcelId === big)!;
    expect(g).toMatchObject({ status: "ok", date: "2026-06-20", ageDays: 5 });
    expect(g.mean).toBeCloseTo(0.6, 5);
    expect(g.parcelPixels).toBeGreaterThan(700);
    expect(body.items.find((i) => i.parcelId === tiny)).toMatchObject({ status: "too_small", mean: null });
    expect(body.images.map((i) => [i.kind, i.date])).toEqual([
      ["ndvi", "2026-06-20"],
      ["rgb", "2026-06-20"],
    ]);
    expect(body.attribution).toContain("Copernicus Sentinel");

    // Avant toute acquisition exploitable : aucune valeur.
    const early = (await (await app.request(`${base()}/remote-sensing/parcels?at=2026-06-01`, { headers })).json()) as ParcelIndicesAt;
    expect(early.items.find((i) => i.parcelId === big)).toMatchObject({ status: "none", mean: null });

    const img = await app.request(body.images[0]!.url, { headers });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    const again = await app.request(body.images[0]!.url, { headers: { ...headers, "if-none-match": img.headers.get("etag")! } });
    expect(again.status).toBe(304);

    // Une autre ferme ne voit ni l'image ni les valeurs.
    const stranger = await app.request(`/api/v1/farms/${other.farmId}/remote-sensing/images/2026-06-20/ndvi`, { headers: other.headers });
    expect(stranger.status).toBe(404);
    const theirs = (await (await app.request(`/api/v1/farms/${other.farmId}/remote-sensing/parcels?at=2026-06-25`, { headers: other.headers })).json()) as ParcelIndicesAt;
    expect(theirs.items).toEqual([]);
  });

  it("série d'une parcelle : points, courbe lissée et interventions", async () => {
    const res = await app.request(`${base()}/land-parcels/${big}/indices?from=2026-01-01&to=2026-06-30`, { headers });
    expect(res.status).toBe(200);
    const s = (await res.json()) as ParcelIndexSeries;
    expect(s.points.map((p) => [p.date, p.usable])).toEqual([
      ["2026-06-10", true],
      ["2026-06-15", false],
      ["2026-06-20", true],
      ["2026-06-28", true],
    ]);
    expect(s.smoothed[0]!.date).toBe("2026-06-10");
    expect(s.smoothed.at(-1)!.date).toBe("2026-06-28");
    expect(s.interventions).toEqual([expect.objectContaining({ procedure: "sowing", at: "2026-04-10" })]);
    expect(s.tooSmall).toBe(false);

    const bad = await app.request(`${base()}/land-parcels/${big}/indices?index=evi`, { headers });
    expect(bad.status).toBe(400);
  });

  it("une géométrie modifiée efface ses valeurs et repart de zéro", async () => {
    await sql`UPDATE land_parcel_versions SET shape = ST_GeomFromText(${BIGGER}, 4326) WHERE id = ${bigVersion}`;
    const r = await syncRemoteSensing(db, farmId, fake.client, { today: "2026-06-30" });
    expect(r.parcels).toBe(1);
    expect(fake.calls.parcelStats.at(-1)).toEqual(["2026-01-01", "2026-06-30"]);
    const [{ px }] = await sql`SELECT max(parcel_px)::int AS px FROM parcel_indices WHERE land_parcel_version_id = ${bigVersion}`;
    expect(px).toBeGreaterThan(900); // ~364 × 280 m une fois réduite de 10 m, contre ~784 px avant
  });

  it("compte l'usage du mois", async () => {
    await recordUsage(db, farmId, 0.5, "2026-06-30");
    await recordUsage(db, farmId, 0.25, "2026-06-30");
    expect(await monthUsage(db, farmId, "2026-06-15")).toEqual({ requests: 2, pu: 0.75 });
  });
});

/**
 * Interventions probablement manquantes (lot Z) : chute du NDVI sans récolte
 * saisie ; vigne exclue ; récolte saisie dans les 30 jours ; délai non écoulé ;
 * chute écartée par l'exploitant.
 */
describe.skipIf(!url)("récoltes probables non saisies (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url!);
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  const parcels = { maize: crypto.randomUUID(), harvested: crypto.randomUUID(), vine: crypto.randomUUID(), late: crypto.randomUUID() };
  // Maïs : haut le 28/07, sol nu le 19/08 (confirmé le 29/08).
  const season = [["06-26", 0.79], ["07-28", 0.56], ["08-07", 0.44], ["08-19", 0.27], ["08-29", 0.19]] as const;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test récoltes probables"));
    const campaign = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    for (const [name, id] of Object.entries(parcels)) {
      const version = crypto.randomUUID();
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${version}, ${id}, ST_GeomFromText(${BIG}, 4326), 90000, tstzrange('2026-01-01', NULL))`;
      // « late » : même courbe décalée d'un mois (délai de 30 jours pas encore écoulé au 10/10).
      const shiftMonth = (md: string) => (name === "late" ? `${String(Number(md.slice(0, 2)) + 1).padStart(2, "0")}${md.slice(2)}` : md);
      for (const [md, ndvi] of season) {
        await sql`INSERT INTO parcel_indices (farm_id, land_parcel_version_id, acquired_on, vegetation_index, mean, valid_px, parcel_px, method)
          VALUES (${farmId}, ${version}, ${`2026-${shiftMonth(md)}`}, 'ndvi', ${ndvi}, 700, 784, 'test')`;
      }
    }
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${parcels.vine}, 'vine')`;
    const harvest = crypto.randomUUID();
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${harvest}, ${farmId}, 'grains_harvest', 'done', 'web', '2026-09-12T08:00:00Z', '2026-09-12T18:00:00Z')`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${harvest}, 'target', 'land_parcel', ${parcels.harvested})`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql.end();
  });

  it("signale seulement le maïs sans récolte saisie dont le délai est écoulé", async () => {
    const { coverLossAnomalies } = await import("../src/repos/remote-sensing.js");
    const items = await coverLossAnomalies(db, farmId, "2026-01-01", "2026-10-10", "2026-10-10");
    expect(items).toEqual([
      expect.objectContaining({ parcelId: parcels.maize, from: "2026-07-28", to: "2026-08-19", confirmed: true, dueSince: "2026-09-18", suggestedProcedure: "harvesting" }),
    ]);
    // Un mois plus tard, la chute décalée est à son tour signalée.
    const later = await coverLossAnomalies(db, farmId, "2026-01-01", "2026-11-30", "2026-11-30");
    expect(later.map((a) => a.parcelId).sort()).toEqual([parcels.maize, parcels.late].sort());
  });

  it("l'exploitant écarte une chute ; elle n'est plus signalée", async () => {
    const res = await app.request(`/api/v1/farms/${farmId}/remote-sensing/anomalies/dismiss`, {
      method: "POST",
      headers,
      body: JSON.stringify({ parcelId: parcels.maize, to: "2026-08-19", reason: "Ensilage saisi dans un autre logiciel" }),
    });
    expect(res.status).toBe(204);
    const list = await app.request(`/api/v1/farms/${farmId}/remote-sensing/anomalies?from=2026-01-01&to=2026-11-10`, { headers });
    const body = (await list.json()) as { items: { parcelId: string }[] };
    expect(body.items.map((a) => a.parcelId)).toEqual([parcels.late]);
    const [row] = await sql`SELECT reason, dismissed_by FROM remote_sensing_dismissals WHERE land_parcel_id = ${parcels.maize}`;
    expect(row).toMatchObject({ reason: "Ensilage saisi dans un autre logiciel", dismissed_by: userId });
  });
});
