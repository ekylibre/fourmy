import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Connexion applicative. Les requêtes passent par {@link withFarm} (RLS). */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL manquant");
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema });
}

/**
 * Exécute une unité de travail dans le contexte d'une ferme.
 * Deux réglages, portée transaction :
 *   1. `SET LOCAL ROLE fourmy_app` — rôle non superuser, sinon la RLS est
 *      contournée (le rôle de connexion owner/superuser ignore la RLS) ;
 *   2. `fourmy.farm_id` — lu par les politiques via `current_farm_id()`.
 */
export async function withFarm<T>(
  db: Database,
  farmId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    await tx.execute(sql`SELECT set_config('fourmy.farm_id', ${farmId}, true)`);
    return fn(tx);
  });
}
