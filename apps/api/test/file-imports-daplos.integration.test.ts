import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { pendingImports } from "../src/routes/imports.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Import DAPLOS, lot IM4 : DAPLOS seul, puis dédoublonnage avec Geofolia dans
 * les deux ordres (US-IMP-2). Jeux anonymisés tirés des exports réels d'une
 * même ferme : 13 cultures (6 parcelles), 185 couples intervention × parcelle
 * DAPLOS, tous présents parmi les 215 de Geofolia (les 30 autres sont des
 * apports du plan de fumure, absents du DAPLOS).
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const fixtures = join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures");
const daplos = readFileSync(join(fixtures, "daplos-pilote.dap"));
const geofolia = readFileSync(join(fixtures, "geofolia-pilote.zip"));

type Farm = { farmId: string; userId: string; headers: Record<string, string> };

const importFile = async (farm: Farm, bytes: Uint8Array, name: string) => {
  const form = new FormData();
  form.set("file", new File([bytes], name));
  const res = await app.request(`/api/v1/farms/${farm.farmId}/imports/files`, { method: "POST", headers: { authorization: farm.headers.authorization! }, body: form });
  const run = await res.json();
  expect(res.status, JSON.stringify(run)).toBeLessThan(300);
  const applied = await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}/apply`, { method: "POST", headers: farm.headers });
  expect(applied.status, await applied.clone().text()).toBe(202);
  await Promise.all([...pendingImports]);
  const done = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}`, { headers: farm.headers })).json();
  expect(done.status, JSON.stringify(done.report)).toBe("completed");
  return { preview: run.preview, done };
};

/** État de la ferme comparé entre les deux ordres d'import. */
async function stateOf(sql: postgres.Sql, farmId: string) {
  const [s] = await sql`
    SELECT (SELECT count(*) FROM land_parcels WHERE farm_id = ${farmId})::int AS parcels,
           (SELECT count(*) FROM productions WHERE farm_id = ${farmId})::int AS productions,
           (SELECT count(*) FROM cover_crops WHERE farm_id = ${farmId})::int AS covers,
           (SELECT count(*) FROM import_links WHERE farm_id = ${farmId} AND namespace = 'agri.crop_zone')::int AS couples,
           (SELECT count(*) FROM interventions WHERE farm_id = ${farmId} AND origin = 'import')::int AS interventions`;
  return s!;
}

