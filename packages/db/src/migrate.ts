import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

/**
 * Applique en ordre les fichiers migrations/*.sql, une fois chacun.
 * Minimal volontairement : pas de dépendance à drizzle-kit au runtime, et
 * la DDL PostGIS/Timescale/RLS est écrite à la main.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const name of files) {
      const done = await sql`SELECT 1 FROM _migrations WHERE name = ${name}`;
      if (done.length) {
        console.log(`• ${name} (déjà appliquée)`);
        continue;
      }
      const ddl = await readFile(join(migrationsDir, name), "utf8");
      await sql.unsafe(ddl);
      await sql`INSERT INTO _migrations (name) VALUES (${name})`;
      console.log(`✓ ${name}`);
    }
    console.log("Migrations à jour.");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
