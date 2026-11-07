import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import type { StockLevel } from "@fourmy/contracts";

/**
 * Stocks à une date : somme des mouvements (journal immuable, §4.4) par lot
 * et par lieu. Filtres : article, lieu (bâtiment ou cuve).
 */
export async function stockAt(
  db: Database,
  farmId: string,
  q: { at: string; articleId?: string; locationId?: string },
): Promise<StockLevel[]> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT a.id AS article_id, a.name AS article_name, a.kind AS article_kind,
             l.id AS lot_id, l.code AS lot_code, m.place_id, m.container_id,
             sum(m.quantity)::float8 AS quantity, m.unit
      FROM stock_movements m
      JOIN lots l ON l.id = m.lot_id
      JOIN articles a ON a.id = l.article_id
      WHERE m.occurred_at <= ${q.at}::timestamptz
        ${q.articleId ? sql`AND a.id = ${q.articleId}` : sql``}
        ${q.locationId ? sql`AND (m.place_id = ${q.locationId} OR m.container_id = ${q.locationId})` : sql``}
      GROUP BY a.id, a.name, a.kind, l.id, l.code, m.place_id, m.container_id, m.unit
      HAVING sum(m.quantity) <> 0
      ORDER BY a.name, l.code`)) as unknown as {
      article_id: string;
      article_name: string;
      article_kind: string;
      lot_id: string;
      lot_code: string;
      place_id: string | null;
      container_id: string | null;
      quantity: number;
      unit: string;
    }[];
    return rows.map((r) => ({
      articleId: r.article_id,
      articleName: r.article_name,
      articleKind: r.article_kind,
      lotId: r.lot_id,
      lotCode: r.lot_code,
      placeId: r.place_id,
      containerId: r.container_id,
      quantity: r.quantity,
      unit: r.unit,
    }));
  });
}
