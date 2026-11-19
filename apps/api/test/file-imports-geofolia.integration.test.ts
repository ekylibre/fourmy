import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { pendingImports } from "../src/routes/imports.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Import Geofolia de bout en bout, lot IM2 : dépôt, aperçu avec rapprochement,
 * écriture, réimport sans doublon. Jeu anonymisé tiré d'un export réel
 * (packages/importers/test/fixtures/geofolia-pilote.zip : 6 parcelles,
 * 13 cultures, 215 couples action × parcelle).
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const fixture = readFileSync(join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures", "geofolia-pilote.zip"));

describe.skipIf(!url)("import Geofolia (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };
  const base = () => `/api/v1/farms/${farmId}`;

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test import Geofolia");
    farmId = o.farmId;
    owner = o;
  });
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id = ${farmId}`;
    await teardown(sql, farmId, [owner.userId]);
    await sql.end();
  });

  const upload = async (bytes: Uint8Array, name = "export.zip") => {
    const form = new FormData();
    form.set("file", new File([bytes], name));
    const res = await app.request(`${base()}/imports/files`, { method: "POST", headers: { authorization: owner.headers.authorization! }, body: form });
    expect(res.status).toBeLessThan(300);
    return res.json();
  };
  const apply = async (id: string) => {
    const res = await app.request(`${base()}/imports/${id}/apply`, { method: "POST", headers: owner.headers });
    expect(res.status, await res.clone().text()).toBe(202);
    await Promise.all([...pendingImports]);
    return (await app.request(`${base()}/imports/${id}`, { headers: owner.headers })).json();
  };

  let firstRun: { id: string; report: Record<string, unknown> } | null = null;

  it("aperçu : contenu, rapprochement avec une ferme vide", { timeout: 60_000 }, async () => {
    const run = await upload(fixture);
    expect(run.preview.readable).toBe(true);
    expect(run.preview.counts).toMatchObject({ parcels: 6, productions: 13, workUnits: 215 });
    const r = run.preview.reconciliation;
    expect(r.parcels).toEqual({ create: 6, link: 0, skip: 0 });
    // 13 cultures : 8 productions (dont 2 dérobées), 5 couverts d'interculture (CINE).
    expect(r.productions).toEqual({ create: 8, link: 0 });
    expect(r.covers).toEqual({ create: 5, link: 0, skip: 0 });
    // 2026, et les campagnes passées des cultures N-1…N-5 (historique, lot IM5).
    expect(r.campaigns).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    // Activités des cultures de la campagne ; les autres viennent de l'historique (cultures N-1…N-5).
    expect(r.activities.filter((a: { productions: number }) => a.productions > 0).map((a: { name: string }) => a.name).sort()).toEqual(["Carotte Amsterdam", "Epinard", "Maïs fourrage", "Prairie temporaire"]);
    expect(r.articles.every((a: { action: string }) => a.action === "create")).toBe(true);
    expect(r.interventions.create).toBeGreaterThan(150);
    expect(r.interventions.alreadyImported).toBe(0);
  });

  it("écriture : parcelles, productions, interventions sans heure et sans stock", { timeout: 120_000 }, async () => {
    const [{ id }] = await sql`SELECT id FROM import_runs WHERE farm_id = ${farmId} AND status = 'analyzed'`;
    const done = await apply(id);
    expect(done.status, JSON.stringify(done.report)).toBe("completed");
    firstRun = done;
    const counts = done.report.counts;
    expect(counts.parcels).toEqual({ created: 6, linked: 0, skipped: 0 });
    expect(counts.productions).toEqual({ created: 8, linked: 0, skipped: 0 });
    expect(counts.covers).toEqual({ created: 5, linked: 0, skipped: 0 });
    expect(counts.interventions.failed, JSON.stringify(done.report.failures)).toBe(0);
    expect(counts.interventions.created).toBeGreaterThan(150);

    const [{ n: parcels }] = await sql`SELECT count(*)::int AS n FROM land_parcels WHERE farm_id = ${farmId}`;
    expect(parcels).toBe(6);
    // Cultures secondaires : sur la même parcelle que leur culture principale.
    const [{ n: shared }] = await sql`
      SELECT count(*)::int AS n FROM (SELECT land_parcel_id FROM productions WHERE farm_id = ${farmId} GROUP BY 1 HAVING count(*) > 1) x`;
    expect(shared).toBeGreaterThan(0);
    // Productions datées (semis → récolte) ; couverts CINE non exportés, campagne de la culture qui suit.
    const [{ dated }] = await sql`SELECT count(*)::int AS dated FROM productions WHERE farm_id = ${farmId} AND started_on IS NOT NULL`;
    expect(dated).toBe(8);
    const covers = await sql`SELECT kind, family, exported, campaign, sown_on FROM cover_crops WHERE farm_id = ${farmId}`;
    expect(covers).toHaveLength(5);
    expect(covers.every((c) => c.kind === "sown" && c.exported === false && c.campaign === 2026 && c.family && c.sown_on)).toBe(true);
    const [{ cine }] = await sql`SELECT count(*)::int AS cine FROM activities WHERE farm_id = ${farmId} AND name = 'Mélange CINE'`;
    expect(cine).toBe(0);

    const interventions = await sql`SELECT origin, affects_stock, period_precision, status, procedure FROM interventions WHERE farm_id = ${farmId}`;
    expect(interventions.every((i) => i.origin === "import" && i.affects_stock === false && i.period_precision === "day")).toBe(true);
    expect(interventions.some((i) => i.status === "planned")).toBe(true);
    const [{ n: moves }] = await sql`SELECT count(*)::int AS n FROM stock_movements WHERE farm_id = ${farmId}`;
    expect(moves).toBe(0);

    // Lecture : sans durée de travail ; irrigation en mm ; semis direct.
    const list = await (await app.request(`${base()}/interventions?campaign=2026`, { headers: owner.headers })).json();
    const items = list.items ?? list;
    const watering = items.find((i: { procedure: string }) => i.procedure === "plant_watering");
    expect(watering).toMatchObject({ periodPrecision: "day", workDurationS: null, affectsStock: false });
    expect(watering.irrigation.depthMm).toBeGreaterThan(0);
    expect(items.some((i: { sowing: { technique: string } | null }) => i.sowing?.technique === "direct")).toBe(true);
    // Récolte : sortie sans destination (FR-EVO-5).
    const harvest = items.find((i: { procedure: string; status: string }) => ["harvesting", "grains_harvest"].includes(i.procedure) && i.status === "done");
    expect(harvest.outputs[0].quantity).toBeGreaterThan(0);
  });

  it("réimport du même fichier : rien de créé, tout est relié", { timeout: 120_000 }, async () => {
    const run = await upload(fixture, "copie.zip");
    expect(run.id).not.toBe(firstRun!.id);
    const r = run.preview.reconciliation;
    expect(r.parcels).toEqual({ create: 0, link: 6, skip: 0 });
    expect(r.productions).toEqual({ create: 0, link: 8 });
    expect(r.covers).toEqual({ create: 0, link: 5, skip: 0 });
    expect(r.interventions.create).toBe(0);
    expect(r.interventions.alreadyImported).toBe(215);
    const done = await apply(run.id);
    expect(done.status).toBe("completed");
    expect(done.report.counts.interventions.created).toBe(0);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM land_parcels WHERE farm_id = ${farmId}`;
    expect(n).toBe(6);
  });

  it("refuse d'écrire deux fois le même import, ou un import bloqué", async () => {
    expect((await app.request(`${base()}/imports/${firstRun!.id}/apply`, { method: "POST", headers: owner.headers })).status).toBe(409);
  });
});

