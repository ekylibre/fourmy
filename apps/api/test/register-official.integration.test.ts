import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { addMember, ensurePhytoReferential, setupFarm, teardown } from "./helpers.js";

/**
 * Registre phyto au format réglementaire (lot X) : SIRET de la ferme,
 * culture OEPP de l'activité (proposée puis choisie), stade BBCH, bio,
 * zone travaillée, exports CSV et JSON, anomalies.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("registre phyto réglementaire (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const ids = {
    vines: crypto.randomUUID(),
    meadow: crypto.randomUUID(),
    vineActivity: crypto.randomUUID(),
    meadowActivity: crypto.randomUUID(),
    product: crypto.randomUUID(),
    hangar: crypto.randomUUID(),
    lot: crypto.randomUUID(),
    campaign: crypto.randomUUID(),
    intervention: crypto.randomUUID(),
  };
  let farmId = "";
  let userId = "";
  let headers: Record<string, string> = {};
  let worker: { userId: string; headers: Record<string, string> };
  let base = "";
  const send = (method: string, path: string, body?: unknown, h = headers) =>
    app.request(`${base}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    await ensurePhytoReferential(sql);
    ({ farmId, userId, headers } = await setupFarm(sql, "Ferme test registre réglementaire"));
    worker = await addMember(sql, farmId, "worker");
    base = `/api/v1/farms/${farmId}`;
    for (const [id, name, x] of [[ids.vines, "Les Vignes", 0.5], [ids.meadow, "Le Pré", 0.51]] as const) {
      await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${id}, ${farmId}, ${name})`;
      await sql`INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, valid)
        VALUES (${crypto.randomUUID()}, ${id}, ST_GeomFromText(${`MULTIPOLYGON(((${x} 44.8,${x + 0.0013} 44.8,${x + 0.0013} 44.8009,${x} 44.8009,${x} 44.8)))`}, 4326), 10000, tstzrange('2026-01-01', NULL))`;
    }
    await sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on) VALUES (${ids.campaign}, ${farmId}, 2026, '2026-01-01', '2026-12-31')`;
    // Production de référence Lexicon de la vigne (base vierge en CI : rien n'est chargé ;
    // une base de développement a déjà la vraie ligne, gardée telle quelle).
    await sql`INSERT INTO lexicon_productions (reference_name, family, specie, usage, label)
      VALUES ('vine', 'vine_farming', 'vitis', 'fruit', 'Vigne') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO activities (id, farm_id, name, family, reference) VALUES
      (${ids.vineActivity}, ${farmId}, 'Vignes AOP', 'vine_farming', 'vine'),
      (${ids.meadowActivity}, ${farmId}, 'Prairie temporaire', 'plant_farming', NULL)`;
    await sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, species, activity_id) VALUES
      (${crypto.randomUUID()}, ${farmId}, ${ids.campaign}, ${ids.vines}, 'vine', 'CABERNET-SAUVIGNON N', ${ids.vineActivity}),
      (${crypto.randomUUID()}, ${farmId}, ${ids.campaign}, ${ids.meadow}, 'grassland', 'lolium_perenne', ${ids.meadowActivity})`;
    await sql`INSERT INTO parcel_certifications (id, farm_id, land_parcel_id, kind, started_on) VALUES (${crypto.randomUUID()}, ${farmId}, ${ids.vines}, 'organic', '2020-01-01')`;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, amm) VALUES (${ids.product}, ${farmId}, 'Cuivre test', 'phyto', 'kilogram', '2150537')`;
    await sql`INSERT INTO places (id, farm_id, name) VALUES (${ids.hangar}, ${farmId}, 'Hangar')`;
    await sql`INSERT INTO place_versions (id, place_id, kind, source, valid) VALUES (${crypto.randomUUID()}, ${ids.hangar}, 'building', 'manual', tstzrange('2000-01-01', NULL))`;
    await sql`INSERT INTO lots (id, farm_id, article_id, code) VALUES (${ids.lot}, ${farmId}, ${ids.product}, 'LOT')`;
    await sql`INSERT INTO stock_movements (id, farm_id, lot_id, place_id, quantity, unit, occurred_at, cause)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${ids.lot}, ${ids.hangar}, 1000, 'kilogram', '2026-01-02', 'purchase')`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, [userId, worker.userId]);
    await sql.end();
  });

  it("SIRET et PACAGE : écriture responsable, formats contrôlés", async () => {
    expect((await send("PUT", "/settings/identity", { siret: "123", pacage: null })).status).toBe(400);
    expect((await send("PUT", "/settings/identity", { siret: "12345678900011", pacage: null }, worker.headers)).status).toBe(403);
    expect(await (await send("PUT", "/settings/identity", { siret: "12345678900011", pacage: "032123456" })).json()).toEqual({ siret: "12345678900011", pacage: "032123456" });
    expect(await (await send("GET", "/settings/identity", undefined, worker.headers)).json()).toEqual({ siret: "12345678900011", pacage: "032123456" });
  });

  it("référentiels : cultures et stades BBCH de la culture", async () => {
    const crops = (await (await send("GET", "/reference/phyto-crops")).json()).items as { code: string; oepp: string }[];
    expect(crops.length).toBeGreaterThan(300);
    expect(crops.find((c) => c.code === "27001")).toMatchObject({ oepp: "VITVI" });
    const stages = (await (await send("GET", "/reference/bbch?crop=27001")).json()).items as { code: string; label: string }[];
    expect(stages.find((s) => s.code === "SP_27001_57")).toMatchObject({ label: "BBCH 57" });
  });

  it("lignes du registre : intitulés, culture OEPP, BBCH, bio, zone travaillée, dose ramenée à l'hectare", async () => {
    const common = {
      targets: [
        { kind: "land_parcel", id: ids.vines, workedAreaM2: 7500 },
        { kind: "land_parcel", id: ids.meadow },
      ],
      inputs: [{ articleId: ids.product, quantity: 7, per: "total" }],
      purposes: ["fungicide"],
    };
    expect((await send("POST", "/interventions", { id: ids.intervention, procedure: "spraying", plannedAt: "2026-06-10T06:00:00Z", ...common })).status).toBe(201);
    const done = await send("POST", `/interventions/${ids.intervention}/complete`, {
      ...common,
      bbch: "SP_27001_57",
      periods: [{ startedAt: "2026-06-10T06:05:00Z", stoppedAt: "2026-06-10T08:40:00Z" }],
    });
    expect(done.status, await done.clone().text()).toBe(200);
    const sheet = await (await send("GET", `/interventions/${ids.intervention}`)).json();
    expect(sheet.intervention?.bbch ?? sheet.bbch).toEqual({ code: "SP_27001_57", label: "BBCH 57" });
    expect((await send("POST", "/interventions", { procedure: "spraying", plannedAt: "2026-06-11T06:00:00Z", bbch: "SP_INCONNU", ...common })).status).toBe(422);

    const register = await (await send("GET", "/registers/phyto/official?campaign=2026", undefined, worker.headers)).json();
    expect(register.holder).toMatchObject({ siret: "12345678900011", pacage: "032123456" });
    expect(register.lines).toHaveLength(2);
    const [vines, meadow] = [...register.lines].sort((a: { surfaceTraitee: string }, b: { surfaceTraitee: string }) => a.surfaceTraitee.localeCompare(b.surfaceTraitee));
    expect(vines).toMatchObject({
      idIntervention: ids.intervention,
      siretApplicateur: "12345678900011",
      nomProduit: "Cuivre test",
      numeroAMMProduit: "2150537",
      dateIntervention: "10/06/2026",
      heureDebut: "08:05",
      heureFin: "10:40",
      doseProduitValeur: "4", // 7 kg sur 1,75 ha
      doseProduitUnite: "kg/ha",
      surfaceTraitee: "0.75", // zone travaillée
      cultureOepp: "VITVI",
      codeBbch: "BBCH 57",
      modeDeConduite: "Oui",
      modeApplication: "Pulvérisation",
      partSurfaceTraitee: "75",
      anomalies: [],
    });
    expect(vines.coordonneesGps).toMatch(/^44\.800\d\d ; 0\.500\d\d$/);
    // Pré : toute la parcelle, pas de culture proposée (« Prairie temporaire »).
    expect(meadow).toMatchObject({ surfaceTraitee: "1.00", cultureOepp: "", modeDeConduite: "Non", partSurfaceTraitee: "100", anomalies: ["cultureOepp"] });
  });

  it("culture choisie sur l'activité : proposée sinon, refus d'un code inconnu", async () => {
    const list = (await (await send("GET", "/activities?year=2026")).json()).items as { id: string; crop: unknown }[];
    expect(list.find((a) => a.id === ids.vineActivity)?.crop).toEqual({ code: "27001", label: "Vigne", oepp: "VITVI", proposed: true });
    expect(list.find((a) => a.id === ids.meadowActivity)?.crop).toBeNull();
    const body = { name: "Prairie temporaire", family: "plant_farming", cropCode: "53001" };
    expect((await send("PUT", `/activities/${ids.meadowActivity}?year=2026`, { ...body, cropCode: "00000" })).status).toBe(400);
    const res = await send("PUT", `/activities/${ids.meadowActivity}?year=2026`, body);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).crop).toEqual({ code: "53001", label: "Ray Grass", oepp: "LOLPE", proposed: false });
    const lines = (await (await send("GET", "/registers/phyto/official?campaign=2026")).json()).lines as { cultureOepp: string; anomalies: string[] }[];
    expect(lines.every((l) => l.anomalies.length === 0)).toBe(true);
    expect(lines.map((l) => l.cultureOepp).sort()).toEqual(["LOLPE", "VITVI"]);
  });

  it("exports : CSV aux intitulés standard, JSON complet avec champs d'enquête", async () => {
    const bytes = new Uint8Array(await (await send("GET", "/registers/phyto/official?campaign=2026&format=csv")).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 (tableurs)
    const csv = new TextDecoder().decode(bytes);
    expect(csv.startsWith("idTraitement;idIntervention;siretApplicateur;siretBeneficiaire;nomProduit;numeroAMMProduit;")).toBe(true);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    const res = await send("GET", "/registers/phyto/official?campaign=2026&format=export");
    expect(res.headers.get("content-disposition")).toContain("registre-phyto-reglementaire-2026.json");
    const json = JSON.parse(await res.text());
    expect(json.detenteur).toMatchObject({ siret: "12345678900011", pacage: "032123456" });
    expect(json.traitements[0]).toHaveProperty("campagne", "2026");
    expect(json.traitements[0]).not.toHaveProperty("anomalies");
    expect(json.traitements[0]).not.toHaveProperty("links");
  });
});
