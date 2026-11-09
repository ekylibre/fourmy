#!/usr/bin/env node
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { LEXICON_PACKAGES_URL, syncLexicon } from "@fourmy/lexicon";
import { db } from "../db.js";
import { upsertLocalUser } from "../users.js";

/**
 * Développement uniquement : compte dev@fourmy.local (mot de passe ci-dessous,
 * public par construction) rendu `owner` de toutes les fermes présentes.
 */
export const DEV_USER = "00000000-0000-7000-8000-00000000de00";
export const DEV_EMAIL = "dev@fourmy.local";
export const DEV_PASSWORD = "fourmy-dev-local";

const url = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV === "production" || /prod/i.test(url)) {
  throw new Error("Refus : amorçage de développement sur ce qui ressemble à la production.");
}
const id = await upsertLocalUser(db(), { id: DEV_USER, email: DEV_EMAIL, name: "Développeur", password: DEV_PASSWORD });
const added = (await db().execute(sql`
  INSERT INTO memberships (id, farm_id, user_id, role)
  SELECT gen_random_uuid(), f.id, ${id}, 'owner' FROM farms f
  ON CONFLICT (farm_id, user_id) DO NOTHING
  RETURNING farm_id`)) as unknown as unknown[];
console.log(`Compte de dev : ${DEV_EMAIL} / ${DEV_PASSWORD} — ${added.length} appartenance(s) ajoutée(s).`);

// Référentiel Lexicon (sinon chargé seulement par le worker) : nouvelles
// versions uniquement ; FOURMY_LEXICON_PACKAGES_URL=off pour s'en passer (hors ligne).
const lexiconUrl = process.env.FOURMY_LEXICON_PACKAGES_URL;
if (lexiconUrl !== "off") {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const r of await syncLexicon(client, { base: lexiconUrl || LEXICON_PACKAGES_URL })) {
      console.log(`Lexicon ${r.name} ${r.version} : ${r.status === "loaded" ? "chargé" : "déjà à jour"}`);
    }
  } catch (e) {
    console.warn(`⚠ Lexicon non chargé (${e instanceof Error ? e.message : String(e)}) : relancer \`corepack pnpm --filter @fourmy/lexicon sync\`.`);
  } finally {
    await client.end();
  }
}
process.exit(0);
