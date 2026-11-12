import { sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { Database } from "@fourmy/db";

/**
 * Crée un compte local (ou remplace son mot de passe s'il existe) — format
 * better-auth : utilisateur + compte `credential` portant le hachage scrypt.
 * Réservé à l'administration (CLI, amorçage de développement, tests).
 */
export async function upsertLocalUser(
  db: Database,
  input: { email: string; name?: string; password: string; id?: string },
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (input.password.length < 10) throw new Error("Mot de passe trop court (10 caractères au moins).");
  const hash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [user] = (await tx.execute(sql`
      INSERT INTO users (id, email, name)
      VALUES (coalesce(${input.id ?? null}::uuid, gen_random_uuid()), ${email}, ${input.name ?? null})
      ON CONFLICT (email) DO UPDATE SET name = coalesce(excluded.name, users.name), updated_at = now()
      RETURNING id`)) as unknown as { id: string }[];
    const id = user!.id;
    await tx.execute(sql`
      INSERT INTO auth_accounts (user_id, account_id, provider_id, password)
      VALUES (${id}, ${id}, 'credential', ${hash})
      ON CONFLICT (provider_id, account_id) DO UPDATE SET password = excluded.password, updated_at = now()`);
    return id;
  });
}

/**
 * Crée un compte local, jamais en remplaçant un compte existant (acceptation
 * d'une invitation) : null si l'email a déjà un compte.
 */
export async function createLocalUserIfAbsent(
  db: Database,
  input: { email: string; name?: string; password: string },
): Promise<string | null> {
  const email = input.email.trim().toLowerCase();
  if (input.password.length < 10) throw new Error("Mot de passe trop court (10 caractères au moins).");
  const hash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [user] = (await tx.execute(sql`
      INSERT INTO users (id, email, name, email_verified) VALUES (gen_random_uuid(), ${email}, ${input.name ?? null}, true)
      ON CONFLICT (email) DO NOTHING RETURNING id`)) as unknown as { id: string }[];
    if (!user) return null;
    await tx.execute(sql`
      INSERT INTO auth_accounts (user_id, account_id, provider_id, password)
      VALUES (${user.id}, ${user.id}, 'credential', ${hash})`);
    return user.id;
  });
}
