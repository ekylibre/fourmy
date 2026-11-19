import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { pendingImports } from "../src/routes/imports.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Import TelePAC, lot IM3 : dossier PAC seul (la ferme naît du dossier), puis
 * Geofolia suivi de TelePAC (les parcelles PAC se rattachent sans doublon).
 * Jeux anonymisés tirés d'un dossier réel : 4 îlots, 16 parcelles PAC, 129 SNA,
 * 6 ZDH ; le jeu Geofolia porte 6 de ces parcelles.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const fixtures = join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures");
const telepac = readFileSync(join(fixtures, "telepac-pilote.xml"));
const geofolia = readFileSync(join(fixtures, "geofolia-pilote.zip"));

describe.skipIf(!url)("import TelePAC (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const farms: { farmId: string; userId: string; headers: Record<string, string> }[] = [];

  beforeAll(async () => {
    farms.push(await setupFarm(sql, "Ferme test TelePAC seul"), await setupFarm(sql, "Ferme test Geofolia puis TelePAC"));
  });
  afterAll(async () => {
    for (const f of farms) {
      await sql`DELETE FROM import_runs WHERE farm_id = ${f.farmId}`;
      await teardown(sql, f.farmId, [f.userId]);
    }
    await sql.end();
  });

  const importFile = async (farm: (typeof farms)[number], bytes: Uint8Array, name: string) => {
    const form = new FormData();
    form.set("file", new File([bytes], name));
    const run = await (
      await app.request(`/api/v1/farms/${farm.farmId}/imports/files`, { method: "POST", headers: { authorization: farm.headers.authorization! }, body: form })
    ).json();
    const res = await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}/apply`, { method: "POST", headers: farm.headers });
    expect(res.status, await res.clone().text()).toBe(202);
    await Promise.all([...pendingImports]);
    const done = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}`, { headers: farm.headers })).json();
    return { preview: run.preview, done };
  };

  it("dossier PAC seul : identité, parcelles et cultures PAC, références, éléments du paysage", { timeout: 120_000 }, async () => {
    const farm = farms[0]!;
    const { preview, done } = await importFile(farm, telepac, "Dossier-PAC-2026.xml");
    expect(preview.readable).toBe(true);
    expect(preview.farm.identity).toMatchObject({ siret: "40000000000003", pacage: "040000003", name: "GAEC PILOTE TEST" });
    expect(preview.notImported).toEqual([{ kind: "animals", label: "Animaux déclarés (AV)", count: 1000 }]);
    expect(preview.reconciliation.parcels).toEqual({ create: 16, link: 0, skip: 0 });
    expect(preview.reconciliation.capRefs).toMatchObject({ islets: 4, parcels: 16 });
    expect(preview.reconciliation.landscape).toMatchObject({ create: 134, link: 0 });

    expect(done.status, JSON.stringify(done.report)).toBe("completed");
    expect(done.report.counts.parcels.created).toBe(16);
    expect(done.report.counts.productions.created).toBe(16);
    expect(done.report.counts.capRefs.parcels).toBeGreaterThanOrEqual(16);
    expect(done.report.counts.capRefs.islets).toBeGreaterThanOrEqual(16);
    expect(done.report.counts.landscape.created).toBe(134);

    const [farmRow] = await sql`SELECT siret, pacage, legal_name, email FROM farms WHERE id = ${farm.farmId}`;
    expect(farmRow).toEqual({ siret: "40000000000003", pacage: "040000003", legal_name: "GAEC PILOTE TEST", email: "pilote@exemple.test" });
    const kinds = await sql`SELECT kind, count(*)::int AS n FROM farm_landscape_features WHERE farm_id = ${farm.farmId} GROUP BY 1 ORDER BY 1`;
    expect(Object.fromEntries(kinds.map((k) => [k.kind, k.n]))).toMatchObject({ hedge: 47, tree: 54, tree_row: 20, hedge_densification: 6 });
    expect(kinds.reduce((n, k) => n + k.n, 0)).toBe(134);
    // Chaque parcelle porte sa parcelle PAC (code culture, surface admissible) et son îlot.
    const refs = await sql`
      SELECT lp.id, count(*) FILTER (WHERE r.kind = 'cap')::int AS cap, count(*) FILTER (WHERE r.kind = 'cap_islet')::int AS islet
      FROM land_parcels lp LEFT JOIN parcel_references r ON r.land_parcel_id = lp.id WHERE lp.farm_id = ${farm.farmId} GROUP BY 1`;
    expect(refs).toHaveLength(16);
    expect(refs.every((r) => r.cap >= 1 && r.islet >= 1)).toBe(true);
    // Certaines parcelles PAC (bandes tampons…) n'ont pas de surface admissible.
    const [code] = await sql`SELECT code, area_m2::float8 AS area FROM parcel_references WHERE farm_id = ${farm.farmId} AND kind = 'cap' AND code IS NOT NULL AND area_m2 IS NOT NULL LIMIT 1`;
    expect(code!.code).toMatch(/^[A-Z0-9]{3}$/);
    expect(code!.area).toBeGreaterThan(0);

    // Carte : les éléments déclarés en GeoJSON ; fiche : la parcelle PAC et l'îlot.
    const fc = await (await app.request(`/api/v1/farms/${farm.farmId}/landscape-features`, { headers: farm.headers })).json();
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(134);
    expect(fc.features.find((f: { properties: { kind: string } }) => f.properties.kind === "tree").geometry.type).toBe("Point");
    const parcelId = refs[0]!.id;
    const sheet = await (await app.request(`/api/v1/farms/${farm.farmId}/land-parcels/${parcelId}/sheet`, { headers: farm.headers })).json();
    expect(sheet.cap.some((c: { source: string; islet: string | null }) => c.source === "telepac" && c.islet)).toBe(true);
    expect(sheet.islets.length).toBeGreaterThanOrEqual(1);
  });

  it("dossier PAC réimporté : rien de créé", { timeout: 120_000 }, async () => {
    const farm = farms[0]!;
    const copy = Buffer.concat([telepac, Buffer.from("\n")]); // autre empreinte, même contenu
    const { preview, done } = await importFile(farm, copy, "copie.xml");
    expect(preview.reconciliation.parcels).toEqual({ create: 0, link: 16, skip: 0 });
    expect(preview.reconciliation.productions.create).toBe(0);
    expect(preview.reconciliation.landscape).toMatchObject({ create: 0, link: 134 });
    expect(done.report.counts.landscape.created).toBe(0);
    expect(done.report.counts.capRefs).toEqual({ islets: 0, parcels: 0 });
  });

  it("Geofolia puis TelePAC : les parcelles Geofolia sont reliées, les cultures ne sont pas doublées", { timeout: 180_000 }, async () => {
    const farm = farms[1]!;
    const g = await importFile(farm, geofolia, "export.zip");
    expect(g.done.status).toBe("completed");
    const [{ n: productionsBefore }] = await sql`SELECT count(*)::int AS n FROM productions WHERE farm_id = ${farm.farmId}`;

    const { preview, done } = await importFile(farm, telepac, "Dossier-PAC-2026.xml");
    expect(preview.reconciliation.parcels).toEqual({ create: 10, link: 6, skip: 0 });
    // Les 6 parcelles Geofolia ont déjà leur culture : seules les 10 nouvelles en reçoivent une.
    expect(preview.reconciliation.productions).toEqual({ create: 10, link: 6 });
    expect(done.status, JSON.stringify(done.report)).toBe("completed");
    const [{ n: productionsAfter }] = await sql`SELECT count(*)::int AS n FROM productions WHERE farm_id = ${farm.farmId}`;
    expect(productionsAfter).toBe(productionsBefore + 10);
    const [{ n: parcels }] = await sql`SELECT count(*)::int AS n FROM land_parcels WHERE farm_id = ${farm.farmId}`;
    expect(parcels).toBe(16);
    // Les parcelles Geofolia portent désormais leur parcelle PAC.
    const [{ n: geofoliaWithPac }] = await sql`
      SELECT count(DISTINCT l.entity_id)::int AS n FROM import_links l
      JOIN parcel_references r ON r.land_parcel_id = l.entity_id AND r.kind = 'cap'
      WHERE l.farm_id = ${farm.farmId} AND l.namespace = 'plot.work_number'`;
    expect(geofoliaWithPac).toBe(6);
  });
});