/** Fichiers réels (jamais dans le dépôt) : FOURMY_IMPORT_SAMPLES désigne leur dossier. */
const samples = process.env.FOURMY_IMPORT_SAMPLES;
describe.skipIf(!url || !samples || !existsSync(samples ?? ""))("import Geofolia d'un export réel (local)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  let owner: { userId: string; headers: Record<string, string> };

  beforeAll(async () => {
    const o = await setupFarm(sql, "Ferme test export réel");
    farmId = o.farmId;
    owner = o;
  });
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id = ${farmId}`;
    await teardown(sql, farmId, [owner.userId]);
    await sql.end();
  });

  it("importe l'export complet et le rejoue sans doublon", { timeout: 300_000 }, async () => {
    const name = readdirSync(samples!).find((f) => f.toLowerCase().endsWith(".zip"))!;
    const form = new FormData();
    form.set("file", new File([readFileSync(join(samples!, name))], name));
    const started = Date.now();
    const run = await (await app.request(`/api/v1/farms/${farmId}/imports/files`, { method: "POST", headers: { authorization: owner.headers.authorization! }, body: form })).json();
    const analyzedMs = Date.now() - started;
    expect((await app.request(`/api/v1/farms/${farmId}/imports/${run.id}/apply`, { method: "POST", headers: owner.headers })).status).toBe(202);
    await Promise.all([...pendingImports]);
    const done = await (await app.request(`/api/v1/farms/${farmId}/imports/${run.id}`, { headers: owner.headers })).json();
    const dangers = await sql`
      SELECT i.procedure, i.compliance AS products, NULL AS issues, (i.started_at AT TIME ZONE 'Europe/Paris')::date::text AS day,
             (SELECT json_agg(json_build_object('cover', cc.sown_on::text || '→' || coalesce(cc.destroyed_on::text, '?'),
                      'crops', (SELECT json_agg(p.started_on::text || '→' || coalesce(p.stopped_on::text, '?')) FROM productions p WHERE p.land_parcel_id = t.ref_id)))
                FROM intervention_parameters t LEFT JOIN cover_crops cc ON cc.land_parcel_id = t.ref_id
               WHERE t.intervention_id = i.id AND t.role = 'target') AS context
      FROM interventions i WHERE i.farm_id = ${farmId} AND i.compliance->>'level' = 'danger'`;
    console.log(
      JSON.stringify(
        { analyzedMs, totalMs: Date.now() - started, activities: run.preview.reconciliation.activities, interventions: run.preview.reconciliation.interventions, report: done.report, dangers },
        null,
        1,
      ),
    );
    expect(done.status).toBe("completed");
  });
});
