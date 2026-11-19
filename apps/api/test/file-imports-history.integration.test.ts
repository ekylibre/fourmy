import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { withFarm } from "@fourmy/db";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { pendingImports } from "../src/routes/imports.js";
import { previousOf } from "../src/repos/fertilization-plans.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Lot IM5 : historique N-1…N-5 (productions déclarées), sa lecture (précédent
 * cultural, fiche parcelle, hors carte), apports prévus, et annulation d'un
 * import. Jeux anonymisés Geofolia et DAPLOS d'une même ferme.
 */
const url = process.env.DATABASE_URL;
const app = createApp();
const fixtures = join(import.meta.dirname, "..", "..", "..", "packages", "importers", "test", "fixtures");
const geofolia = readFileSync(join(fixtures, "geofolia-pilote.zip"));
const daplos = readFileSync(join(fixtures, "daplos-pilote.dap"));

type Farm = { farmId: string; userId: string; headers: Record<string, string> };

const importFile = async (farm: Farm, bytes: Uint8Array, name: string) => {
  const form = new FormData();
  form.set("file", new File([bytes], name));
  const run = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/files`, { method: "POST", headers: { authorization: farm.headers.authorization! }, body: form })).json();
  const applied = await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}/apply`, { method: "POST", headers: farm.headers });
  expect(applied.status, await applied.clone().text()).toBe(202);
  await Promise.all([...pendingImports]);
  const done = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${run.id}`, { headers: farm.headers })).json();
  expect(done.status, JSON.stringify(done.report)).toBe("completed");
  return { id: run.id as string, preview: run.preview, done };
};

/** Ce que la ferme contient : tout doit revenir à zéro après annulation. */
async function contents(sql: postgres.Sql, farmId: string) {
  const [r] = await sql`
    SELECT (SELECT count(*) FROM land_parcels WHERE farm_id = ${farmId})::int AS parcels,
           (SELECT count(*) FROM productions WHERE farm_id = ${farmId})::int AS productions,
           (SELECT count(*) FROM cover_crops WHERE farm_id = ${farmId})::int AS covers,
           (SELECT count(*) FROM interventions WHERE farm_id = ${farmId})::int AS interventions,
           (SELECT count(*) FROM activities WHERE farm_id = ${farmId})::int AS activities,
           (SELECT count(*) FROM articles WHERE farm_id = ${farmId})::int AS articles,
           (SELECT count(*) FROM campaigns WHERE farm_id = ${farmId})::int AS campaigns,
           (SELECT count(*) FROM import_links WHERE farm_id = ${farmId})::int AS links`;
  return r!;
}

describe.skipIf(!url)("historique, apports prévus et annulation d'un import (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const farms: Farm[] = [];
  beforeAll(async () => {
    farms.push(await setupFarm(sql, "Ferme test historique"), await setupFarm(sql, "Ferme test annulation"), await setupFarm(sql, "Ferme test annulation partielle"));
  });
  afterAll(async () => {
    for (const f of farms) {
      await sql`DELETE FROM import_runs WHERE farm_id = ${f.farmId}`;
      await teardown(sql, f.farmId, [f.userId]);
    }
    await sql.end();
  });

  it("Geofolia : cultures N-1…N-5 en productions déclarées, précédent, fiche, hors carte", { timeout: 180_000 }, async () => {
    const farm = farms[0]!;
    const { preview, done } = await importFile(farm, geofolia, "export.zip");
    expect(preview.reconciliation.history.create).toBeGreaterThan(10);
    expect(done.report.counts.history.created).toBe(preview.reconciliation.history.create);

    const years = await sql`SELECT c.year, count(*)::int AS n FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                            WHERE p.farm_id = ${farm.farmId} AND p.declared GROUP BY 1 ORDER BY 1`;
    expect(years.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
    // Une culture déclarée par terre et par campagne, au plus.
    const [{ dup }] = await sql`SELECT count(*)::int AS dup FROM (SELECT land_parcel_id, campaign_id FROM productions WHERE farm_id = ${farm.farmId} GROUP BY 1, 2 HAVING count(*) FILTER (WHERE declared) > 1) d`;
    expect(dup).toBe(0);

    // Précédent cultural de la campagne 2026 : la culture déclarée de 2025.
    const [parcel] = await sql`SELECT p.land_parcel_id AS id FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                               WHERE p.farm_id = ${farm.farmId} AND p.declared AND c.year = 2025 LIMIT 1`;
    const previous = await withFarm(db(), farm.farmId, (tx) => previousOf(tx, farm.farmId, parcel!.id, 2026));
    expect(previous?.parcel_id).toBe(parcel!.id);

    // Fiche : la rotation montre l'historique, marqué déclaré.
    const sheet = await (await app.request(`/api/v1/farms/${farm.farmId}/land-parcels/${parcel!.id}/sheet`, { headers: farm.headers })).json();
    expect(sheet.productions.some((p: { year: number; declared: boolean }) => p.year === 2025 && p.declared)).toBe(true);
    // Carte d'une date passée : pas de production déclarée.
    const snap = await (await app.request(`/api/v1/farms/${farm.farmId}/snapshot?at=2025-08-01T10:00:00Z`, { headers: farm.headers })).json();
    expect(snap.productions).toHaveLength(0);

    // Apports prévus (plan de fumure Geofolia) : interventions planifiées, notées.
    const planned = await sql`SELECT notes FROM interventions WHERE farm_id = ${farm.farmId} AND origin = 'import' AND status = 'planned'`;
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((p) => /^Prévu dans Geofolia/.test(p.notes ?? ""))).toBe(true);
  });

  it("DAPLOS ensuite : l'historique n'est pas doublé", { timeout: 180_000 }, async () => {
    const farm = farms[0]!;
    const [{ n: before }] = await sql`SELECT count(*)::int AS n FROM productions WHERE farm_id = ${farm.farmId} AND declared`;
    const { preview } = await importFile(farm, daplos, "export.dap");
    expect(preview.reconciliation.history.create).toBe(0);
    const [{ n: after }] = await sql`SELECT count(*)::int AS n FROM productions WHERE farm_id = ${farm.farmId} AND declared`;
    expect(after).toBe(before);
  });

  it("annulation : la ferme revient à son état initial ; une seconde annulation est refusée", { timeout: 180_000 }, async () => {
    const farm = farms[1]!;
    const initial = await contents(sql, farm.farmId);
    const { id } = await importFile(farm, geofolia, "export.zip");
    expect((await contents(sql, farm.farmId)).interventions).toBeGreaterThan(0);

    const res = await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}/revert`, { method: "POST", headers: farm.headers });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.run.status).toBe("reverted");
    expect(body.revert.kept).toEqual([]);
    expect(body.revert.deleted.land_parcel).toBe(6);
    expect(await contents(sql, farm.farmId)).toEqual(initial);

    expect((await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}/revert`, { method: "POST", headers: farm.headers })).status).toBe(409);
    // Réimport après annulation : tout est recréé.
    const again = await importFile(farm, geofolia, "copie.zip");
    expect(again.preview.reconciliation.parcels.create).toBe(6);
  });

  it("annulation partielle : une intervention modifiée depuis est gardée, avec sa parcelle, et signalée", { timeout: 180_000 }, async () => {
    const farm = farms[2]!;
    const { id } = await importFile(farm, geofolia, "export.zip");
    // Intervention prévue sur une seule parcelle (choix stable : une seule parcelle gardée).
    const [touched] = await sql`SELECT i.id, min(t.ref_id::text) AS parcel FROM interventions i
                                JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target'
                                WHERE i.farm_id = ${farm.farmId} AND i.status = 'planned'
                                GROUP BY i.id HAVING count(*) = 1 ORDER BY i.id LIMIT 1`;
    const cancel = await app.request(`/api/v1/farms/${farm.farmId}/interventions/${touched!.id}/cancel`, {
      method: "POST",
      headers: farm.headers,
      body: JSON.stringify({ reason: "Apport abandonné" }),
    });
    expect(cancel.status, await cancel.clone().text()).toBe(200);

    const { revert } = await (await app.request(`/api/v1/farms/${farm.farmId}/imports/${id}/revert`, { method: "POST", headers: farm.headers })).json();
    expect(revert.kept.map((k: { entity: string }) => k.entity)).toEqual(expect.arrayContaining(["intervention", "land_parcel"]));
    const [still] = await sql`SELECT status FROM interventions WHERE id = ${touched!.id}`;
    expect(still?.status).toBe("cancelled");
    const [parcel] = await sql`SELECT id FROM land_parcels WHERE id = ${touched!.parcel}`;
    expect(parcel).toBeDefined();
    const c = await contents(sql, farm.farmId);
    expect(c.interventions).toBe(1);
    expect(c.parcels).toBe(1);
    // Les liens des entités gardées restent : un réimport les retrouve.
    expect(c.links).toBeGreaterThan(0);
  });
});

/** Fichiers réels (jamais dans le dépôt) : FOURMY_IMPORT_SAMPLES désigne leur dossier. */
const samples = process.env.FOURMY_IMPORT_SAMPLES;
describe.skipIf(!url || !samples)("historique sur les fichiers réels (local)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Farm;
  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme réelle historique");
  });
  afterAll(async () => {
    await sql`DELETE FROM import_runs WHERE farm_id = ${farm.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("cultures 2021–2025 et précédent 2026 de chaque parcelle", { timeout: 600_000 }, async () => {
    const { readdirSync } = await import("node:fs");
    for (const ext of [".zip", ".dap"]) {
      const name = readdirSync(samples!).find((f) => f.toLowerCase().endsWith(ext))!;
      await importFile(farm, readFileSync(join(samples!, name)), name);
    }
    const years = await sql`SELECT c.year, count(*)::int AS n FROM productions p JOIN campaigns c ON c.id = p.campaign_id
                            WHERE p.farm_id = ${farm.farmId} AND p.declared GROUP BY 1 ORDER BY 1`;
    const parcels = await sql`SELECT id FROM land_parcels WHERE farm_id = ${farm.farmId}`;
    let withPrevious = 0;
    for (const p of parcels) if (await withFarm(db(), farm.farmId, (tx) => previousOf(tx, farm.farmId, p.id, 2026))) withPrevious++;
    console.log(JSON.stringify({ declaredByYear: years, parcels: parcels.length, withPrevious }));
    expect(years.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(withPrevious).toBeGreaterThan(parcels.length * 0.8);
  });
});
