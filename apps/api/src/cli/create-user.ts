#!/usr/bin/env node
import { parseArgs } from "node:util";
import { db } from "../db.js";
import { upsertLocalUser } from "../users.js";

/**
 * Création d'un compte local (administration) :
 *   pnpm --filter @fourmy/api user:create --email <e-mail> [--name <nom>]
 * Le mot de passe est lu sur l'entrée standard (jamais en argument : il
 * finirait dans l'historique du shell). Si le compte existe, son mot de passe
 * est remplacé. Le rattachement à une ferme se fait ensuite par son
 * responsable : invitation depuis la fiche de la personne (page Équipe).
 */
const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
if (!values.email) {
  console.error("usage: user:create --email <e-mail> [--name <nom>]  (mot de passe sur l'entrée standard)");
  process.exit(2);
}
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
const id = await upsertLocalUser(db(), { email: values.email, name: values.name, password });
console.log(`Compte ${values.email} prêt (${id}).`);
process.exit(0);
