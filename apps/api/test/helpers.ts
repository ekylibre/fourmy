import type { Sql } from "postgres";

/** Crée une ferme, un utilisateur et son appartenance ; renvoie les en-têtes d'appel. */
export async function setupFarm(sql: Sql, name: string, role: "owner" | "worker" = "owner") {
  const farmId = crypto.randomUUID();
  await sql`INSERT INTO farms (id, name) VALUES (${farmId}, ${name})`;
  const member = await addMember(sql, farmId, role);
  return { farmId, ...member };
}

/** Ajoute un utilisateur membre d'une ferme existante. */
export async function addMember(sql: Sql, farmId: string, role: "owner" | "worker") {
  const userId = crypto.randomUUID();
  await sql`INSERT INTO users (id, email) VALUES (${userId}, ${`${userId}@test.fourmy`})`;
  await sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (${crypto.randomUUID()}, ${farmId}, ${userId}, ${role})`;
  return {
    userId,
    headers: { "x-user-id": userId, "content-type": "application/json" } as Record<string, string>,
  };
}

/** Nettoyage : la ferme (CASCADE) puis les utilisateurs de test. */
export async function teardown(sql: Sql, farmId: string, userIds: string[]) {
  await sql`DELETE FROM farms WHERE id = ${farmId}`;
  if (userIds.length) await sql`DELETE FROM users WHERE id IN ${sql(userIds)}`;
}
