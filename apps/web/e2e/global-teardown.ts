import postgres from "postgres";
import { E2E_USER } from "./shared";

/** Efface ce que le parcours a créé (interventions saisies par l'utilisateur e2e). */
export default async function globalTeardown() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    const ids = await sql<{ id: string }[]>`
      SELECT DISTINCT entity_id AS id FROM audit_log WHERE actor = ${E2E_USER} AND entity = 'intervention'`;
    if (ids.length) {
      const list = ids.map((r) => r.id);
      await sql`DELETE FROM outbox_events WHERE payload->'data'->>'interventionId' IN ${sql(list)}`;
      await sql`DELETE FROM stock_movements WHERE intervention_id IN ${sql(list)}`;
      await sql`DELETE FROM interventions WHERE id IN ${sql(list)}`;
    }
    await sql`DELETE FROM audit_log WHERE actor = ${E2E_USER}`;
    await sql`DELETE FROM memberships WHERE user_id = ${E2E_USER}`;
    await sql`DELETE FROM users WHERE id = ${E2E_USER}`;
  } finally {
    await sql.end();
  }
}
