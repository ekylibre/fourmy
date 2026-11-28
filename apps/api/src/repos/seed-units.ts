import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { SeedUnitCodeName, SeedUnitRewrite, SeedUnitRewriteResult, SeedUnitRewriteSkip, SeedUnitRewriteWrite } from "@fourmy/contracts";
import { canonicalSeedUnit } from "@fourmy/domain";

/**
 * Réécriture des unités reprises des semences (issue #130, lot SU3,
 * claudedocs/conception_semences_unites.md §5) : chaque unité reprise reçoit
 * le code canonique de même grandeur (« Sac de 50 000 grains » → dose de
 * 50 000 grains). Aucune quantité n'est convertie ; l'article, ses
 * mouvements, ses intrants d'intervention, ses prix et ses dérogations
 * changent de libellé ensemble, article par article.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

type ArticleRow = { id: string; name: string; unit: string; grains_per_dose: number | null };

/** Proposition pour un article, recalculée à l'identique au moment de réécrire. */
function proposalOf(a: ArticleRow): Pick<SeedUnitRewrite, "to" | "grainsPerDose" | "conflict"> | null {
  const c = canonicalSeedUnit(a.unit, a.grains_per_dose);
  if (!c) return null;
  if ("conflict" in c) return { to: null, grainsPerDose: a.grains_per_dose, conflict: c.conflict };
  return { to: c.code as SeedUnitCodeName, grainsPerDose: c.grainsPerDose, conflict: null };
}

/** Intrants et sorties d'intervention qui citent l'article dans l'unité `from`, avec ou sans rapport à la surface. */
const paramsIn = (articleId: string, from: string) => sql`
  ip.ref_type = 'article' AND ip.ref_id = ${articleId} AND ip.role IN ('input', 'output')
  AND left(ip.unit, length(${from})) = ${from}
  AND (length(ip.unit) = length(${from}) OR substr(ip.unit, length(${from}) + 1) IN ('_per_hectare', '_per_square_meter'))`;

/** Les semences dont l'unité reprise peut s'écrire en code canonique (GET /seeds/units). */
export async function seedUnitRewrites(db: Database, farmId: string): Promise<SeedUnitRewrite[]> {
  return withFarm(db, farmId, async (tx) => {
    const articles = await rows<ArticleRow>(
      tx,
      sql`SELECT a.id, a.name, a.unit, s.grains_per_dose FROM articles a LEFT JOIN article_seeds s ON s.article_id = a.id
          WHERE a.kind = 'seed' ORDER BY a.name`,
    );
    const out: SeedUnitRewrite[] = [];
    for (const a of articles) {
      const p = proposalOf(a);
      if (!p) continue;
      const [u] = await rows<{ stock: number; movements: number; interventions: number; prices: number }>(
        tx,
        sql`SELECT coalesce((SELECT sum(m.quantity)::float8 FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE l.article_id = ${a.id} AND m.occurred_at <= now()), 0) AS stock,
                   (SELECT count(*)::int FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE l.article_id = ${a.id} AND m.unit = ${a.unit}) AS movements,
                   (SELECT count(DISTINCT ip.intervention_id)::int FROM intervention_parameters ip WHERE ${paramsIn(a.id, a.unit)}) AS interventions,
                   (SELECT count(*)::int FROM prices WHERE article_id = ${a.id} AND unit = ${a.unit}) AS prices`,
      );
      out.push({ articleId: a.id, name: a.name, from: a.unit, ...p, stock: u!.stock, usage: { movements: u!.movements, interventions: u!.interventions, prices: u!.prices } });
    }
    return out;
  });
}

/** Stock de chaque lot de l'article, aujourd'hui et au 1er janvier de chaque année mouvementée (NF-SU-1). */
async function stockSnapshot(tx: Tx, articleId: string): Promise<string> {
  const list = await rows<{ lot_id: string; on: string; quantity: number }>(
    tx,
    sql`WITH dates AS (
          SELECT now() AS on_
          UNION SELECT make_timestamptz(extract(year FROM m.occurred_at)::int, 1, 1, 0, 0, 0, 'Europe/Paris')
          FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE l.article_id = ${articleId}
        )
        SELECT l.id AS lot_id, d.on_::text AS on,
               coalesce((SELECT sum(m.quantity) FROM stock_movements m WHERE m.lot_id = l.id AND m.occurred_at <= d.on_), 0)::text AS quantity
        FROM lots l CROSS JOIN dates d WHERE l.article_id = ${articleId}
        ORDER BY l.id, d.on_`,
  );
  return JSON.stringify(list);
}

