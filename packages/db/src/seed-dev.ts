#!/usr/bin/env node
import postgres from "postgres";

/**
 * Développement uniquement : crée l'utilisateur dev@fourmy.local et le rend
 * `owner` de toutes les fermes présentes. Affiche l'identifiant à passer en
 * en-tête `x-user-id` (en attendant better-auth).
 */
const DEV_USER = "00000000-0000-7000-8000-00000000de00";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
if (/prod/i.test(url)) throw new Error("Refus : seed de développement sur une base qui ressemble à la production.");

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql`INSERT INTO users (id, email, name) VALUES (${DEV_USER}, 'dev@fourmy.local', 'Développeur')
            ON CONFLICT (id) DO NOTHING`;
  const added = await sql`
    INSERT INTO memberships (id, farm_id, user_id, role)
    SELECT gen_random_uuid(), f.id, ${DEV_USER}, 'owner' FROM farms f
    ON CONFLICT (farm_id, user_id) DO NOTHING
    RETURNING farm_id`;
  const farms = await sql<{ id: string; name: string }[]>`SELECT id, name FROM farms ORDER BY name`;
  console.log(`Utilisateur de dev : ${DEV_USER} (en-tête x-user-id) — ${added.length} appartenance(s) ajoutée(s)`);
  console.table(farms);
} finally {
  await sql.end();
}
