import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDb>;

/** Connexion applicative (rôle fourmy_app, soumise à la RLS). */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL manquant");
  const sql = postgres(url, { max: 10 });
  return drizzle(sql, { schema });
}

/**
 * Exécute une unité de travail dans le contexte d'une ferme : pose
 * `fourmy.farm_id` le temps de la transaction, pour que la RLS filtre.
 */
export async function withFarm<T>(
  db: Database,
  farmId: string,
  fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      // set_config(..., true) = portée transaction
      `select set_config('fourmy.farm_id', '${farmId}', true)` as unknown as never,
    );
    return fn(tx);
  });
}
