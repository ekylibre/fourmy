import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import type { Article } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";
import { BadRequest } from "./helpers.js";

const KINDS = ["phyto", "fertilizer", "seed", "harvest", "wine", "other"];

/** Catalogue d'articles de la ferme (intrants, sorties), filtrable par nature. */
export const articleRoutes = new Hono<Env>().get("/articles", async (c) => {
  const kind = c.req.query("kind");
  if (kind && !KINDS.includes(kind)) throw new BadRequest(`kind : ${KINDS.join(", ")}`);
  const items = await withFarm(db(), c.get("farmId"), async (tx) =>
    (await tx.execute(sql`
      SELECT id, farm_id AS "farmId", lexicon_ref AS "lexiconRef", name, kind, unit, amm,
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM articles ${kind ? sql`WHERE kind = ${kind}` : sql``}
      ORDER BY name`)) as unknown as Article[],
  );
  return c.json({
    items: items.map((a) => ({
      ...a,
      amm: a.amm ?? undefined,
      createdAt: new Date(a.createdAt).toISOString(),
      updatedAt: new Date(a.updatedAt).toISOString(),
    })),
    nextCursor: null,
  });
});
