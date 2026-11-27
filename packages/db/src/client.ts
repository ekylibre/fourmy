import { AsyncLocalStorage } from "node:async_hooks";
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
 * Périmètre d'activités de la requête en cours (lot AM2,
 * claudedocs/conception_api_mcp.md §5) : posé par l'API pour un accès limité
 * à des activités, lu par chaque {@link withFarm} de la requête. `null` ou
 * absent : aucun périmètre.
 */
const activityScope = new AsyncLocalStorage<readonly string[] | null>();

/** Exécute `fn` (et tout ce qu'elle attend) sous un périmètre d'activités. */
export function runWithActivityScope<T>(scope: readonly string[] | null, fn: () => T): T {
  return activityScope.run(scope, fn);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exécute une unité de travail dans le contexte d'une ferme.
 * Réglages, portée transaction :
 *   1. `SET LOCAL ROLE fourmy_app` — rôle non superuser, sinon la RLS est
 *      contournée (le rôle de connexion owner/superuser ignore la RLS) ;
 *   2. `fourmy.farm_id` — lu par les politiques via `current_farm_id()` ;
 *   3. `fourmy.activity_scope` — seulement sous {@link runWithActivityScope},
 *      lu par les politiques restrictives via `current_activity_scope()`.
 */
export async function withFarm<T>(
  db: Database,
  farmId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    await tx.execute(sql`SELECT set_config('fourmy.farm_id', ${farmId}, true)`);
    const scope = activityScope.getStore();
    if (scope) {
      // Identifiants vérifiés : la valeur devient un littéral de tableau PostgreSQL.
      if (!scope.every((id) => UUID_RE.test(id))) throw new Error("Périmètre d'activités invalide");
      await tx.execute(sql`SELECT set_config('fourmy.activity_scope', ${`{${scope.join(",")}}`}, true)`);
    }
    return fn(tx);
  });
}
