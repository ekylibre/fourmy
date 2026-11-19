import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { zip } from "@fourmy/isoxml";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { runEkylibreUploadJobs, uploadsDir } from "../src/repos/ekylibre-uploads.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Reprise d'Ekylibre depuis une sauvegarde déposée (assistant, lot IM6) :
 * réception en flux, restauration par le worker dans une base jetable sous
 * liste blanche, abandon et nettoyage. Sauvegarde synthétique, avec des
 * instructions qui ne doivent pas passer. La migration elle-même se teste sur
 * une vraie sauvegarde, en local (FOURMY_EKYLIBRE_SAMPLES).
 */
const url = process.env.DATABASE_URL;
const app = createApp();

const TENANT = "pilote-test";
const DUMP = [
  "SET statement_timeout = 0;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  `CREATE TABLE "${TENANT}".products (id integer NOT NULL, name character varying);`,
  `COPY "${TENANT}".products (id, name) FROM stdin;`,
  "1\tBlé; tendre",
  "2\t\\N",
  "\\.",
  `ALTER TABLE ONLY "${TENANT}".products ADD CONSTRAINT products_pkey PRIMARY KEY (id);`,
  // À refuser : sortie du rôle restreint, programme du serveur, code arbitraire, écriture directe.
  "SET ROLE postgres;",
  `COPY "${TENANT}".products TO PROGRAM 'touch /tmp/fourmy-pwned';`,
  `DO $$ BEGIN INSERT INTO "${TENANT}".products VALUES (99, 'intrus'); END $$;`,
  `INSERT INTO "${TENANT}".products VALUES (98, 'intrus');`,
  `CREATE FUNCTION "${TENANT}".evil() RETURNS void LANGUAGE c AS 'libc', 'system';`,
  "\\connect fourmy",
  `ALTER TABLE "${TENANT}".products OWNER TO ekylibre;`,
].join("\n");

const backup = (tenant = TENANT, dump = DUMP) =>
  zip({ mimetype: "application/x-ekylibre", "manifest.yml": `---\ntenant: ${tenant}\nformat_version: 3\ndatabase_version: 20250405175301\n`, [`${tenant}.sql`]: dump }, new Date());

