import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { createParcelFromMap, identifyPoint, parcelSheet, refreshReferences } from "../src/repos/parcel-sheet.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Parcelles (lot H des retours du 08/11/2026) : un point de la carte →
 * parcelle PAC et cadastrales (API Carto simulée), création rattachée à une
 * activité, références PAC et cadastre, fiche.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const CORN = "fourmy_test_corn_h";

// Un champ de ~1 ha ; la parcelle cadastrale le recoupe pour moitié.
const field = { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.5013, 44.8], [0.5013, 44.8009], [0.5, 44.8009], [0.5, 44.8]]]] };
const half = { type: "MultiPolygon", coordinates: [[[[0.5, 44.8], [0.50065, 44.8], [0.50065, 44.8009], [0.5, 44.8009], [0.5, 44.8]]]] };

function fakeCarto() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const u = String(input);
    calls.push(u);
    if (u.includes("/rpg/")) {
      const year = Number(new URL(u).searchParams.get("annee"));
      return Response.json({ features: [{ properties: { id_parcel: `rpg-${year}`, code_cultu: year % 2 ? "ZZT" : "XXX", surf_parc: 1.02 }, geometry: field }] });
    }
    return Response.json({
      features: [{ properties: { idu: "33001000AB0012", section: "AB", numero: "0012", nom_com: "Commune d'essai", code_insee: "33001", contenance: 5200 }, geometry: half }],
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe.skipIf(!url)("parcelles depuis la carte (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const db = createDb(url);
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let activityId = "";

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test parcelles"));
    await sql`INSERT INTO lexicon_productions (reference_name, family, specie, label) VALUES (${CORN}, 'plant_farming', 'zea_mays', 'Maïs d''essai')`;
    await sql`INSERT INTO lexicon_cap_codes (cap_code, cap_label, production, year) VALUES ('ZZT', 'Maïs', ${CORN}, 2024) ON CONFLICT DO NOTHING`;
    const r = await app.request(`/api/v1/farms/${farmId}/activities?year=2026`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Maïs", family: "plant_farming", reference: CORN }),
    });
    activityId = (await r.json()).id;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql`DELETE FROM lexicon_cap_codes WHERE production = ${CORN}`;
    await sql`DELETE FROM lexicon_productions WHERE reference_name = ${CORN}`;
    await sql.end();
  });

  it("un point : parcelle PAC (dernière campagne publiée), activité proposée, parcelles cadastrales", async () => {
    const fake = fakeCarto();
    const r = await identifyPoint(db, farmId, 44.80045, 0.50065, 2026, fake.fetchImpl);
    expect(r.capYear).toBe(2024); // RPG publié jusqu'à 2024
    expect(r.cap).toMatchObject({ id: "rpg-2024", year: 2024, cropCode: "XXX" });
    expect(r.cadastre).toEqual([expect.objectContaining({ idu: "33001000AB0012", label: "AB 12 Commune d'essai", areaM2: 5200 })]);
    expect(r.existing).toBeNull();
    // Code PAC connu de Lexicon : libellé, production de référence et activité de la ferme.
    const odd = await identifyPoint(db, farmId, 44.80045, 0.50065, 2023, fake.fetchImpl);
    expect(odd.cap).toMatchObject({ cropCode: "ZZT", cropLabel: "Maïs", production: CORN, suggestedActivity: { id: activityId, name: "Maïs" } });
  });

  it("crée la parcelle avec sa production, garde les références PAC et cadastre ; fiche", async () => {
    const ctx = { now: new Date().toISOString(), newId: () => crypto.randomUUID(), actor: userId, origin: "web" as const };
    const { id } = await createParcelFromMap(db, farmId, ctx, { name: "Le Grand Champ Maïs 2026", shape: field, year: 2026, activityId, capRef: "rpg-2024" });
    const fake = fakeCarto();
    expect(await refreshReferences(db, farmId, id, fake.fetchImpl)).toEqual({ cadastre: 1, cap: 10 });
    const sheet = await parcelSheet(db, farmId, id);
    expect(sheet).toMatchObject({ name: "Le Grand Champ Maïs 2026", pacIslet: "rpg-2024", productions: [{ year: 2026, activity: { id: activityId, name: "Maïs" } }] });
    expect(sheet.since.slice(0, 10)).toBe("2026-01-01");
    expect(sheet.cap.map((c) => c.year)).toEqual([2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015]);
    expect(sheet.cap.find((c) => c.year === 2023)).toMatchObject({ cropCode: "ZZT", cropLabel: "Maïs" });
    const cad = sheet.cadastre[0]!;
    expect(cad).toMatchObject({ idu: "33001000AB0012", label: "AB 12 Commune d'essai", areaM2: 5200 });
    expect(cad.overlapM2! / sheet.areaM2).toBeCloseTo(0.5, 1);
    // Un point de la parcelle : signalée comme existante.
    expect((await identifyPoint(db, farmId, 44.80045, 0.50065, 2026, fake.fetchImpl)).existing).toMatchObject({ id, name: "Le Grand Champ Maïs 2026" });
    // Routes : fiche, et identification refusée sans coordonnées.
    expect((await app.request(`/api/v1/farms/${farmId}/land-parcels/${id}/sheet`, { headers })).status).toBe(200);
    expect((await app.request(`/api/v1/farms/${farmId}/land-parcels/identify?lat=x`, { headers })).status).toBe(400);
  });
});
