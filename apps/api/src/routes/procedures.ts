import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { withFarm } from "@fourmy/db";
import { PROCEDURES, getProcedure, TREATMENT_PURPOSE_LABELS, SHAPE_LABELS } from "@fourmy/contracts";
import type { Env } from "../context.js";
import { db } from "../db.js";

type Usage = { procedure: string; role: string; ref_id: string; n: number };

/**
 * Catalogue des procédures (docs/interventions.md §3), enrichi des
 * suggestions de la ferme : pour chaque procédure, les matériels, produits et
 * personnes les plus utilisés ces 3 dernières années ; `usage` = nombre d'interventions réalisées. Les procédures reprises
 * d'Ekylibre hors catalogue sont ajoutées si la ferme les a utilisées.
 */
export const procedureRoutes = new Hono<Env>().get("/procedures", async (c) => {
  const { usage, counts } = await withFarm(db(), c.get("farmId"), async (tx) => ({
    usage: (await tx.execute(sql`
      SELECT i.procedure, p.role, p.ref_id, count(*)::int AS n
      FROM interventions i JOIN intervention_parameters p ON p.intervention_id = i.id
      WHERE i.status = 'done' AND p.ref_id IS NOT NULL
        AND p.role IN ('tool', 'input', 'doer')
        AND p.ref_type IN ('equipment', 'article', 'person')
        AND coalesce(i.stopped_at, i.created_at) > now() - interval '3 years'
      GROUP BY 1, 2, 3`)) as unknown as Usage[],
    counts: (await tx.execute(sql`
      SELECT procedure, count(*)::int AS n FROM interventions
      WHERE status = 'done' AND coalesce(stopped_at, created_at) > now() - interval '3 years'
      GROUP BY 1`)) as unknown as { procedure: string; n: number }[],
  }));
  const top = (code: string, role: string, n: number) =>
    usage.filter((u) => u.procedure === code && u.role === role).sort((a, b) => b.n - a.n).slice(0, n).map((u) => u.ref_id);
  const used = new Map(counts.map((u) => [u.procedure, u.n]));
  const legacy = [...used.keys()].filter((code) => !PROCEDURES.some((p) => p.code === code)).map(getProcedure);

  return c.json({
    shapes: SHAPE_LABELS,
    purposes: TREATMENT_PURPOSE_LABELS,
    items: [...PROCEDURES, ...legacy].map((p) => ({
      ...p,
      usage: used.get(p.code) ?? 0,
      suggestions: { tools: top(p.code, "tool", 3), inputs: top(p.code, "input", 5), doers: top(p.code, "doer", 3) },
    })),
  });
});
