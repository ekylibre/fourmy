import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { SteeringMeasurement, SteeringWrite } from "@fourmy/contracts";
import { NotFound } from "../routes/helpers.js";

/**
 * Mesures de pilotage (lot AJ, FR-FERT-17) : date, stade, outil, valeur et
 * dose conseillée pour l'apport de pilotage. Elles justifient un dépassement
 * de la dose du plan et figurent au cahier.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
type Row = { id: string; plan_id: string; measured_on: string; stage: string | null; tool: string; value: string | null; advised_kg_n_ha: string; notes: string | null; created_at: string | Date };
const view = (r: Row): SteeringMeasurement => ({
  id: r.id,
  planId: r.plan_id,
  measuredOn: r.measured_on,
  stage: r.stage,
  tool: r.tool,
  value: r.value,
  advisedKgNHa: Number(r.advised_kg_n_ha),
  notes: r.notes,
  createdAt: new Date(r.created_at).toISOString(),
});
const COLUMNS = sql`id, plan_id, measured_on::text, stage, tool, value, advised_kg_n_ha, notes, created_at`;

/** Mesures par plan. */
export async function steeringInTx(tx: Tx, planIds: string[]): Promise<Map<string, SteeringMeasurement[]>> {
  const out = new Map<string, SteeringMeasurement[]>();
  if (!planIds.length) return out;
  const list = await rows<Row>(tx, sql`SELECT ${COLUMNS} FROM steering_measurements WHERE plan_id IN (SELECT unnest(${`{${planIds.join(",")}}`}::uuid[])) ORDER BY measured_on, created_at`);
  for (const r of list) out.set(r.plan_id, [...(out.get(r.plan_id) ?? []), view(r)]);
  return out;
}

export async function addSteering(db: Database, farmId: string, userId: string | null, planId: string, w: SteeringWrite): Promise<SteeringMeasurement> {
  return withFarm(db, farmId, async (tx) => {
    const [plan] = await rows(tx, sql`SELECT id FROM fertilization_plans WHERE id = ${planId} AND farm_id = ${farmId}`);
    if (!plan) throw new NotFound("Plan de fumure introuvable.");
    const [r] = await rows<Row>(
      tx,
      sql`INSERT INTO steering_measurements (id, farm_id, plan_id, measured_on, stage, tool, value, advised_kg_n_ha, notes, created_by)
          VALUES (${crypto.randomUUID()}, ${farmId}, ${planId}, ${w.measuredOn}::date, ${w.stage}, ${w.tool}, ${w.value}, ${w.advisedKgNHa}, ${w.notes}, ${userId})
          RETURNING ${COLUMNS}`,
    );
    return view(r!);
  });
}

export async function deleteSteering(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(tx, sql`DELETE FROM steering_measurements WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Mesure introuvable.");
    await tx.execute(sql`DELETE FROM regulatory_documents WHERE owner_type = 'steering' AND owner_id = ${id}`);
  });
}
