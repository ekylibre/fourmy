import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Temps de travaux, lot P2 (docs/equipe-personnes-design.md §5) : union des
 * plages, chevauchement partagé, répartition par activité (prorata des
 * surfaces) et par procédure, pavés de la grille, liste des interventions.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("temps de travaux (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  let reader: { userId: string; headers: Record<string, string> };
  const person = crypto.randomUUID();
  const other = crypto.randomUUID();
  const mais = crypto.randomUUID();
  const parcelA = crypto.randomUUID();
  const parcelB = crypto.randomUUID();
  const plowing = crypto.randomUUID();
  const harrowing = crypto.randomUUID();
  const base = () => `/api/v1/farms/${farmId}`;

  /** Intervention réalisée (mode libre), une période, la personne intervenante, une parcelle. */
  const intervention = async (id: string, procedure: string, from: string, to: string, parcel: string, doer = person, status = "done") => {
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at) VALUES (${id}, ${farmId}, ${procedure}, ${status}, 'web', ${from}, ${to})`;
    await sql`INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at) VALUES (${crypto.randomUUID()}, ${id}, ${from}, ${to})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES
      (${crypto.randomUUID()}, ${id}, 'doer', 'person', ${doer}), (${crypto.randomUUID()}, ${id}, 'target', 'land_parcel', ${parcel})`;
  };

  beforeAll(async () => {
    ({ farmId, ...owner } = await setupFarm(sql, "Ferme temps de travaux"));
    reader = await addMember(sql, farmId, "reader");
    await sql`INSERT INTO people (id, farm_id, name) VALUES (${person}, ${farmId}, 'Camille'), (${other}, ${farmId}, 'Lou')`;
    for (const [id, name] of [[parcelA, "Grande pièce"], [parcelB, "Bois"]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_Multi(ST_MakeEnvelope(0.5, 44.8, 0.501, 44.801, 4326)), 10000, tstzrange('2020-01-01', NULL))`;
    }
    const campaign = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaign}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    await sql`INSERT INTO activities (id, farm_id, name, family) VALUES (${mais}, ${farmId}, 'Maïs', 'plant_farming')`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaign}, ${parcelA}, 'field_crop', ${mais})`;
    // 05/10 : labour 8 h-12 h (Paris) sur le maïs, hersage 10 h-14 h sur une parcelle sans production : 2 h communes.
    await intervention(plowing, "plowing", "2026-10-05T06:00:00Z", "2026-10-05T10:00:00Z", parcelA);
    await intervention(harrowing, "harrowing", "2026-10-05T08:00:00Z", "2026-10-05T12:00:00Z", parcelB);
    // Pas comptées : planifiée, et celle d'une autre personne.
    await intervention(crypto.randomUUID(), "plowing", "2026-10-06T06:00:00Z", "2026-10-06T10:00:00Z", parcelA, person, "planned");
    await intervention(crypto.randomUUID(), "plowing", "2026-10-07T06:00:00Z", "2026-10-07T09:00:00Z", parcelA, other);
    // Septembre : 1 h 30.
    await intervention(crypto.randomUUID(), "sowing", "2026-09-10T07:00:00Z", "2026-09-10T08:30:00Z", parcelA);
  });
  afterAll(async () => {
    await teardown(sql, farmId, [owner.userId, reader.userId]);
    await sql.end();
  });

  it("résumé : union des plages, chevauchement partagé, prorata par activité", async () => {
    const res = await app.request(`${base()}/people/${person}/work?at=2026-10-08`, { headers: reader.headers });
    expect(res.status).toBe(200);
    const w = await res.json();
    expect(w.periods).toMatchObject({
      week: { from: "2026-10-05", to: "2026-10-12", hours: 6 },
      month: { from: "2026-10-01", to: "2026-11-01", hours: 6 },
      campaign: { label: "Campagne 2026", hours: 7.5 },
      last12: { hours: 7.5 },
    });
    expect(w.byMonth.slice(-2)).toEqual([{ month: "2026-09", hours: 1.5 }, { month: "2026-10", hours: 6 }]);
    // Labour 3 h (4 h dont 2 partagées) + semis 1 h 30 sur le maïs ; hersage 3 h sans activité.
    expect(w.byActivity).toEqual([
      { activityId: mais, name: "Maïs", hours: 4.5 },
      { activityId: null, name: "Sans activité", hours: 3 },
    ]);
    expect(w.byProcedure).toEqual([
      { procedure: "plowing", hours: 3 },
      { procedure: "harrowing", hours: 3 },
      { procedure: "sowing", hours: 1.5 },
    ]);
    const sum = (xs: { hours: number }[]) => xs.reduce((s, x) => s + x.hours, 0);
    expect(sum(w.byActivity)).toBe(w.periods.campaign.hours);
    expect(sum(w.byProcedure)).toBe(w.periods.campaign.hours);
  });

  it("pavés : heures du mois de la frise et dernière intervention réalisée", async () => {
    const items = (await (await app.request(`${base()}/people?at=2026-10-08`, { headers: owner.headers })).json()).items as {
      id: string;
      monthHours: number;
      lastIntervention: { id: string; date: string; procedure: string } | null;
    }[];
    expect(items.find((p) => p.id === person)).toMatchObject({ monthHours: 6, lastIntervention: { id: harrowing, date: "2026-10-05", procedure: "harrowing" } });
    expect(items.find((p) => p.id === other)).toMatchObject({ monthHours: 3 });
    // Avant le labour : la dernière est le semis de septembre.
    const sept = (await (await app.request(`${base()}/people?at=2026-09-30`, { headers: owner.headers })).json()).items as typeof items;
    expect(sept.find((p) => p.id === person)).toMatchObject({ monthHours: 1.5, lastIntervention: { procedure: "sowing", date: "2026-09-10" } });
  });

  it("liste des interventions : les plus récentes d'abord, part d'heures, parcelles, pagination", async () => {
    const page1 = await (await app.request(`${base()}/people/${person}/interventions?from=2026-09-01&to=2026-11-01&limit=2`, { headers: owner.headers })).json();
    expect(page1.items.map((i: { procedure: string; hours: number; parcels: string[] }) => [i.procedure, i.hours, i.parcels])).toEqual([
      ["harrowing", 3, ["Bois"]],
      ["plowing", 3, ["Grande pièce"]],
    ]);
    expect(page1.nextCursor).toBe("2");
    const page2 = await (await app.request(`${base()}/people/${person}/interventions?from=2026-09-01&to=2026-11-01&limit=2&cursor=2`, { headers: owner.headers })).json();
    expect(page2).toEqual({ items: [expect.objectContaining({ procedure: "sowing", hours: 1.5 })], nextCursor: null });
    expect((await app.request(`${base()}/people/${person}/interventions?from=2026-11-01&to=2026-09-01`, { headers: owner.headers })).status).toBe(400);
  });
});
