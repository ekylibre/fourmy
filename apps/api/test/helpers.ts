import type { Sql } from "postgres";
import { createApp } from "../src/app.js";
import { db } from "../src/db.js";
import { upsertLocalUser } from "../src/users.js";

const app = createApp();
export const TEST_PASSWORD = "mot-de-passe-de-test";

/** Connexion réelle (better-auth) ; renvoie le jeton signé à passer en Bearer. */
export async function signIn(email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const token = res.headers.get("set-auth-token");
  if (!res.ok || !token) throw new Error(`Connexion impossible pour ${email} (${res.status})`);
  return token;
}

/** Crée une ferme, un utilisateur et son appartenance ; renvoie les en-têtes d'appel. */
export async function setupFarm(sql: Sql, name: string, role: "owner" | "worker" | "reader" = "owner") {
  const farmId = crypto.randomUUID();
  await sql`INSERT INTO farms (id, name) VALUES (${farmId}, ${name})`;
  const member = await addMember(sql, farmId, role);
  return { farmId, ...member };
}

/** Crée un compte local, le rend membre de la ferme et le connecte. */
export async function addMember(sql: Sql, farmId: string, role: "owner" | "worker" | "reader") {
  const email = `${crypto.randomUUID()}@test.fourmy`;
  const userId = await upsertLocalUser(db(), { email, password: TEST_PASSWORD });
  await sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (${crypto.randomUUID()}, ${farmId}, ${userId}, ${role})`;
  const token = await signIn(email);
  return {
    userId,
    email,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } as Record<string, string>,
  };
}

/** Nettoyage : la ferme (CASCADE) puis les utilisateurs de test. */
export async function teardown(sql: Sql, farmId: string, userIds: string[]) {
  await sql`DELETE FROM farms WHERE id = ${farmId}`;
  if (userIds.length) await sql`DELETE FROM users WHERE id IN ${sql(userIds)}`;
}

/**
 * Référentiel phytosanitaire présent pour les tests qui contrôlent un
 * traitement : une base vierge (CI) n'a pas de version Lexicon chargée, et le
 * contrôle répond alors « Lexicon non chargé ». Version de test ajoutée si
 * aucune n'existe, jamais retirée : plusieurs fichiers de test tournent en
 * parallèle, et une base de développement garde sa vraie version.
 */
export async function ensurePhytoReferential(sql: Sql): Promise<void> {
  await sql`INSERT INTO lexicon_packages (name, version, source, rows) VALUES ('phytosanitary', 'test-fourmy', 'test', 0) ON CONFLICT DO NOTHING`;
}