/** Fichiers réels (jamais dans le dépôt) : FOURMY_IMPORT_SAMPLES désigne leur dossier. */
const samples = process.env.FOURMY_IMPORT_SAMPLES;
describe.skipIf(!url || !samples)("Geofolia puis TelePAC sur les fichiers réels (local)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: { farmId: string; userId: string; headers: Record<string, string> };
  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test fichiers réels TelePAC");
  });
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id = ${farm.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("le dossier PAC se rattache à l'export Geofolia", { timeout: 300_000 }, async () => {
    const { readdirSync } = await import("node:fs");
    const run = async (ext: string) => {
      const name = readdirSync(samples!).find((f) => f.toLowerCase().endsWith(ext))!;
      const form = new FormData();
      form.set("file", new File([readFileSync(join(samples!, name))], name));
      const r = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/files`, { method: "POST", headers: { authorization: farm.headers.authorization! }, body: form })).json();
      await app.request(`/api/v1/farms/${farm.farmId}/imports/${r.id}/apply`, { method: "POST", headers: farm.headers });
      await Promise.all([...pendingImports]);
      return { preview: r.preview, done: await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${r.id}`, { headers: farm.headers })).json() };
    };
    await run(".zip");
    const pac = await run(".xml");
    console.log(JSON.stringify({ reconciliation: pac.preview.reconciliation, counts: pac.done.report?.counts, status: pac.done.status }, null, 1));
    expect(pac.done.status).toBe("completed");
  });
});
