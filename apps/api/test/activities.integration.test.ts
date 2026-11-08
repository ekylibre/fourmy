import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createDb } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { computeInterventionIft } from "../src/repos/ift.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Activités (lot C des retours du 08/11/2026) : création depuis une
 * production de référence, parcelles d'une campagne, et contrôle phyto qui
 * suit l'activité (maïs, puis jachère : usages « Jachères et cultures
 * intermédiaires »). Référentiel fictif, retiré à la fin.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const PRODUCT = 99_000_101;
const AMM = "9900101";
const CORN = "fourmy_test_corn";
const FALLOW = "fourmy_test_fallow";
const parcelId = crypto.randomUUID();
const articleId = crypto.randomUUID();

describe.skipIf(!url)("activités (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let users: string[] = [];
  let headers: Record<string, string> = {};
  let worker: Record<string, string> = {};
  let base = "";

  beforeAll(async () => {
    const owner = await setupFarm(sql, "Ferme test activités");
    farmId = owner.farmId;
    headers = owner.headers;
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users = [owner.userId, w.userId];
    base = `/api/v1/farms/${farmId}`;
    await sql`INSERT INTO taxonomy (reference_name, parent, rank, label) VALUES
      ('zea_mays', 'zea', 'specie', 'Maïs'), ('zea', 'poaceae', 'genus', 'Maïs'), ('poaceae', 'plant', 'family', 'Poacées'), ('plant', NULL, NULL, 'Plante')
      ON CONFLICT (reference_name) DO NOTHING`;
    await sql`INSERT INTO lexicon_productions (reference_name, family, specie, label, color) VALUES
      (${CORN}, 'plant_farming', 'zea_mays', 'Maïs d''essai', '#F5D33D'), (${FALLOW}, 'plant_farming', 'plant', 'Jachère d''essai', NULL)`;
    await sql`INSERT INTO lexicon_production_ift (production, ift_culture, ift_label, campaign) VALUES (${CORN}, '1112', 'Maïs', 2020)`;
    await sql`INSERT INTO lexicon_pictures (domain, name, extension, picture) VALUES ('varieties', 'fourmy_test', 'png', '\\x89504e47')`;
    await sql`INSERT INTO phyto_products (id, amm, name, natures, state, started_on) VALUES (${PRODUCT}, ${AMM}, 'ACTI TEST', '{Herbicide}', 'authorized', '2015-01-01')`;
    await sql`INSERT INTO phyto_usages (id, product_id, phrase, crop_label, species, target_label, dose_quantity, dose_unit_label, state) VALUES
      ('acti-u1', ${PRODUCT}, 'Maïs*Désherbage', 'Maïs', '{zea_mays}', 'Désherbage fourmy test', 3, 'L/ha', 'authorized'),
      ('acti-u2', ${PRODUCT}, 'Jachères*Désherbage', 'Jachères et cultures intermédiaires', '{plant}', 'Désherbage', 2, 'L/ha', 'authorized'),
      ('acti-u3', ${PRODUCT}, 'Jevi*Désherbage', 'Jevi', '{plant}', 'Désherbage', 5, 'L/ha', 'authorized')`;
    await sql`INSERT INTO phyto_target_pfi (ephy_name, pfi_id, pfi_name, default_treatment_type) VALUES ('Désherbage fourmy test', 999, 'Adventices', 'T21')`;
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcelId}, ${farmId}, 'Le Champ')`;
    await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
      VALUES (${crypto.randomUUID()}, ${parcelId},
              ST_GeomFromText('MULTIPOLYGON(((0.5 44.8,0.5013 44.8,0.5013 44.8009,0.5 44.8009,0.5 44.8)))', 4326), 10287, tstzrange('2020-01-01', NULL))`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${articleId}, ${farmId}, 'Acti', 'phyto', 'Litre', ${AMM})`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql`DELETE FROM phyto_usages WHERE product_id = ${PRODUCT}`;
    await sql`DELETE FROM phyto_products WHERE id = ${PRODUCT}`;
    await sql`DELETE FROM phyto_target_pfi WHERE ephy_name = 'Désherbage fourmy test'`;
    await sql`DELETE FROM lexicon_production_ift WHERE production = ${CORN}`;
    await sql`DELETE FROM lexicon_productions WHERE reference_name IN (${CORN}, ${FALLOW})`;
    await sql`DELETE FROM lexicon_pictures WHERE name = 'fourmy_test'`;
    await sql.end();
  });

  const send = (method: string, path: string, body?: unknown, h = headers) =>
    app.request(`${base}${path}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const check = async () =>
    (
      await (
        await send("POST", "/phyto/check", {
          procedure: "spraying",
          periods: [{ startedAt: "2025-05-10T06:00:00Z", stoppedAt: "2025-05-10T08:00:00Z" }],
          targets: [{ kind: "land_parcel", id: parcelId }],
          inputs: [{ articleId, quantity: 1, per: "hectare" }],
        })
      ).json()
    ).checks[0];

  it("crée une activité depuis la référence, lui donne ses parcelles ; le contrôle suit sa culture", async () => {
    expect((await send("POST", "/activities", { name: "Maïs", family: "plant_farming", reference: CORN }, worker)).status).toBe(403);
    const created = await send("POST", "/activities?year=2025", { name: "Maïs", family: "plant_farming", reference: CORN });
    expect(created.status).toBe(201);
    const corn = await created.json();
    expect(corn).toMatchObject({ name: "Maïs", referenceLabel: "Maïs d'essai", cultivation: "zea_mays", cultivationLabel: "Maïs", color: "#FFFF00", parcelIds: [] }); // zea_mays : Yellow (colors.yml d'Ekylibre)
    expect((await send("POST", "/activities", { name: "Maïs", family: "plant_farming" })).status).toBe(409);

    const withParcels = await (await send("PUT", `/activities/${corn.id}/parcels`, { year: 2025, parcelIds: [parcelId] })).json();
    expect(withParcels).toMatchObject({ parcelIds: [parcelId], areaM2: 10287 });
    const list = await (await send("GET", "/activities?year=2025")).json();
    expect(list.items.map((a: { name: string }) => a.name)).toEqual(["Maïs"]);

    // Maïs : un seul usage possible, retenu d'office.
    const k = await check();
    expect(k.indicators[0]).toMatchObject({ level: "ok", message: "ACTI TEST autorisé sur Maïs." });
    expect(k.usageId).toBe("acti-u1");

    // IFT : la culture vient de la production de référence de l'activité (Lexicon), pas du libellé.
    const id = crypto.randomUUID();
    await send("POST", "/interventions", { id, procedure: "spraying" });
    const done = await send("POST", `/interventions/${id}/complete`, {
      periods: [{ startedAt: "2025-05-10T06:00:00Z", stoppedAt: "2025-05-10T08:00:00Z" }],
      targets: [{ kind: "land_parcel", id: parcelId }],
      inputs: [{ articleId, quantity: 1, per: "hectare" }],
    });
    expect(done.status).toBe(200);
    const calls: string[] = [];
    const fakeIft = (async (input: string | URL) => {
      calls.push(String(input));
      if (String(input).endsWith("/cultures/csv")) return new Response("Code_culture\tLabel_culture\n9999\tAutre\n");
      return Response.json({ ift: 0.3333, segment: { libelle: "Herbicides" }, doseReference: 3, avertissement: null });
    }) as typeof fetch;
    const ift = await computeInterventionIft(createDb(url), farmId, id, fakeIft);
    expect(ift).toMatchObject({ status: "ok", lines: [expect.objectContaining({ ift: 0.3333 })] });
    const call = new URL(calls.find((c) => c.includes("/ift/traitement"))!).searchParams;
    expect(call.get("cultureIdMetier")).toBe("1112");
    // Cible PFI de l'usage retenu et type de traitement de cette cible (comme Ekylibre).
    expect(call.get("cibleIdMetier")).toBe("999");
    expect(call.get("typeTraitementIdMetier")).toBe("T21");

    // La parcelle passe en jachère : usages des jachères (et traitements généraux), pas les Jevi.
    const fallow = await (await send("POST", "/activities?year=2025", { name: "Jachère", family: "plant_farming", reference: FALLOW })).json();
    await send("PUT", `/activities/${corn.id}/parcels`, { year: 2025, parcelIds: [] });
    await send("PUT", `/activities/${fallow.id}/parcels`, { year: 2025, parcelIds: [parcelId] });
    const j = await check();
    expect(j.indicators[0]).toMatchObject({ level: "ok", message: "ACTI TEST autorisé sur Jachère." });
    expect(j.usages.map((u: { id: string }) => u.id)).toEqual(["acti-u2"]);
    expect(j.usageId).toBe("acti-u2");
  });

  it("une activité avec des parcelles ne se supprime pas ; vide, si", async () => {
    const list = await (await send("GET", "/activities?year=2025")).json();
    const fallow = list.items.find((a: { name: string }) => a.name === "Jachère");
    const corn = list.items.find((a: { name: string }) => a.name === "Maïs");
    const refused = await send("DELETE", `/activities/${fallow.id}`);
    expect(refused.status).toBe(422);
    expect((await refused.json()).detail).toMatch(/1 production/);
    expect((await send("DELETE", `/activities/${corn.id}`)).status).toBe(204);
  });

  it("certification AB de la parcelle : produit non utilisable en AB → feu rouge, à la date", async () => {
    const write = { kind: "organic", level: "certified", certifier: "Ecocert", startedOn: "2025-01-01" };
    expect((await send("POST", `/land-parcels/${parcelId}/certifications`, write, worker)).status).toBe(403);
    expect((await send("POST", `/land-parcels/${parcelId}/certifications`, { ...write, stoppedOn: "2024-01-01" })).status).toBe(400);
    const created = await send("POST", `/land-parcels/${parcelId}/certifications`, write);
    expect(created.status).toBe(201);
    const cert = await created.json();
    expect(cert).toMatchObject({ landParcelId: parcelId, kind: "organic", level: "certified", startedOn: "2025-01-01", stoppedOn: null });
    const organic = (await check()).indicators.find((i: { code: string }) => i.code === "organic");
    expect(organic).toMatchObject({ level: "danger", message: "ACTI TEST n'est pas utilisable en agriculture biologique : Le Champ certifiée(s) AB." });
    // Fin de la certification avant le traitement : plus de contrôle AB.
    await send("PUT", `/certifications/${cert.id}`, { ...write, stoppedOn: "2025-03-31" });
    expect((await check()).indicators.some((i: { code: string }) => i.code === "organic")).toBe(false);
    const list = await (await send("GET", "/certifications")).json();
    expect(list.items).toHaveLength(1);
    expect((await send("DELETE", `/certifications/${cert.id}`)).status).toBe(204);
  });

  it("images du référentiel servies sans session, avec cache", async () => {
    const r = await app.request("/api/v1/lexicon/pictures/varieties/fourmy_test");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toMatch(/max-age/);
    expect(Buffer.from(await r.arrayBuffer()).toString("hex")).toBe("89504e47");
    expect((await app.request("/api/v1/lexicon/pictures/secrets/x")).status).toBe(404);
  });
});
