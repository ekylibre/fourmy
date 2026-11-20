import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { sql as sqlTag } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { db } from "../src/db.js";
import { legumeSpecies } from "../src/repos/taxonomy.js";
import { setupFarm, teardown } from "./helpers.js";

/**
 * Semences, lot SE1 (migration 0075) : fiche d'une semence et espèces d'un
 * mélange, cloisonnées par ferme ; contraintes de la fiche ; couvert relié
 * à son semis.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("semences : données (intégration)", () => {
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  const farms: { farmId: string; userId: string }[] = [];
  const maize = crypto.randomUUID();
  const mixture = crypto.randomUUID();
  const neighbour = crypto.randomUUID();

  const asFarm = <T>(farmId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`SELECT set_config('fourmy.farm_id', ${farmId}, true)`;
      await tx`SET LOCAL ROLE fourmy_app`;
      return fn(tx);
    }) as Promise<T>;

  beforeAll(async () => {
    farms.push(await setupFarm(sql, "Ferme test semences"), await setupFarm(sql, "Ferme voisine semences"));
    const [a, b] = farms;
    await sql`INSERT INTO articles (id, farm_id, name, kind, unit) VALUES
      (${maize}, ${a!.farmId}, 'Maïs P0573', 'seed', 'Sac de 50 000 grains'),
      (${mixture}, ${a!.farmId}, 'Avoine + TI + Radis + Phacélie', 'seed', 'kilogram'),
      (${neighbour}, ${b!.farmId}, 'Blé voisin', 'seed', 'kilogram')`;
  });
  afterAll(async () => {
    for (const f of farms) await teardown(sql, f.farmId, [f.userId]);
    await sql.end();
  });

  it("une ferme écrit et lit ses fiches, pas celles d'une autre", async () => {
    const [a, b] = farms;
    await asFarm(a!.farmId, async (tx) => {
      await tx`INSERT INTO article_seeds (article_id, farm_id, species, variety_name, grains_per_dose, tgw_g, tgw_origin)
               VALUES (${maize}, ${a!.farmId}, 'zea_mays', 'P0573', 50000, 300, 'label')`;
      await tx`INSERT INTO article_seeds (article_id, farm_id, is_mixture) VALUES (${mixture}, ${a!.farmId}, true)`;
      await tx`INSERT INTO seed_mixture_components (id, farm_id, article_id, species, label, position) VALUES
        (${crypto.randomUUID()}, ${a!.farmId}, ${mixture}, 'avena_sativa', 'Avoine', 0),
        (${crypto.randomUUID()}, ${a!.farmId}, ${mixture}, 'trifolium_incarnatum', 'Trèfle incarnat', 1)`;
    });
    await asFarm(b!.farmId, async (tx) => {
      expect(await tx`SELECT 1 FROM article_seeds`).toHaveLength(0);
      expect(await tx`SELECT 1 FROM seed_mixture_components`).toHaveLength(0);
    });
    // Écrire pour une autre ferme est refusé.
    await expect(asFarm(b!.farmId, (tx) => tx`INSERT INTO article_seeds (article_id, farm_id) VALUES (${neighbour}, ${a!.farmId})`)).rejects.toThrow(/row-level security/);
    const rows = await asFarm(a!.farmId, (tx) => tx`SELECT article_id FROM article_seeds ORDER BY is_mixture`);
    expect(rows.map((r) => r.article_id)).toEqual([maize, mixture]);
  });

  it("contraintes : PMG avec son origine, mélange sans espèce ni PMG", async () => {
    const [, b] = farms;
    await expect(
      asFarm(b!.farmId, (tx) => tx`INSERT INTO article_seeds (article_id, farm_id, tgw_g) VALUES (${neighbour}, ${b!.farmId}, 42)`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asFarm(b!.farmId, (tx) => tx`INSERT INTO article_seeds (article_id, farm_id, is_mixture, species) VALUES (${neighbour}, ${b!.farmId}, true, 'triticum_aestivum')`),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asFarm(b!.farmId, (tx) => tx`INSERT INTO article_seeds (article_id, farm_id, tgw_g, tgw_origin) VALUES (${neighbour}, ${b!.farmId}, 2500, 'label')`),
    ).rejects.toThrow(/check constraint/);
  });

  it("une espèce ne figure qu'une fois dans un mélange ; la fiche suit l'article", async () => {
    const [a] = farms;
    await expect(
      asFarm(a!.farmId, (tx) => tx`INSERT INTO seed_mixture_components (id, farm_id, article_id, label, position) VALUES (${crypto.randomUUID()}, ${a!.farmId}, ${mixture}, 'Avoine', 2)`),
    ).rejects.toThrow(/duplicate key/);
    await sql`DELETE FROM articles WHERE id = ${mixture}`;
    expect(await sql`SELECT 1 FROM article_seeds WHERE article_id = ${mixture}`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM seed_mixture_components WHERE article_id = ${mixture}`).toHaveLength(0);
  });

  it("couvert : espèces semées en tableau seulement", async () => {
    const [a] = farms;
    const parcel = crypto.randomUUID();
    await sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${parcel}, ${a!.farmId}, 'Grand champ')`;
    const cover = (components: string) =>
      sql`INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, family, species, sown_on, kind, components)
          VALUES (${crypto.randomUUID()}, ${a!.farmId}, ${parcel}, 2027, 'graminees_seigle_avoine', 'Avoine', '2026-08-20', 'sown', ${components}::text::jsonb)`;
    await expect(cover('{"label": "Avoine"}')).rejects.toThrow(/check constraint/);
    await cover('[{"label": "Avoine", "species": "avena_sativa", "kgHa": 8}]');
  });

  it("légumineuses d'après la taxonomie Lexicon, ou le genre d'une espèce absente", async () => {
    const [a] = farms;
    const taxa = await sql`SELECT count(*)::int AS n FROM taxonomy WHERE reference_name IN ('fabaceae', 'trifolium', 'vicia')`;
    if (taxa[0]!.n < 3) return; // référentiel non chargé (CI sans Lexicon)
    const found = await withFarm(db(), a!.farmId, (tx) =>
      legumeSpecies(tx, ["trifolium_incarnatum", "vicia_faba", "avena_sativa", "zea_mays", "vicia_inconnue_du_referentiel", "phacelia_tanacetifolia"]),
    );
    expect([...found].sort()).toEqual(["trifolium_incarnatum", "vicia_faba", "vicia_inconnue_du_referentiel"]);
    expect(await withFarm(db(), a!.farmId, (tx) => legumeSpecies(tx, []))).toEqual(new Set());
  });

  it("catalogue des variétés : recherche sans accents par la clé `search`", async () => {
    const [n] = await sql`SELECT count(*)::int AS n FROM lexicon_seed_varieties`;
    if (!n!.n) return; // catalogue non chargé
    const rows = await withFarm(db(), farms[0]!.farmId, (tx) => tx.execute(sqlTag`SELECT gnis_code FROM lexicon_seed_varieties WHERE search LIKE '%thermidor%'`));
    expect((rows as unknown as { gnis_code: string }[]).map((r) => r.gnis_code)).toContain("512E492");
  });
});
