#!/usr/bin/env node
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { upsertLocalUser } from "../users.js";

/**
 * Création d'un compte local (administration) :
 *   pnpm --filter @fourmy/api user:create --email <e-mail> [--name <nom>] [--onboarding]
 * Le mot de passe est lu sur l'entrée standard (jamais en argument : il
 * finirait dans l'historique du shell). Si le compte existe, son mot de passe
 * est remplacé. Le rattachement à une ferme se fait ensuite par son
 * responsable : invitation depuis la fiche de la personne (page Équipe).
 * `--onboarding` : compte « à embarquer », qui crée lui-même sa ferme avec
 * l'assistant de premier démarrage (droit de créer une ferme).
 */
const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, onboarding: { type: "boolean" } } });
if (!values.email) {
  console.error("usage: user:create --email <e-mail> [--name <nom>] [--onboarding]  (mot de passe sur l'entrée standard)");
  process.exit(2);
}
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
const id = await upsertLocalUser(db(), { email: values.email, name: values.name, password });
if (values.onboarding) {
  await db().execute(sql`UPDATE users SET farm_creation_quota = greatest(farm_creation_quota, 1) WHERE id = ${id}`);
}
console.log(`Compte ${values.email} prêt (${id})${values.onboarding ? " : il créera sa ferme avec l'assistant à sa première connexion" : ""}.`);
process.exit(0);
