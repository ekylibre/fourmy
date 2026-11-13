import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadFixture, type FixtureFile } from "@fourmy/db";
import { laneOf } from "@fourmy/domain";
import type { ActivityItinerary, TechnicalItinerary } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Itinéraires techniques (lot T1) sur la ferme pilote viticole (données
 * réelles anonymisées) : parcelle sur une campagne et sur trois, activité
 * fusionnée, droits et isolation entre fermes.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("itinéraires techniques (intégration, ferme pilote)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let reader: { userId: string; headers: Record<string, string> };
  let other: { farmId: string; userId: string; headers: Record<string, string> };
  let parcelId = "";
  let activityId = "";
  const get = (path: string, headers = reader.headers, farm = farmId) => app.request(`/api/v1/farms/${farm}${path}`, { headers });

  beforeAll(async () => {
    const path = fileURLToPath(new URL("../../../fixtures/pilote-viticulture.json", import.meta.url));
    const fixture = JSON.parse(await readFile(path, "utf8")) as FixtureFile;
    await loadFixture(sql, fixture);
    farmId = fixture.tables.farms![0]!.id as string;
    reader = await addMember(sql, farmId, "reader");
    const o = await setupFarm(sql, "Ferme voisine itinéraires");
    other = { farmId: o.farmId, userId: o.userId, headers: o.headers };
    // La parcelle la plus travaillée en 2023, et son activité cette année-là.
    const [p] = await sql`
      SELECT t.ref_id AS id FROM interventions i
      JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
      WHERE i.farm_id = ${farmId} AND i.started_at >= '2023-01-01' AND i.started_at < '2024-01-01'
      GROUP BY t.ref_id ORDER BY count(*) DESC LIMIT 1`;
    parcelId = p!.id;
    const [a] = await sql`SELECT p.activity_id AS id FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                          WHERE p.land_parcel_id = ${parcelId} AND c.year = 2023 AND p.activity_id IS NOT NULL LIMIT 1`;
    activityId = a!.id;
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM memberships WHERE user_id = ${reader.userId}`;
    await sql`DELETE FROM users WHERE id = ${reader.userId}`;
    await teardown(sql, other.farmId, [other.userId]);
    await sql.end();
  });

  /** Interventions de la parcelle en 2023 qui doivent figurer : non annulées, avec un couloir. */
  async function expected2023(): Promise<string[]> {
    const list = await sql`
      SELECT DISTINCT i.id, i.procedure, i.irrigation IS NOT NULL AS irrigation FROM interventions i
      JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel' AND t.ref_id = ${parcelId}
      WHERE i.status <> 'cancelled' AND coalesce(i.started_at, i.stopped_at, i.created_at) >= '2022-12-31T23:00:00Z'
        AND coalesce(i.started_at, i.stopped_at, i.created_at) < '2023-12-31T23:00:00Z'`;
    return list.filter((i) => laneOf(i.procedure, i.irrigation)).map((i) => i.id as string).sort();
  }

  it("parcelle, campagne 2023 : une étape (vigne, dates de la campagne), toutes ses interventions, lisible par un lecteur", async () => {
    const r = await get(`/land-parcels/${parcelId}/itinerary?year=2023`);
    expect(r.status).toBe(200);
    const it = (await r.json()) as TechnicalItinerary;
    expect(it.campaigns).toEqual([2023]);
    const crops = it.steps.filter((s) => s.kind === "crop");
    expect(crops).toHaveLength(1);
    const step = crops[0]!;
    expect(step.datesFrom).toBe("campaign"); // vigne : pas de semis
    expect(step.from).toBe("2023-01-01");
    const ids = it.steps.flatMap((s) => s.marks.flatMap((m) => m.interventionIds)).sort();
    expect(ids).toEqual(await expected2023());
    expect(ids.length).toBeGreaterThan(10);
    for (const m of step.marks) {
      expect(["works", "inputs"]).toContain(m.lane);
      expect(m.day).toBe(Math.round((Date.parse(m.at) - Date.parse(step.from)) / 86_400_000));
      expect(m.details[0]!.label).toBe("Date");
      expect(m.parcels.map((p) => p.id)).toContain(parcelId);
    }
    // Un traitement nomme son produit (E11) et le détaille (E12).
    const spray = step.marks.find((m) => m.lane === "inputs" && m.label.includes(" · "));
    expect(spray).toBeDefined();
    expect(spray!.details.some((d) => d.label === "Intrants" && /\d/.test(d.value))).toBe(true);
  });

  it("rotation sur trois ans : une étape par campagne, dans l'ordre", async () => {
    const it = (await (await get(`/land-parcels/${parcelId}/itinerary?year=2023&years=3`)).json()) as TechnicalItinerary;
    expect(it.campaigns).toEqual([2021, 2022, 2023]);
    const crops = it.steps.filter((s) => s.kind === "crop");
    expect(crops.map((s) => s.campaign)).toEqual([2021, 2022, 2023]);
    expect(crops.map((s) => s.from)).toEqual([...crops.map((s) => s.from)].sort());
  });

  it("dix ans d'historique : toutes les campagnes, en moins d'une seconde (N5)", async () => {
    const t = Date.now();
    const r = await get(`/land-parcels/${parcelId}/itinerary?year=2023&years=10`);
    expect(r.status).toBe(200);
    expect(Date.now() - t).toBeLessThan(1000);
    const it = (await r.json()) as TechnicalItinerary;
    expect(it.campaigns).toHaveLength(10);
    expect(it.steps.reduce((n, s) => n + s.marks.length, 0)).toBeGreaterThan(50);
  });

  it("activité 2023 : vue fusionnée, parcelles de l'activité, chantiers regroupés", async () => {
    const r = await get(`/activities/${activityId}/itinerary?year=2023`);
    expect(r.status).toBe(200);
    const a = (await r.json()) as ActivityItinerary;
    expect(a.steps).toHaveLength(1);
    expect(a.parcels.map((p) => p.id)).toContain(parcelId);
    const marks = a.steps[0]!.marks;
    const grouped = marks.filter((m) => m.interventionIds.length > 1);
    expect(grouped.length).toBeGreaterThan(0);
    for (const m of grouped) {
      expect(m.label).toMatch(/\d+ parcelles?$/);
      expect(m.from <= m.at && m.at <= m.to).toBe(true);
      // Chaque intervention du groupe, pour l'ouvrir depuis la vue fusionnée.
      expect(m.members!.map((x) => x.interventionId)).toEqual(m.interventionIds);
      expect(m.members!.every((x) => x.parcels.length > 0)).toBe(true);
    }
    // Chaque intervention n'apparaît qu'une fois.
    const ids = marks.flatMap((m) => m.interventionIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.parcels.find((p) => p.id === parcelId)!.interventions).toBe((await expected2023()).length);
  });

  it("paramètres invalides : 400 ; inconnus : 404 ; autre ferme : 404", async () => {
    expect((await get(`/land-parcels/${parcelId}/itinerary?years=0`)).status).toBe(400);
    expect((await get(`/land-parcels/${parcelId}/itinerary?years=21`)).status).toBe(400);
    expect((await get(`/land-parcels/${parcelId}/itinerary?year=deux-mille`)).status).toBe(400);
    expect((await get(`/land-parcels/00000000-0000-7000-8000-000000000000/itinerary`)).status).toBe(404);
    expect((await get(`/activities/00000000-0000-7000-8000-000000000000/itinerary?year=2023`)).status).toBe(404);
    // Isolation : la parcelle de la ferme pilote n'existe pas pour une autre ferme.
    expect((await get(`/land-parcels/${parcelId}/itinerary?year=2023`, other.headers, other.farmId)).status).toBe(404);
    expect((await get(`/activities/${activityId}/itinerary?year=2023`, other.headers, other.farmId)).status).toBe(404);
  });
});
