import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { createDb } from "@fourmy/db";
import { computeInterventionIft } from "../src/repos/ift.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Réglementation phytosanitaire (lot 2) de bout en bout côté API : un
 * produit E-Phy fictif (identifiants réservés, retirés à la fin), une
 * parcelle de maïs longée par un ruisseau, et les feux qui en découlent.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const PRODUCT = 99_000_001;
const AMM = "9900001";
const parcelId = crypto.randomUUID();
const herbicideId = crypto.randomUUID();
const noAmmId = crypto.randomUUID();
const hangarId = crypto.randomUUID();

describe.skipIf(!url)("réglementation phyto (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let base = "";
  let insertedPackage = false;

  beforeAll(async () => {
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test phyto"));
    base = `/api/v1/farms/${farmId}`;
    // Référentiel : produit herbicide sur maïs (dose max 3 L/ha, ZNT 20 m, DAR 30 j, 1 application).
    const [pkg] = await sql`SELECT 1 FROM lexicon_packages WHERE name = 'phytosanitary'`;
    if (!pkg) {
      await sql`INSERT INTO lexicon_packages (name, version, source, rows) VALUES ('phytosanitary', 'test-fourmy', 'test', 0)`;
      insertedPackage = true;
    }
    await sql`INSERT INTO taxonomy (reference_name, parent, rank, label) VALUES
      ('zea_mays', 'zea', 'specie', 'Maïs'), ('zea', 'poaceae', 'genus', 'Maïs'), ('poaceae', 'plant', 'family', 'Poacées'), ('plant', NULL, NULL, 'Plante')
      ON CONFLICT (reference_name) DO NOTHING`;
    await sql`INSERT INTO phyto_products (id, amm, name, other_names, natures, reentry_delay_hours, state, started_on)
      VALUES (${PRODUCT}, ${AMM}, 'HERBI TEST', '{"HERBI BIS"}', '{Herbicide}', 6, 'authorized', '2015-01-01')`;
    await sql`INSERT INTO phyto_usages (id, product_id, phrase, crop_label, species, target_label, dose_quantity, dose_unit_label,
                                        pre_harvest_delay_days, applications_count, untreated_buffer_aquatic, state)
      VALUES ('test-u1', ${PRODUCT}, 'Maïs*Désherbage', 'Maïs', '{zea_mays}', 'Désherbage', 3, 'L/ha', 30, 1, 20, 'authorized'),
             ('test-u2', ${PRODUCT}, 'Maïs*Graminées', 'Maïs', '{zea}', 'Graminées', 3, 'L/ha', 30, NULL, 50, 'authorized')`;
    // Parcelle de ~1 ha (maïs 2025), un ruisseau à ~28 m de son bord est, un fossé qui la traverse.
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Le Long du Ruisseau')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10287, tstzrange('2024-01-01', NULL))`;
    const campaignId = crypto.randomUUID();
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${campaignId}, ${farmId}, 2025, '2025-01-01', '2025-12-31')`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species, cultivation)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${campaignId}, ${parcelId}, 'field_crop', 'DKC5196', 'zea_mays')`;
    await sql`INSERT INTO water_items (id, farm_id, kind, nature, name, permanent, ditch, geom)
      VALUES ('TEST-RUISSEAU', ${farmId}, 'line', 'Ecoulement naturel', 'Ruisseau d''essai', true, false,
              ST_GeomFromText('LINESTRING(0.50165 44.7995, 0.50165 44.8015)', 4326)),
             ('TEST-FOSSE', ${farmId}, 'line', 'Fossé', NULL, false, true,
              ST_GeomFromText('LINESTRING(0.5005 44.7995, 0.5005 44.8015)', 4326))`;
    await sql`INSERT INTO water_syncs (farm_id, bounds, items) VALUES (${farmId}, ST_MakeEnvelope(0.49, 44.79, 0.51, 44.81, 4326), 2)`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES
      (${herbicideId}, ${farmId}, 'Herbi Bis', 'phyto', 'Litre', ${AMM}),
      (${noAmmId}, ${farmId}, 'Préparation maison', 'phyto', 'Litre', NULL)`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${hangarId}, ${farmId}, 'Hangar')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId]);
    await sql`DELETE FROM phyto_usages WHERE product_id = ${PRODUCT}`;
    await sql`DELETE FROM phyto_products WHERE id = ${PRODUCT}`;
    if (insertedPackage) await sql`DELETE FROM lexicon_packages WHERE version = 'test-fourmy'`;
    await sql.end();
  });

  const post = (path: string, body: unknown) => app.request(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const spraying = (dose: number, extra: object = {}) => ({
    procedure: "spraying",
    periods: [{ startedAt: "2025-05-10T06:00:00Z", stoppedAt: "2025-05-10T08:00:00Z" }],
    targets: [{ kind: "land_parcel", id: parcelId }],
    inputs: [{ articleId: herbicideId, quantity: dose, per: "hectare" }],
    ...extra,
  });
  const indicators = (r: { checks: { indicators: { code: string; level: string; message: string }[] }[] }) =>
    Object.fromEntries(r.checks[0]!.indicators.map((i) => [i.code, i]));

  it("contrôle conforme : autorisé sur maïs, dose sous le maximum, ZNT respectée (le fossé ne compte pas)", async () => {
    const r = await (await post("/phyto/check", spraying(2, { compliance: { usages: { [herbicideId]: "test-u1" } } }))).json();
    const k = indicators(r);
    expect(k.authorization).toMatchObject({ level: "ok", message: "HERBI TEST autorisé sur Maïs." });
    expect(k.dose).toMatchObject({ level: "ok", message: "Dose 2 L/ha, maximum 3 L/ha." });
    expect(k.znt.level).toBe("ok");
    expect(k.znt.message).toMatch(/ZNT de 20 m respectée \(eau la plus proche à 2[5-9] m de Le Long du Ruisseau\)/);
    expect(k.applications).toMatchObject({ level: "ok" });
    expect(r.checks[0].usages.map((u: { id: string }) => u.id)).toEqual(["test-u2", "test-u1"].sort());
    expect(k.dar.message).toMatch(/récolte possible à partir du 09\/06\/2025/);
    expect(k.reentry.level).toBe("info");
    expect(r.level).toBe("info");
  });

  it("sans cible précisée, la ZNT la plus stricte des usages possibles (50 m) ; dose trop forte → feux rouges", async () => {
    const r = await (await post("/phyto/check", spraying(4))).json();
    const k = indicators(r);
    expect(k.dose).toMatchObject({ level: "danger", message: expect.stringMatching(/^Dose 4 L\/ha au-dessus du maximum autorisé \(3 L\/ha\) \(cible non précisée/) });
    expect(k.znt.level).toBe("danger");
    expect(k.znt.message).toMatch(/ZNT de 50 m non respectée : Le Long du Ruisseau à 2\d m de « Ruisseau d'essai »/);
    // Une zone de travail loin du ruisseau (moitié ouest) respecte même 50 m.
    const west = { type: "Polygon", coordinates: [[[0.5, 44.8], [0.5004, 44.8], [0.5004, 44.8009], [0.5, 44.8009], [0.5, 44.8]]] };
    const far = await (await post("/phyto/check", spraying(2, { targets: [{ kind: "land_parcel", id: parcelId, workingZone: west }] }))).json();
    expect(indicators(far).znt.level).toBe("ok");
  });

  it("produit sans n° AMM : orange, à rattacher", async () => {
    const r = await (await post("/phyto/check", spraying(1, { inputs: [{ articleId: noAmmId, quantity: 1, per: "hectare" }] }))).json();
    expect(r.checks[0]).toMatchObject({ level: "warning", indicators: [expect.objectContaining({ message: expect.stringMatching(/pas de n° AMM/) })] });
  });

  it("réaliser avec un feu rouge : refusé sans motif, accepté avec, contrôle et motif enregistrés", async () => {
    const id = crypto.randomUUID();
    expect((await post("/interventions", { id, procedure: "spraying" })).status).toBe(201);
    const refused = await post(`/interventions/${id}/complete`, spraying(4));
    expect(refused.status).toBe(422);
    expect((await refused.json()).detail).toMatch(/Feu rouge réglementaire : Dose 4 L\/ha.*indiquez un motif/);

    const ok = await post(`/interventions/${id}/complete`, spraying(4, { compliance: { usages: { [herbicideId]: "test-u1" }, reason: "Dose d'attaque validée par le conseiller" } }));
    expect(ok.status).toBe(200);
    const saved = (await ok.json()).intervention;
    expect(saved.compliance).toMatchObject({ level: "danger", reason: "Dose d'attaque validée par le conseiller", checks: [expect.objectContaining({ usageId: "test-u1" })] });

    // Une deuxième application dans la campagne dépasse le maximum (1).
    const second = await (
      await post("/phyto/check", spraying(2, { periods: [{ startedAt: "2025-06-20T06:00:00Z", stoppedAt: "2025-06-20T07:00:00Z" }], compliance: { usages: { [herbicideId]: "test-u1" } } }))
    ).json();
    expect(indicators(second).applications).toMatchObject({ level: "danger", message: expect.stringMatching(/Plus de 1 application\(s\).*\(2e\)/) });
  });

  it("rattacher un article à son n° AMM ; un n° inconnu est refusé", async () => {
    const bad = await app.request(`${base}/articles/${noAmmId}/amm`, { method: "PATCH", headers, body: JSON.stringify({ amm: "0000000" }) });
    expect(bad.status).toBe(400);
    const ok = await app.request(`${base}/articles/${noAmmId}/amm`, { method: "PATCH", headers, body: JSON.stringify({ amm: AMM }) });
    expect(ok.status).toBe(200);
    const status = await (await app.request(`${base}/phyto/status`, { headers })).json();
    expect(status.articles).toMatchObject({ phyto: 2, linked: 2, withoutAmm: 0 });
    expect(status.water.items).toBe(2);
    const found = await (await app.request(`${base}/phyto/products?q=herbi%20bis`, { headers })).json();
    expect(found.items.map((p: { amm: string }) => p.amm)).toContain(AMM);
  });

  it("IFT : appel à l'API du ministère (simulée), corrigé de la part traitée ; API indisponible → en attente", async () => {
    const id = crypto.randomUUID();
    await post("/interventions", { id, procedure: "spraying" });
    await post(`/interventions/${id}/complete`, spraying(2, { periods: [{ startedAt: "2025-07-01T06:00:00Z", stoppedAt: "2025-07-01T07:00:00Z" }], compliance: { usages: {}, reason: "essai" } }));
    const calls: string[] = [];
    const fakeIft = (async (input: string | URL) => {
      const u = String(input);
      calls.push(u);
      if (u.endsWith("/cultures/csv")) return new Response("Code_culture\tLabel_culture\tCode_groupe_culture\n1112\tMaïs\tGCU1\n");
      return Response.json({ ift: 0.6667, segment: { libelle: "Herbicides" }, doseReference: 3, avertissement: null });
    }) as typeof fetch;
    const db = createDb(url);
    const r = await computeInterventionIft(db, farmId, id, fakeIft);
    expect(r).toMatchObject({ status: "ok", total: 0.667, lines: [expect.objectContaining({ ift: 0.6667, segment: "Herbicides", doseReference: 3 })] });
    const call = new URL(calls.find((c) => c.includes("/ift/traitement"))!);
    expect(Object.fromEntries(call.searchParams)).toMatchObject({ campagneIdMetier: "2025", numeroAmmIdMetier: AMM, cultureIdMetier: "1112", typeTraitementIdMetier: "T21", uniteIdMetier: "U3", dose: "2" });

    const down = (async () => new Response("indisponible", { status: 503 })) as unknown as typeof fetch;
    const pending = await computeInterventionIft(db, farmId, id, down);
    expect(pending).toMatchObject({ status: "pending", lines: [], error: expect.stringMatching(/503/), retryAt: expect.any(String) });
  });
});
