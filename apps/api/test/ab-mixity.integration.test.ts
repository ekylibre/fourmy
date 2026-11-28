import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Mixité AB (R7, issue #166) sur la vraie taxonomie : des PPAM et une prairie
 * à culture générique `plant` ne sont plus une mixité (note sans effet sur le
 * verdict) ; un genre (avena) en AB et une espèce de ce genre (avena_sativa)
 * hors AB, même variété : non conforme.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const square = (x: number) => `MULTIPOLYGON(((${x} 44.8,${x + 0.001} 44.8,${x + 0.001} 44.801,${x} 44.801,${x} 44.8)))`;

describe.skipIf(!url)("mixité AB et cultures génériques (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  const parcels = { ppam: crypto.randomUUID(), prairie: crypto.randomUUID(), avoine: crypto.randomUUID(), noire: crypto.randomUUID() };
  const acts = { ppam: crypto.randomUUID(), prairie: crypto.randomUUID(), avoine: crypto.randomUUID(), noire: crypto.randomUUID() };
  let campaignId = "";
  const r7 = async () => {
    const report = (await (await app.request(`/api/v1/farms/${farm.farmId}/control/ab?campaign=2026`, { headers: farm.headers })).json()) as {
      sections: { findings: { ruleId: string; level: string; message: string }[] }[];
    };
    return report.sections.flatMap((s) => s.findings).filter((f) => f.ruleId === "ab.R7");
  };

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test mixité AB");
    const f = farm.farmId;
    // Taxonomie utile, si la base de test ne l'a pas (CI).
    await sql`INSERT INTO taxonomy (reference_name, parent, rank, label) VALUES
      ('poaceae', NULL, 'family', 'Poacées'), ('avena', 'poaceae', 'genus', 'Avoine'), ('avena_sativa', 'avena', 'specie', 'Avoine cultivée')
      ON CONFLICT (reference_name) DO NOTHING`;
    const [c] = await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${crypto.randomUUID()}, ${f}, 2026, '2026-01-01', '2026-12-31') RETURNING id`;
    campaignId = c!.id;
    await sql`INSERT INTO activities (id, farm_id, name, family, cultivation) VALUES
      (${acts.ppam}, ${f}, 'Plantes médicinales pérennes', 'plant_farming', 'plant'),
      (${acts.prairie}, ${f}, 'Prairie permanente', 'plant_farming', 'plant'),
      (${acts.avoine}, ${f}, 'Avoine', 'plant_farming', 'avena'),
      (${acts.noire}, ${f}, 'Avoine noire d''hiver', 'plant_farming', 'avena_sativa')`;
    let x = 0.7;
    for (const [key, ab] of [
      ["ppam", true],
      ["prairie", false],
      ["avoine", true],
      ["noire", false],
    ] as const) {
      const id = parcels[key];
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${f}, ${`Parcelle ${key}`})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${square(x)}, 4326), 10000, tstzrange('2019-01-01', NULL))`;
      x += 0.002;
      if (ab) await sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, started_on) VALUES (${crypto.randomUUID()}, ${f}, ${id}, 'organic', '2024-01-01')`;
    }
  });
  afterAll(async () => {
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  const produce = async (key: keyof typeof parcels, variety: string | null) =>
    sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id, species, started_on, stopped_on)
        VALUES (${crypto.randomUUID()}, ${farm.farmId}, ${campaignId}, ${parcels[key]}, 'field_crop', ${acts[key]}, ${variety}, '2026-03-01', '2026-08-31')`;

  it("PPAM et prairie en « plant » : plus de mixité, une note « espèce à préciser » (l'issue)", async () => {
    await produce("ppam", null);
    await produce("prairie", null);
    expect(await r7()).toEqual([
      expect.objectContaining({ level: "na", message: "Plantes médicinales pérennes : espèce à préciser sur l'activité pour contrôler la mixité (R7)." }),
    ]);
  });

  it("Avoine (genre) en AB et Avoine noire (espèce) hors AB, même variété : non conforme", async () => {
    await produce("avoine", "Une de Mai");
    await produce("noire", "Une de Mai");
    const mix = (await r7()).find((f) => f.level !== "na")!;
    expect(mix).toMatchObject({ level: "danger" });
    expect(mix.message).toMatch(/^Avoine \(AB\) et Avoine noire d'hiver \(hors AB\) : même variété \(une de mai\)/);
  });
});
