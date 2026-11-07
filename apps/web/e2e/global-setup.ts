import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadFixture, type FixtureFile } from "@fourmy/db";
import { hashPassword } from "better-auth/crypto";
import { E2E_EMAIL, E2E_PASSWORD, E2E_USER, FIXTURE } from "./shared";

/** Charge la ferme pilote viticole et y rattache l'utilisateur e2e (owner). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requis pour le parcours e2e (même base que l'API).");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const fixture = JSON.parse(await readFile(fileURLToPath(FIXTURE), "utf8")) as FixtureFile;
    await loadFixture(sql, fixture);
    const farmId = fixture.tables.farms![0]!.id as string;
    await sql`INSERT INTO users (id, email, name) VALUES (${E2E_USER}, ${E2E_EMAIL}, 'Parcours e2e') ON CONFLICT (id) DO NOTHING`;
    // Compte local au format better-auth (compte « credential » + hachage scrypt).
    await sql`INSERT INTO auth_accounts (user_id, account_id, provider_id, password)
              VALUES (${E2E_USER}, ${E2E_USER}, 'credential', ${await hashPassword(E2E_PASSWORD)})
              ON CONFLICT (provider_id, account_id) DO UPDATE SET password = excluded.password`;
    await sql`INSERT INTO memberships (id, farm_id, user_id, role) VALUES (gen_random_uuid(), ${farmId}, ${E2E_USER}, 'owner')
              ON CONFLICT (farm_id, user_id) DO NOTHING`;
    process.env.E2E_FARM_ID = farmId;
  } finally {
    await sql.end();
  }
}