describe.skipIf(!url)("reprise d'Ekylibre déposée (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: { farmId: string; userId: string; headers: Record<string, string> };
  const previous = process.env.EKYLIBRE_SOURCES_URL;

  const upload = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
    app.request(`/api/v1/farms/${farm.farmId}/imports/ekylibre/upload`, {
      method: "POST",
      headers: { authorization: farm.headers.authorization!, "content-type": "application/zip", "x-file-name": "pilote-test.zip", ...headers },
      body: bytes,
    });
  const runOf = async (id: string) => (await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}`, { headers: farm.headers })).json();
  const databases = async () => (await sql`SELECT datname FROM pg_database WHERE datname LIKE 'ekylibre_src_up_%'`).map((r) => r.datname as string);

  beforeAll(async () => {
    const base = new URL(url!);
    base.pathname = "/";
    process.env.EKYLIBRE_SOURCES_URL = base.toString();
    farm = await setupFarm(sql, "Ferme test reprise Ekylibre");
  });
  afterAll(async () => {
    process.env.EKYLIBRE_SOURCES_URL = previous;
    await sql`DELETE FROM import_runs WHERE farm_id = ${farm.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("refuse un zip qui n'est pas une sauvegarde de tenant, ou trop gros", async () => {
    const notBackup = await upload(zip({ "Field.Json": "{}" }, new Date()));
    expect(notBackup.status).toBe(400);
    expect((await notBackup.json()).detail).toMatch(/manifest\.yml/);
    expect((await upload(backup(), { "content-length": String(3 * 1024 ** 3) })).status).toBe(413);
    expect(readdirSync(uploadsDir()).filter((f) => f.endsWith(".zip")).length).toBe(0);
  });

  it("dépôt → restauration sous liste blanche → à valider ; abandon → base et fichier supprimés", { timeout: 120_000 }, async () => {
    const res = await upload(backup());
    expect(res.status, await res.clone().text()).toBe(201);
    const run = await res.json();
    expect(run).toMatchObject({ source: `ekylibre-file:${TENANT}`, status: "running", report: { phase: "queued", tenant: TENANT } });
    // Un seul import en cours par ferme.
    expect((await upload(backup())).status).toBe(409);

    await runEkylibreUploadJobs(db());
    const restored = await runOf(run.id);
    expect(restored.status, JSON.stringify(restored.report)).toBe("analyzed");
    expect(restored.report.phase).toBe("restored");
    const r = restored.report.restore;
    expect(r.copiedRows).toBe(2);
    expect(r.errors).toBe(0);
    expect(r.refused).toMatchObject({ "SET ROLE": 1, "\\connect": 1 });
    expect(Object.values(r.refused as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(6);

    // La base jetable : les données du dump, rien des instructions refusées, en lecture seule.
    const [dbName] = await databases();
    expect(dbName).toBeDefined();
    const srcUrl = new URL(url!);
    srcUrl.pathname = `/${dbName}`;
    const src = postgres(srcUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      expect(await src`SELECT id, name FROM ${src(TENANT)}.products ORDER BY id`).toEqual([
        { id: 1, name: "Blé; tendre" },
        { id: 2, name: null },
      ]);
      const [{ owner }] = await src`SELECT tableowner AS owner FROM pg_tables WHERE schemaname = ${TENANT}`;
      expect(owner).toBe("fourmy_restore");
      const [{ fn }] = await src`SELECT count(*)::int AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${TENANT}`;
      expect(fn).toBe(0);
      await expect(src`CREATE TABLE ${src(TENANT)}.x (a int)`).rejects.toThrow(/read-only/);
    } finally {
      await src.end();
    }
    expect(existsSync("/tmp/fourmy-pwned")).toBe(false);

    const discarded = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}/discard`, { method: "POST", headers: farm.headers })).json();
    expect(discarded.status).toBe("discarded");
    await runEkylibreUploadJobs(db());
    expect(await databases()).not.toContain(dbName);
    expect(existsSync(join(uploadsDir(), `${run.id}.zip`))).toBe(false);
    expect((await runOf(run.id)).report.phase).toBe("cleaned");
  });
});

/** Sauvegardes réelles (jamais dans le dépôt) : FOURMY_EKYLIBRE_SAMPLES désigne un dossier de sauvegardes de tenant. */
const samples = process.env.FOURMY_EKYLIBRE_SAMPLES;
describe.skipIf(!url || !samples)("reprise d'Ekylibre sur une vraie sauvegarde (local)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: { farmId: string; userId: string; headers: Record<string, string> };
  beforeAll(async () => {
    const base = new URL(url!);
    base.pathname = "/";
    process.env.EKYLIBRE_SOURCES_URL = base.toString();
    farm = await setupFarm(sql, "Ferme test sauvegarde Ekylibre réelle");
  });
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id = ${farm.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("dépôt, restauration, validation, migration : la ferme est reprise", { timeout: 1_800_000 }, async () => {
    const file = process.env.FOURMY_EKYLIBRE_SAMPLE ?? readdirSync(samples!).find((f) => f.endsWith(".zip"))!;
    const t0 = Date.now();
    const res = await app.request(`/api/v1/farms/${farm.farmId}/imports/ekylibre/upload`, {
      method: "POST",
      headers: { authorization: farm.headers.authorization!, "content-type": "application/zip", "x-file-name": file },
      body: readFileSync(join(samples!, file)),
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = await res.json();
    await runEkylibreUploadJobs(db());
    const restored = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}`, { headers: farm.headers })).json();
    expect(restored.status, JSON.stringify(restored.report)).toBe("analyzed");
    const t1 = Date.now();
    expect((await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}/apply`, { method: "POST", headers: farm.headers })).status).toBe(202);
    await runEkylibreUploadJobs(db());
    const done = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}`, { headers: farm.headers })).json();
    const [{ parcels, interventions }] = await sql`
      SELECT (SELECT count(*) FROM land_parcels WHERE farm_id = ${farm.farmId})::int AS parcels,
             (SELECT count(*) FROM interventions WHERE farm_id = ${farm.farmId})::int AS interventions`;
    console.log(JSON.stringify({ file, restore: restored.report.restore, restoreS: (t1 - t0) / 1000, migrateS: (Date.now() - t1) / 1000, status: done.status, parcels, interventions, counts: done.report?.counts }));
    expect(done.status, JSON.stringify(done.report).slice(0, 2000)).toBe("completed");
    expect(parcels).toBeGreaterThan(0);
  });
});
