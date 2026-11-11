import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { FertilizerArticle, FertilizerComposition, FertilizerWrite, ProductAnalysis, ProductAnalysisWrite } from "@fourmy/contracts";
import { proposeComposition } from "@fourmy/domain";
import { NotFound } from "../routes/helpers.js";

/**
 * Fertilisants de la ferme (lot AE, docs/fertilisation-design.md §4.1) :
 * composition enregistrée (reprise d'Ekylibre, confirmée, issue d'une
 * analyse) ou proposée par Fourmy, et analyses de produits organiques.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type Row = {
  id: string;
  name: string;
  kind: string;
  unit: string;
  lexicon_ref: string | null;
  basis: FertilizerComposition["basis"] | null;
  n_total: string | null;
  n_mineral_share: string | null;
  p2o5: string | null;
  k2o: string | null;
  so3: string | null;
  density: string | null;
  nitrate_type: FertilizerComposition["nitrateType"];
  foliar: boolean | null;
  origin: FertilizerArticle["origin"];
  source: string | null;
  usage: number;
};

function composition(r: Row): FertilizerComposition | null {
  if (!r.basis) return null;
  return {
    basis: r.basis,
    nTotal: n(r.n_total)!,
    nMineralShare: n(r.n_mineral_share),
    p2o5: n(r.p2o5),
    k2o: n(r.k2o),
    so3: n(r.so3),
    density: n(r.density),
    nitrateType: r.nitrate_type,
    foliar: r.foliar ?? false,
  };
}

const SELECT = sql`
  SELECT a.id, a.name, a.kind, a.unit, a.lexicon_ref,
         f.basis, f.n_total, f.n_mineral_share, f.p2o5, f.k2o, f.so3, f.density, f.nitrate_type, f.foliar, f.origin, f.source,
         (SELECT count(DISTINCT p.intervention_id)::int FROM intervention_parameters p JOIN interventions i ON i.id = p.intervention_id
          WHERE p.role = 'input' AND p.ref_id = a.id AND i.status = 'done') AS usage
  FROM articles a LEFT JOIN article_fertilizers f ON f.article_id = a.id`;

async function analysesOf(tx: Tx, ids: string[]): Promise<Map<string, ProductAnalysis[]>> {
  const out = new Map<string, ProductAnalysis[]>();
  if (!ids.length) return out;
  const list = await rows<{ id: string; article_id: string; sampled_on: string; basis: "kg_per_t" | "kg_per_m3"; dry_matter: string | null; n_total: string; n_nh4: string | null; c_n: string | null; lab: string | null }>(
    tx,
    sql`SELECT id, article_id, sampled_on::text, basis, dry_matter, n_total, n_nh4, c_n, lab FROM product_analyses
        WHERE article_id IN (SELECT unnest(${`{${ids.join(",")}}`}::uuid[])) ORDER BY sampled_on DESC`,
  );
  for (const a of list) {
    const item: ProductAnalysis = {
      id: a.id,
      articleId: a.article_id,
      sampledOn: a.sampled_on,
      basis: a.basis,
      dryMatter: n(a.dry_matter),
      nTotal: n(a.n_total)!,
      nNh4: n(a.n_nh4),
      cN: n(a.c_n),
      lab: a.lab,
    };
    out.set(a.article_id, [...(out.get(a.article_id) ?? []), item]);
  }
  return out;
}

function view(r: Row, analyses: ProductAnalysis[]): FertilizerArticle {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    unit: r.unit,
    lexiconRef: r.lexicon_ref,
    composition: composition(r),
    origin: r.origin,
    source: r.source,
    proposal: proposeComposition({ name: r.name, lexiconRef: r.lexicon_ref }),
    analyses,
    usage: r.usage,
  };
}

/**
 * Fertilisants de la ferme : articles de nature « fertilisant », et tout
 * article qui a une composition (amendement, engrais rangé en « autre »).
 */
export async function listFertilizers(db: Database, farmId: string): Promise<FertilizerArticle[]> {
  return withFarm(db, farmId, fertilizersInTx);
}

