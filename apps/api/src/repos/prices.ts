import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { Price, PriceKind, priceWrite } from "@fourmy/contracts";
import type { z } from "zod";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Prix de la ferme, datés et sourcés (temps 3, lot E1,
 * claudedocs/conception_assolement_eco.md §2.1 et §4). Une modification
 * ajoute une ligne ; on ne réécrit jamais un prix.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

type Row = {
  id: string;
  kind: PriceKind;
  article_id: string | null;
  equipment_id: string | null;
  activity_id: string | null;
  product: string | null;
  procedure: string | null;
  unit: string;
  amount: string;
  valid_from: string;
  source: Price["source"];
  source_ref: string | null;
  source_date: string | null;
  note: string | null;
  created_at: string;
};

const read = (r: Row): Price => ({
  id: r.id,
  kind: r.kind,
  articleId: r.article_id,
  equipmentId: r.equipment_id,
  activityId: r.activity_id,
  product: r.product,
  procedure: r.procedure,
  unit: r.unit,
  amount: Number(r.amount),
  validFrom: r.valid_from,
  source: r.source,
  sourceRef: r.source_ref,
  sourceDate: r.source_date,
  note: r.note,
  createdAt: new Date(r.created_at).toISOString(),
});

const COLS = sql`id, kind, article_id, equipment_id, activity_id, product, procedure, unit, amount::text, valid_from::text, source, source_ref, source_date::text, note, created_at::text`;

/**
 * Prix de la ferme : en vigueur à `at` (une ligne par clé), ou tout
 * l'historique. Le calcul du prix en vigueur se fait aussi dans le domaine
 * (`priceAt`) ; ici, pour alléger la réponse.
 */
export async function listPrices(db: Database, farmId: string, q: { kind?: PriceKind; at: string; history: boolean }): Promise<Price[]> {
  return withFarm(db, farmId, async (tx) => {
    const kind = q.kind ? sql`AND kind = ${q.kind}` : sql``;
    if (q.history) return (await rows<Row>(tx, sql`SELECT ${COLS} FROM prices WHERE true ${kind} ORDER BY valid_from DESC, created_at DESC`)).map(read);
    return (
      await rows<Row>(
        tx,
        sql`SELECT DISTINCT ON (kind, article_id, equipment_id, activity_id, product, procedure) ${COLS}
            FROM prices WHERE valid_from <= ${q.at}::date ${kind}
            ORDER BY kind, article_id, equipment_id, activity_id, product, procedure, valid_from DESC, created_at DESC`,
      )
    ).map(read);
  });
}

/** Ajout en masse : une ligne datée par prix. Les objets cités doivent être de la ferme (RLS). */
export async function addPrices(db: Database, farmId: string, items: z.output<typeof priceWrite>[], userId: string, newId: () => string): Promise<Price[]> {
  return withFarm(db, farmId, async (tx) => {
    const check = async (table: "articles" | "equipments" | "activities", ids: (string | null)[], what: string) => {
      const wanted = [...new Set(ids.filter((x): x is string => !!x))];
      if (!wanted.length) return;
      const [n] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE id = ANY(${`{${wanted.join(",")}}`}::uuid[])`);
      if (n!.n !== wanted.length) throw new BadRequest(`${what} inconnu dans cette ferme.`);
    };
    await check("articles", items.map((i) => i.articleId), "Article");
    await check("equipments", items.map((i) => i.equipmentId), "Matériel");
    await check("activities", items.map((i) => i.activityId), "Activité");
    const out: Price[] = [];
    for (const i of items) {
      const [r] = await rows<Row>(
        tx,
        sql`INSERT INTO prices (id, farm_id, kind, article_id, equipment_id, activity_id, product, procedure, unit, amount, valid_from, source, source_ref, source_date, note, created_by)
            VALUES (${i.id ?? newId()}, ${farmId}, ${i.kind}, ${i.articleId}, ${i.equipmentId}, ${i.activityId}, ${i.product}, ${i.procedure}, ${i.unit}, ${i.amount},
                    ${i.validFrom}::date, ${i.source}, ${i.sourceRef}, ${i.sourceDate}::date, ${i.note}, ${userId})
            ON CONFLICT (id) DO NOTHING RETURNING ${COLS}`,
      );
      if (r) out.push(read(r));
    }
    return out;
  });
}

export async function deletePrice(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(tx, sql`DELETE FROM prices WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Prix introuvable.");
  });
}