class Skip extends Error {
  constructor(readonly reason: SeedUnitRewriteSkip) {
    super(reason);
  }
}

/**
 * Réécrit les unités choisies (POST /seeds/units, responsable). Une
 * transaction par article : un article refusé n'empêche pas les autres.
 */
export async function rewriteSeedUnits(db: Database, farmId: string, userId: string, w: SeedUnitRewriteWrite): Promise<SeedUnitRewriteResult> {
  const result: SeedUnitRewriteResult = { rewritten: [], skipped: [] };
  for (const item of w.items) {
    try {
      const done = await withFarm(db, farmId, (tx) => rewriteOne(tx, farmId, userId, item.articleId, item.to));
      result.rewritten.push(done);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      result.skipped.push({ articleId: item.articleId, reason: e.reason });
    }
  }
  return result;
}

async function rewriteOne(tx: Tx, farmId: string, userId: string, articleId: string, to: SeedUnitCodeName): Promise<SeedUnitRewriteResult["rewritten"][number]> {
  const [a] = await rows<ArticleRow>(
    tx,
    sql`SELECT a.id, a.name, a.unit, s.grains_per_dose FROM articles a LEFT JOIN article_seeds s ON s.article_id = a.id
        WHERE a.id = ${articleId} AND a.kind = 'seed' FOR UPDATE OF a`,
  );
  if (!a) throw new Skip("not_found");
  const p = proposalOf(a);
  if (p?.conflict) throw new Skip("conflict");
  // Unité changée depuis la proposition, ou code autre que celui de même grandeur.
  if (!p || p.to !== to) throw new Skip("changed");
  const from = a.unit;
  const before = await stockSnapshot(tx, articleId);

  const movements = await rows(
    tx,
    sql`UPDATE stock_movements m SET unit = ${to} FROM lots l WHERE l.id = m.lot_id AND l.article_id = ${articleId} AND m.unit = ${from} RETURNING m.id`,
  );
  const parameters = await rows(
    tx,
    sql`UPDATE intervention_parameters ip SET unit = ${to} || substr(ip.unit, length(${from}) + 1) WHERE ${paramsIn(articleId, from)} RETURNING ip.id`,
  );
  const prices = await rows(tx, sql`UPDATE prices SET unit = ${to} WHERE article_id = ${articleId} AND unit = ${from} RETURNING id`);
  const derogations = await rows(tx, sql`UPDATE seed_derogations SET unit = ${to} WHERE article_id = ${articleId} AND unit = ${from} RETURNING id`);
  if (to === "dose" && p.grainsPerDose !== null) {
    await tx.execute(sql`
      INSERT INTO article_seeds (article_id, farm_id, grains_per_dose, updated_by, updated_at)
      VALUES (${articleId}, ${farmId}, ${p.grainsPerDose}, ${userId}, now())
      ON CONFLICT (article_id) DO UPDATE SET grains_per_dose = coalesce(article_seeds.grains_per_dose, EXCLUDED.grains_per_dose)`);
  }
  // La reprise d'Ekylibre reconnaît l'unité d'origine (lot SU5) ; le mobile relit l'article (updated_at).
  const rewrite = { from, at: new Date().toISOString(), by: userId };
  await tx.execute(sql`
    UPDATE articles SET unit = ${to}, updated_at = now(),
      custom = coalesce(custom, '{}'::jsonb) || jsonb_build_object('unitRewrite', ${JSON.stringify(rewrite)}::jsonb)
    WHERE id = ${articleId}`);
  const counts = { movements: movements.length, parameters: parameters.length, prices: prices.length, derogations: derogations.length };
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
    VALUES (${crypto.randomUUID()}, ${farmId}, ${userId}, 'web', 'article', ${articleId}, 'unit_rewritten',
            ${JSON.stringify({ from, to, grainsPerDose: p.grainsPerDose, rows: counts })}::jsonb, now())`);

  // Garde-fou : le stock de chaque lot, à chaque date, est le même qu'avant.
  if ((await stockSnapshot(tx, articleId)) !== before) throw new Skip("stock_mismatch");
  return { articleId, from, to, rows: counts };
}
