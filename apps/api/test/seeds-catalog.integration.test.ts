import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { SeedAttachProposal, SeedCatalogItem, SeedDetail } from "@fourmy/contracts";
import { createApp } from "../src/app.js";
import { addMember, setupFarm, teardown } from "./helpers.js";

/**
 * Semences, lot SE4 : recherche au catalogue GNIS, création d'une semence,
 * rattachement proposé (code GNIS sûr, espèce du fichier, libellé proche,
 * mélange), appliqué au choix. Variétés fictives (codes ZZ…), retirées à la fin.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("semences : catalogue et rattachement (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farmId = "";
  const users: string[] = [];
  let owner: Record<string, string> = {};
  let worker: Record<string, string> = {};
  const ids = { byCode: crypto.randomUUID(), byLabel: crypto.randomUUID(), close: crypto.randomUUID(), mixture: crypto.randomUUID(), unknown: crypto.randomUUID(), named: crypto.randomUUID(), namedNew: crypto.randomUUID() };
  const send = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1/farms/${farmId}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });

  beforeAll(async () => {
    await sql`INSERT INTO lexicon_seed_varieties (gnis_code, species, species_label, variety_name, registered_on, search) VALUES
      ('ZZ00001', 'zz_species_a', 'ZZESPECE TEST', 'ZZTHERMIDOR', '2023-12-27', 'zzthermidor zzespece test'),
      ('ZZ00002', 'zz_species_a', 'ZZESPECE TEST', 'ZZCELEBRITY', null, 'zzcelebrity zzespece test'),
      ('ZZ00003', 'zea_mays', 'ZZMAIS', 'ZZMAIS P0573', null, 'zzmais p0573 zzmais')
      ON CONFLICT (gnis_code) DO NOTHING`;
    const o = await setupFarm(sql, "Ferme test catalogue semences");
    farmId = o.farmId;
    owner = o.headers;
    users.push(o.userId);
    const w = await addMember(sql, farmId, "worker");
    worker = w.headers;
    users.push(w.userId);
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, custom) VALUES
      (${ids.byCode}, ${farmId}, 'Thermidor importé', 'seed', 'kilogram', '{"gnis": "ZZ00001", "species": "Zzespèce test"}'::jsonb),
      (${ids.byLabel}, ${farmId}, 'Une semence', 'seed', 'kilogram', '{"species": "Zzespèce test"}'::jsonb),
      (${ids.close}, ${farmId}, 'Une autre', 'seed', 'kilogram', '{"species": "Zzespèce test de printemps"}'::jsonb),
      (${ids.mixture}, ${farmId}, 'Couvert zz', 'seed', 'kilogram', '{"species": "Mélange"}'::jsonb),
      (${ids.unknown}, ${farmId}, 'Inconnue', 'seed', 'kilogram', '{}'::jsonb),
      (${ids.named}, ${farmId}, 'Semence de zzespèce test -  ZZCELEBRITY', 'seed', 'Sac de 50 000 grains', null),
      (${ids.namedNew}, ${farmId}, 'Semences de zzespèce test - ZZ Nouvelle', 'seed', 'Mille grains', null)`;
  });
  afterAll(async () => {
    await teardown(sql, farmId, users);
    await sql`DELETE FROM lexicon_seed_varieties WHERE gnis_code LIKE 'ZZ%'`;
    await sql.end();
  });

  it("recherche au catalogue : sans accents, débuts de nom d'abord, unité proposée", async () => {
    const res = await send(worker, "GET", "/seeds/catalog?q=zzthermi");
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: SeedCatalogItem[] };
    expect(items[0]).toMatchObject({ gnisCode: "ZZ00001", varietyName: "Zzthermidor", species: "zz_species_a", speciesLabel: "Zzespece test", proposedUnit: "kilogram", proposedGrainsPerDose: null });
    const maize = ((await (await send(worker, "GET", "/seeds/catalog?q=p0573")).json()) as { items: SeedCatalogItem[] }).items;
    expect(maize[0]).toMatchObject({ gnisCode: "ZZ00003", proposedUnit: "dose", proposedGrainsPerDose: 50000, reference: { org: "Arvalis" } });
    expect(((await (await send(worker, "GET", "/seeds/catalog?q=z")).json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("créer une semence depuis le catalogue ; droits et unité contrôlés", async () => {
    const body = { name: "Zzcelebrity", unit: "kilogram", sheet: { species: "zz_species_a", varietyName: "Zzcelebrity", gnisCode: "ZZ00002" } };
    expect((await send(worker, "POST", "/seeds", body)).status).toBe(403);
    expect((await send(owner, "POST", "/seeds", { ...body, unit: "palette" })).status).toBe(400);
    const res = await send(owner, "POST", "/seeds", body);
    expect(res.status).toBe(201);
    const d = (await res.json()) as SeedDetail;
    expect(d).toMatchObject({ name: "Zzcelebrity", unit: "kilogram", unitDim: "mass", sheet: { species: "zz_species_a", gnisCode: "ZZ00002" }, flags: ["tgw_missing"] });
  });

  it("propositions : code GNIS sûr, espèce du fichier, libellé proche, mélange ; rien pour l'inconnue", async () => {
    const { items } = (await (await send(worker, "GET", "/seeds/attach")).json()) as { items: SeedAttachProposal[] };
    const by = new Map(items.map((p) => [p.articleId, p]));
    expect(by.get(ids.byCode)).toMatchObject({ species: "zz_species_a", varietyName: "Zzthermidor", gnisCode: "ZZ00001", sure: true, approximate: false });
    expect(by.get(ids.byLabel)).toMatchObject({ species: "zz_species_a", sure: false, approximate: false });
    expect(by.get(ids.close)).toMatchObject({ species: "zz_species_a", sure: false, approximate: true });
    expect(by.get(ids.mixture)).toMatchObject({ isMixture: true, species: null, approximate: false });
    expect(by.has(ids.unknown)).toBe(false);
    // Nom repris d'Ekylibre : l'espèce, et la variété du catalogue pour cette espèce (sinon le nom après le tiret).
    expect(by.get(ids.named)).toMatchObject({ species: "zz_species_a", varietyName: "Zzcelebrity", gnisCode: "ZZ00002", sure: false, approximate: false });
    expect(by.get(ids.named)!.reason).toMatch(/variété au catalogue/);
    expect(by.get(ids.namedNew)).toMatchObject({ species: "zz_species_a", varietyName: "ZZ Nouvelle", gnisCode: null, approximate: false });
  });

  it("rattacher les semences choisies ; elles sortent des propositions", async () => {
    expect((await send(worker, "POST", "/seeds/attach", { articleIds: [ids.byCode] })).status).toBe(403);
    const res = await send(owner, "POST", "/seeds/attach", { articleIds: [ids.byCode, ids.mixture] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: SeedAttachProposal[] }).items).toHaveLength(2);
    const rows = await sql`SELECT article_id, species, variety_name, gnis_code, is_mixture FROM article_seeds WHERE farm_id = ${farmId} ORDER BY is_mixture`;
    expect(rows.find((r) => r.article_id === ids.byCode)).toMatchObject({ species: "zz_species_a", variety_name: "Zzthermidor", gnis_code: "ZZ00001", is_mixture: false });
    expect(rows.find((r) => r.article_id === ids.mixture)).toMatchObject({ species: null, is_mixture: true });
    const { items } = (await (await send(owner, "GET", "/seeds/attach")).json()) as { items: SeedAttachProposal[] };
    expect(items.map((p) => p.articleId).sort()).toEqual([ids.byLabel, ids.close, ids.named, ids.namedNew].sort());
  });
});