describe.skipIf(!url)("import DAPLOS (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const farms: Farm[] = [];

  beforeAll(async () => {
    farms.push(
      await setupFarm(sql, "Ferme test DAPLOS seul"),
      await setupFarm(sql, "Ferme test Geofolia puis DAPLOS"),
      await setupFarm(sql, "Ferme test DAPLOS puis Geofolia"),
    );
  });
  afterAll(async () => {
    for (const f of farms) {
      await sql`DELETE FROM import_runs WHERE farm_id = ${f.farmId}`;
      await teardown(sql, f.farmId, [f.userId]);
    }
    await sql.end();
  });

  it("DAPLOS seul : parcelles, cultures, couverts, interventions, exploitation et siège", { timeout: 180_000 }, async () => {
    const farm = farms[0]!;
    const { preview, done } = await importFile(farm, daplos, "export.dap");
    expect(preview.readable).toBe(true);
    expect(preview.format).toBe("daplos");
    expect(preview.farm.identity).toMatchObject({ siret: "40000000000003", pacage: "040000003", name: "GAEC PILOTE TEST" });
    expect(preview.reconciliation.parcels).toEqual({ create: 6, link: 0, skip: 0 });
    expect(preview.reconciliation.covers).toMatchObject({ create: 5 });
    expect(done.report.counts.parcels.created).toBe(6);
    expect(done.report.counts.covers.created).toBe(5);
    expect(done.report.counts.interventions.failed).toBe(0);
    expect(done.report.counts.interventions.created).toBeGreaterThan(50);
    // Laissés de côté, dans les deux formats : semis sans semence, fertilisations sans fertilisant.
    expect(preview.reconciliation.interventions.skipped.every((x: { reason: string }) => /demande au moins/.test(x.reason))).toBe(true);

    const [f] = await sql`SELECT siret, pacage, legal_name FROM farms WHERE id = ${farm.farmId}`;
    expect(f).toEqual({ siret: "40000000000003", pacage: "040000003", legal_name: "GAEC PILOTE TEST" });
    const [hq] = await sql`SELECT address_line1, postal_code, city FROM farm_sites WHERE farm_id = ${farm.farmId} AND is_headquarters`;
    expect(hq).toEqual({ address_line1: "LE BOURG", postal_code: "00000", city: "Commune test" });
    // Doses par hectare du fichier : chaque intervention d'intrant en porte.
    const [{ n: withoutDose }] = await sql`
      SELECT count(*)::int AS n FROM intervention_parameters p JOIN interventions i ON i.id = p.intervention_id
      WHERE i.farm_id = ${farm.farmId} AND p.role = 'input' AND (p.quantity IS NULL OR p.quantity <= 0)`;
    expect(withoutDose).toBe(0);
  });

  it("DAPLOS réimporté : rien de créé", { timeout: 120_000 }, async () => {
    const farm = farms[0]!;
    const { preview, done } = await importFile(farm, Buffer.concat([daplos, Buffer.from("\r\n")]), "copie.dap");
    expect(preview.reconciliation.parcels).toEqual({ create: 0, link: 6, skip: 0 });
    expect(preview.reconciliation.interventions.create).toBe(0);
    const [{ n: linked }] = await sql`SELECT count(*)::int AS n FROM import_links WHERE farm_id = ${farm.farmId} AND namespace = 'agri.crop_zone'`;
    expect(preview.reconciliation.interventions.alreadyImported).toBe(linked);
    expect(linked).toBeGreaterThan(150);
    expect(done.report.counts.interventions.created).toBe(0);
  });

  it("Geofolia puis DAPLOS, DAPLOS puis Geofolia : même ferme à l'arrivée", { timeout: 300_000 }, async () => {
    const [gd, dg] = [farms[1]!, farms[2]!];

    await importFile(gd, geofolia, "export.zip");
    const second = await importFile(gd, daplos, "export.dap");
    // Le DAPLOS n'apporte rien : tout y est déjà (même terre, même culture, mêmes couples).
    expect(second.preview.reconciliation.parcels).toEqual({ create: 0, link: 6, skip: 0 });
    expect(second.preview.reconciliation.productions.create).toBe(0);
    expect(second.preview.reconciliation.covers).toMatchObject({ create: 0 });
    expect(second.preview.reconciliation.interventions.create).toBe(0);
    expect(second.preview.reconciliation.interventions.alreadyImported).toBeGreaterThan(150);
    expect(second.done.report.counts.interventions.created).toBe(0);

    const first = await importFile(dg, daplos, "export.dap");
    const then = await importFile(dg, geofolia, "export.zip");
    // Geofolia complète : seuls les 30 apports du plan de fumure sont nouveaux.
    expect(then.preview.reconciliation.parcels).toEqual({ create: 0, link: 6, skip: 0 });
    expect(then.preview.reconciliation.productions.create).toBe(0);
    // Couples que Geofolia décrit avec leurs intrants et que le DAPLOS laissait vides : importés maintenant.
    expect(then.preview.reconciliation.interventions.alreadyImported).toBeLessThanOrEqual(second.preview.reconciliation.interventions.alreadyImported);
    expect(then.done.report.counts.interventions.created).toBeGreaterThan(0);
    expect(first.done.report.counts.interventions.created).toBeGreaterThan(0);

    const a = await stateOf(sql, gd.farmId);
    const b = await stateOf(sql, dg.farmId);
    expect({ ...a, interventions: undefined }).toEqual({ ...b, interventions: undefined });
    expect(a.couples).toBeGreaterThan(180);
    // DAPLOS n'a pas d'identifiant d'action : des couples que Geofolia sépare (même jour, même
    // opération, mêmes doses) y forment une seule intervention. Jamais plus d'interventions.
    expect(b.interventions).toBeLessThanOrEqual(a.interventions);
  });
});

/** Fichiers réels (jamais dans le dépôt) : FOURMY_IMPORT_SAMPLES désigne leur dossier. */
const samples = process.env.FOURMY_IMPORT_SAMPLES;
describe.skipIf(!url || !samples)("Geofolia et DAPLOS réels, dans les deux ordres (local)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const farms: Farm[] = [];
  beforeAll(async () => {
    farms.push(await setupFarm(sql, "Ferme réelle Geofolia puis DAPLOS"), await setupFarm(sql, "Ferme réelle DAPLOS puis Geofolia"));
  });
  afterAll(async () => {
    for (const f of farms) {
      await sql`DELETE FROM import_runs WHERE farm_id = ${f.farmId}`;
      await teardown(sql, f.farmId, [f.userId]);
    }
    await sql.end();
  });

  it("mêmes parcelles, cultures, couverts et couples", { timeout: 600_000 }, async () => {
    const file = (ext: string) => {
      const name = readdirSync(samples!).find((f) => f.toLowerCase().endsWith(ext))!;
      return { name, bytes: readFileSync(join(samples!, name)) };
    };
    const [zip, dap] = [file(".zip"), file(".dap")];
    const log: Record<string, unknown> = {};
    await importFile(farms[0]!, zip.bytes, zip.name);
    const gd = await importFile(farms[0]!, dap.bytes, dap.name);
    const dg1 = await importFile(farms[1]!, dap.bytes, dap.name);
    const dg2 = await importFile(farms[1]!, zip.bytes, zip.name);
    log.geofoliaThenDaplos = gd.preview.reconciliation.interventions;
    log.daplosFirst = { counts: dg1.done.report.counts, skipped: dg1.preview.reconciliation.interventions.skipped.slice(0, 10) };
    log.thenGeofolia = dg2.done.report.counts.interventions;
    const a = await stateOf(sql, farms[0]!.farmId);
    const b = await stateOf(sql, farms[1]!.farmId);
    log.state = { geofoliaThenDaplos: a, daplosThenGeofolia: b };
    console.log(JSON.stringify(log, null, 1));
    expect({ ...a, interventions: undefined }).toEqual({ ...b, interventions: undefined });
  });
});
