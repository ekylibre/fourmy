import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { emptyBundle, registerReader } from "@fourmy/importers";
import { createApp } from "../src/app.js";
import { pendingImports } from "../src/routes/imports.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Imports et unités des semences (issue #130, lot SU5, NF-SU-3) : une
 * semence créée par un import l'est dans le code canonique de même grandeur
 * (l'unité du fichier gardée dans `unitRewrite`) ; une semence déjà réécrite
 * garde son unité quand le fichier la nomme encore à l'ancienne.
 */
const url = process.env.DATABASE_URL;
const app = createApp();

describe.skipIf(!url)("imports : semences dans le code canonique (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  let farm: Awaited<ReturnType<typeof setupFarm>>;
  const rewritten = crypto.randomUUID();
  let restore: () => void = () => {};

  beforeAll(async () => {
    farm = await setupFarm(sql, "Ferme test import des semences");
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit, custom)
      VALUES (${rewritten}, ${farm.farmId}, 'Tournesol ES Bella', 'seed', 'dose', ${sql.json({ unitRewrite: { from: "Sac de 150 000 grains", at: "2026-11-28T10:00:00Z", by: farm.userId } })})`;
    restore = registerReader("daplos", () => {
      const b = emptyBundle("daplos");
      b.campaigns = [2026];
      const seed = (key: string, name: string, unit: string) => ({ key, name, nature: "seed" as const, amm: null, gnis: null, unit, composition: null, species: null, sourceIds: {} });
      b.articles = [seed("mais", "Maïs P0573", "Sac de 50 000 grains"), seed("ble", "Blé Thermidor", "Mille graines"), seed("tournesol", "Tournesol ES Bella", "Sac de 150 000 grains")];
      return b;
    });
  });
  afterAll(async () => {
    restore();
    await sql`DELETE FROM import_runs WHERE farm_id = ${farm.farmId}`;
    await teardown(sql, farm.farmId, [farm.userId]);
    await sql.end();
  });

  it("créées en dose de 50 000 grains et en milliers ; la semence réécrite garde « dose »", async () => {
    const form = new FormData();
    // En-tête DAPLOS minimal (le lecteur de test fournit le contenu) ; empreinte propre à ce test.
    form.set("file", new File([Buffer.from(`EI400000000000035  999999999999999  1   \r\nDE                                    2026111800630.95\r\n${"\r\n".repeat(7)}`, "latin1")], "semences.dap"));
    const base = `/api/v1/farms/${farm.farmId}`;
    const upload = await app.request(`${base}/imports/files`, { method: "POST", headers: { authorization: farm.headers.authorization! }, body: form });
    expect(upload.status, await upload.clone().text()).toBe(201);
    const run = (await upload.json()) as { id: string };
    const res = await app.request(`${base}/imports/${run.id}/apply`, { method: "POST", headers: farm.headers });
    expect(res.status, await res.clone().text()).toBe(202);
    await Promise.all([...pendingImports]);

    const list = await sql`SELECT a.id, a.name, a.unit, a.custom->'unitRewrite'->>'from' AS rewritten_from, s.grains_per_dose
                           FROM articles a LEFT JOIN article_seeds s ON s.article_id = a.id
                           WHERE a.farm_id = ${farm.farmId} AND a.kind = 'seed' ORDER BY a.name`;
    expect(list.map((a) => [a.name, a.unit, a.rewritten_from, a.grains_per_dose])).toEqual([
      ["Blé Thermidor", "thousand", "Mille graines", null],
      ["Maïs P0573", "dose", "Sac de 50 000 grains", 50000],
      ["Tournesol ES Bella", "dose", "Sac de 150 000 grains", null],
    ]);
    expect(list.find((a) => a.name === "Tournesol ES Bella")!.id).toBe(rewritten);
    // Plus rien à réécrire : tout est déjà dans le code canonique.
    const units = (await (await app.request(`${base}/seeds/units`, { headers: farm.headers })).json()) as { items: unknown[] };
    expect(units.items).toEqual([]);
  });
});