/** Fertilisants lus dans une transaction déjà ouverte (contrôle à l'enregistrement d'une intervention). */
export async function fertilizersInTx(tx: Tx): Promise<FertilizerArticle[]> {
  const list = await rows<Row>(tx, sql`${SELECT} WHERE a.kind = 'fertilizer' OR f.article_id IS NOT NULL ORDER BY a.name`);
  const analyses = await analysesOf(tx, list.map((r) => r.id));
  return list.map((r) => view(r, analyses.get(r.id) ?? []));
}

export async function getFertilizer(db: Database, farmId: string, articleId: string): Promise<FertilizerArticle> {
  return withFarm(db, farmId, async (tx) => {
    const [r] = await rows<Row>(tx, sql`${SELECT} WHERE a.id = ${articleId}`);
    if (!r) throw new NotFound("Article introuvable.");
    return view(r, (await analysesOf(tx, [r.id])).get(r.id) ?? []);
  });
}

/** Composition saisie ou confirmée par l'utilisateur. */
export async function saveFertilizer(db: Database, farmId: string, userId: string, articleId: string, w: FertilizerWrite): Promise<FertilizerArticle> {
  await withFarm(db, farmId, async (tx) => {
    const [a] = await rows(tx, sql`SELECT id FROM articles WHERE id = ${articleId}`);
    if (!a) throw new NotFound("Article introuvable.");
    await tx.execute(sql`
      INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, n_mineral_share, p2o5, k2o, so3, density, nitrate_type, foliar, origin, source, updated_by)
      VALUES (${articleId}, ${farmId}, ${w.basis}, ${w.nTotal}, ${w.nMineralShare}, ${w.p2o5}, ${w.k2o}, ${w.so3}, ${w.density}, ${w.nitrateType}, ${w.foliar}, 'confirmed', ${w.source}, ${userId})
      ON CONFLICT (article_id) DO UPDATE SET basis = excluded.basis, n_total = excluded.n_total, n_mineral_share = excluded.n_mineral_share,
        p2o5 = excluded.p2o5, k2o = excluded.k2o, so3 = excluded.so3, density = excluded.density, nitrate_type = excluded.nitrate_type,
        foliar = excluded.foliar, origin = 'confirmed', source = excluded.source, updated_by = excluded.updated_by, updated_at = now()`);
  });
  return getFertilizer(db, farmId, articleId);
}

/** Retire la composition enregistrée : l'article revient à la proposition de Fourmy. */
export async function clearFertilizer(db: Database, farmId: string, articleId: string): Promise<FertilizerArticle> {
  await withFarm(db, farmId, (tx) => tx.execute(sql`DELETE FROM article_fertilizers WHERE article_id = ${articleId}`));
  return getFertilizer(db, farmId, articleId);
}

export async function addProductAnalysis(db: Database, farmId: string, userId: string, articleId: string, w: ProductAnalysisWrite): Promise<FertilizerArticle> {
  await withFarm(db, farmId, async (tx) => {
    const [a] = await rows(tx, sql`SELECT id FROM articles WHERE id = ${articleId}`);
    if (!a) throw new NotFound("Article introuvable.");
    await tx.execute(sql`
      INSERT INTO product_analyses (id, farm_id, article_id, sampled_on, basis, dry_matter, n_total, n_nh4, c_n, lab, created_by)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${articleId}, ${w.sampledOn}::date, ${w.basis}, ${w.dryMatter}, ${w.nTotal}, ${w.nNh4}, ${w.cN}, ${w.lab}, ${userId})`);
  });
  return getFertilizer(db, farmId, articleId);
}

export async function removeProductAnalysis(db: Database, farmId: string, articleId: string, analysisId: string): Promise<FertilizerArticle> {
  await withFarm(db, farmId, async (tx) => {
    const removed = await rows(tx, sql`DELETE FROM product_analyses WHERE id = ${analysisId} AND article_id = ${articleId} RETURNING id`);
    if (removed.length) await tx.execute(sql`DELETE FROM regulatory_documents WHERE owner_type = 'product_analysis' AND owner_id = ${analysisId}`);
    if (!removed.length) throw new NotFound("Analyse introuvable.");
  });
  return getFertilizer(db, farmId, articleId);
}
