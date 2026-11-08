import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { operatingHoursByDay, parisDay, type UsageDay } from "@fourmy/domain";

/**
 * Heures de fonctionnement estimées (lot L, FR-MAT-13) : les boîtiers du
 * pilote ne remontent pas de compteur ; on déduit des positions Traccar la
 * durée de fonctionnement de chaque jour, stockée par jour. Les échéances
 * l'ajoutent au dernier relevé réel (recalage automatique).
 */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

/** Recalcule les jours d'activité des matériels à compteur suivis par Traccar (depuis la veille du dernier jour connu). */
export async function computeUsageDays(db: Database, farmId: string): Promise<{ equipments: number; days: number }> {
  return withFarm(db, farmId, async (tx) => {
    const [integration] = await rows<{ enabled: boolean }>(tx, sql`SELECT enabled FROM integrations WHERE provider = 'traccar'`);
    // Intégration coupée : plus de calcul, les jours déjà calculés restent.
    if (!integration?.enabled) return { equipments: 0, days: 0 };
    const eqs = await rows<{ id: string; last: string | null }>(
      tx,
      sql`SELECT e.id, (SELECT max(day)::text FROM equipment_usage_days u WHERE u.equipment_id = e.id AND u.source = 'traccar') AS last
          FROM equipments e
          WHERE e.meter_unit IS NOT NULL AND EXISTS (SELECT 1 FROM tracker_bindings b WHERE b.equipment_id = e.id)`,
    );
    let days = 0;
    for (const e of eqs) {
      // La veille du dernier jour calculé (positions arrivées en retard), sinon tout l'historique.
      const since = e.last ? new Date(Date.parse(`${e.last}T00:00:00Z`) - 2 * 86_400_000).toISOString() : "-infinity";
      const positions = await rows<{ time: string; speed: string | null; working: boolean | null }>(
        tx,
        sql`SELECT p.time, p.speed, (p.attrs->>'working')::boolean AS working
            FROM positions p JOIN tracker_bindings b ON b.id = p.binding_id
            WHERE b.equipment_id = ${e.id} AND p.time >= ${since}::timestamptz AND b.valid @> p.time
            ORDER BY p.time`,
      );
      const computed = operatingHoursByDay(
        positions.map((p) => ({ time: new Date(p.time).toISOString(), speedKmh: p.speed === null ? null : Number(p.speed), working: p.working })),
      ).filter((d) => !e.last || d.day >= parisDay(since));
      for (const d of computed) {
        await tx.execute(sql`
          INSERT INTO equipment_usage_days (farm_id, equipment_id, day, hours, source)
          VALUES (${farmId}, ${e.id}, ${d.day}::date, ${d.hours}, 'traccar')
          ON CONFLICT (equipment_id, source, day) DO UPDATE SET hours = excluded.hours, computed_at = now()`);
      }
      days += computed.length;
    }
    return { equipments: eqs.length, days };
  });
}

/** Jours d'activité estimés, par matériel. */
export async function usageDaysOf(tx: Tx, equipmentIds: string[]): Promise<Map<string, UsageDay[]>> {
  const out = new Map<string, UsageDay[]>(equipmentIds.map((id) => [id, []]));
  if (!equipmentIds.length) return out;
  const list = await rows<{ equipment_id: string; day: string; hours: string }>(
    tx,
    sql`SELECT equipment_id, day::text AS day, hours FROM equipment_usage_days
        WHERE equipment_id IN (${sql.join(
          equipmentIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) ORDER BY day`,
  );
  for (const r of list) out.get(r.equipment_id)?.push({ day: r.day, hours: Number(r.hours) });
  return out;
}

/** Fermes dont l'intégration Traccar est active (tâche du worker). */
export async function farmsWithTraccar(db: Database): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return (await rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM fourmy_traccar_farms()`)).map((r) => r.farm_id);
  });
}
