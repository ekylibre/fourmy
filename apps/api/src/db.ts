import { createDb, type Database } from "@fourmy/db";

let instance: Database | undefined;

/** Instance Drizzle partagée (créée à la première requête). */
export function db(): Database {
  if (!instance) instance = createDb();
  return instance;
}
