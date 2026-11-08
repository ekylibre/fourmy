#!/usr/bin/env node
/**
 * Synchronise le référentiel Lexicon dans la base Fourmy :
 *   DATABASE_URL=… fourmy-lexicon-sync [--force]
 * (serveur public https://lexicon-packages.osfarm.org par défaut ;
 * FOURMY_LEXICON_PACKAGES_URL pour un autre, ex. http://127.0.0.1:8889).
 * Le worker le fait aussi chaque jour (nouvelle version seulement).
 */
import postgres from "postgres";
import { syncLexicon } from "./load.js";
import { LEXICON_PACKAGES_URL } from "./packages.js";

const base = process.env.FOURMY_LEXICON_PACKAGES_URL || LEXICON_PACKAGES_URL;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL est requis.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const started = Date.now();
  for (const r of await syncLexicon(sql, { base, force: process.argv.includes("--force") })) {
    console.log(`${r.name} ${r.version} : ${r.status === "loaded" ? "chargé" : "déjà à jour"} (${r.rows} lignes)`);
  }
  console.log(`en ${Date.now() - started} ms`);
} finally {
  await sql.end();
}
