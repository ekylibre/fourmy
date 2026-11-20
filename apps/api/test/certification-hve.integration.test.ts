import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Contrôle HVE, lot CT3 (phyto) : ferme d'essai en Alsace, deux parcelles de
 * grandes cultures certifiées HVE. Herbicide classé CMR2 (n° 2000003 de la
 * liste ministérielle), IFT signé enregistré : items 5.1, 5.2, 5.3 ; feu de
 * saisie CMR2.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const treated = crypto.randomUUID();
const untreated = crypto.randomUUID();
const herbicide = crypto.randomUUID();
const spraying = crypto.randomUUID();

describe.skipIf(!url)("contrôle HVE phyto (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let users: string[] = [];
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test HVE");
    farmId = owner.farmId;
    headers = owner.headers;
    users = [owner.userId];
    await sql`UPDATE farm_sites SET insee_code = '67482', updated_at = now() WHERE farm_id = ${farmId} AND is_headquarters`;
    const [c] = await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${crypto.randomUUID()}, ${farmId}, 2026, '2026-01-01', '2026-12-31')
      ON CONFLICT DO NOTHING RETURNING id`;
    const campaignId = c?.id ?? (await sql`SELECT id FROM campaigns WHERE farm_id = ${farmId} AND year = 2026`)[0]!.id;
    for (const [id, name] of [[treated, "Champ traité"], [untreated, "Champ sans traitement"]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText('MULTIPOLYGON(((7.5 48.5,7.51 48.5,7.51 48.509,7.5 48.509,7.5 48.5)))', 4326), 100000, tstzrange('2020-01-01', NULL))`;
      await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature) VALUES (${crypto.randomUUID()}, ${farmId}, ${campaignId}, ${id}, 'field_crop')`;
      await sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, level, started_on) VALUES (${crypto.randomUUID()}, ${farmId}, ${id}, 'hve', '3', '2025-01-01')`;
    }
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${herbicide}, ${farmId}, 'SULTAN', 'phyto', 'Litre', '2000003')`;
    // Herbicide réalisé, IFT certifié par l'API (2 sur la parcelle traitée).
    await sql`INSERT INTO interventions (id, farm_id, procedure, status, origin, started_at, stopped_at, ift) VALUES (${spraying}, ${farmId}, 'spraying', 'done', 'web', '2026-04-10T08:00:00Z', '2026-04-10T10:00:00Z',
      ${sql.json({ status: "ok", total: 2, computedAt: "2026-04-10T12:00:00Z", error: null, lines: [{ articleId: herbicide, parcelId: treated, ift: 2, segment: "Herbicides", segmentCode: "S3", doseReference: 1, warning: null, certifiedId: "x", signature: "jwt" }] })})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id) VALUES (${crypto.randomUUID()}, ${spraying}, 'target', 'land_parcel', ${treated})`;
    await sql`INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit) VALUES (${crypto.randomUUID()}, ${spraying}, 'input', 'article', ${herbicide}, 1.5, 'Litre_per_hectare')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql.end();
  });

  const json = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(res.status, await res.clone().text()).toBe(200);
    return res.json();
  };

  it("rapport : CMR2 (1 point), 50 % non traité (5 points), IFT d'Alsace × part de SAU, items déclaratifs à remplir", async () => {
    const report = await json("GET", "/control/hve?campaign=2026");
    const phyto = report.sections.find((s: { id: string }) => s.id === "phyto");
    const item = (id: string) => phyto.findings.find((f: { ruleId: string }) => f.ruleId === id);
    expect(item("hve.5.1")).toMatchObject({ level: "ok", points: { got: 1, max: 2 } });
    expect(item("hve.5.2")).toMatchObject({ value: 50, points: { got: 5, max: 10 } });
    // Herbicides : 2 × 10 ha / 20 ha = 1 ≤ plancher 1 → 5 ; hors herbicides 0 → 5 ; toute la SAU en grandes cultures : 10.
    expect(item("hve.5.3")).toMatchObject({ level: "ok", points: { got: 10, max: 10 } });
    expect(item("hve.5.5")).toMatchObject({ level: "missing" });
    // 1 + 5 + 10 = 16 ≥ 10 : conforme, items déclaratifs « à vérifier ».
    expect(phyto).toMatchObject({ level: "warning", points: { got: 16, min: 10 } });
  });

  it("réglage : notation IFT « ancienne » ; saisie : herbicide CMR2 en orange", async () => {
    await json("PUT", "/settings/certification", { hveIftScale: "old" });
    const phyto = (await json("GET", "/control/hve?campaign=2026")).sections.find((s: { id: string }) => s.id === "phyto");
    expect(phyto.findings.find((f: { ruleId: string }) => f.ruleId === "hve.5.3").message).toMatch(/plafond 1,67/);
    const r = await json("POST", "/control/check", {
      procedure: "spraying",
      periods: [{ startedAt: "2026-05-02T08:00:00Z", stoppedAt: "2026-05-02T09:00:00Z" }],
      targets: [{ kind: "land_parcel", id: untreated }],
      inputs: [{ articleId: herbicide, quantity: 1, per: "hectare" }],
    });
    expect(r.check).toMatchObject({ level: "warning", findings: [{ ruleId: "hve.5.1", level: "warning" }] });
    expect(r.check.findings[0].message).toMatch(/SULTAN est classé CMR2/);
  });
});
