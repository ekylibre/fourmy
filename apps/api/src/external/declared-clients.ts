import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@fourmy/db";
import { apiResource, mcpResource, OAUTH_SCOPES } from "../auth.js";

/**
 * Applications déclarées d'avance (lot AM5, API-21) : Aiffel et les services
 * de l'offre commune, par la variable `FOURMY_OAUTH_CLIENTS` (JSON). Elles
 * passent par le même écran de consentement qu'une application enregistrée
 * dynamiquement ; seul leur identifiant est connu à l'avance.
 *
 * Exemple : `[{"clientId":"aiffel","name":"Aiffel","redirectUris":["https://aiffel.example/oauth/callback"],"clientSecret":"…","write":false}]`
 */
const declaredClient = z.object({
  clientId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, "clientId : 3 à 64 caractères, minuscules, chiffres, . _ -"),
  name: z.string().min(1).max(100),
  redirectUris: z.array(z.url()).min(1),
  /** Client confidentiel (serveur) ; absent : client public, PKCE seul. */
  clientSecret: z.string().min(32).optional(),
  uri: z.url().optional(),
  /** Peut demander l'écriture (propositions, lot AM8). */
  write: z.boolean().default(false),
});
export type DeclaredClient = z.infer<typeof declaredClient>;

export function declaredClients(raw = process.env.FOURMY_OAUTH_CLIENTS): DeclaredClient[] {
  if (!raw?.trim()) return [];
  const parsed = z.array(declaredClient).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`FOURMY_OAUTH_CLIENTS invalide : ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

/** Haché du secret, comme le plugin le stocke (`storeClientSecret: "hashed"`). */
const hashSecret = (s: string) => createHash("sha256").update(s).digest("base64url");

/** Enregistre ou met à jour les applications déclarées (au démarrage de l'API). */
export async function syncDeclaredClients(db: Database, clients = declaredClients()): Promise<number> {
  for (const c of clients) {
    const scopes = [OAUTH_SCOPES.read, ...(c.write ? [OAUTH_SCOPES.write] : []), "offline_access", "openid", "profile", "email"];
    const secret = c.clientSecret ? hashSecret(c.clientSecret) : null;
    const auth = c.clientSecret ? "client_secret_basic" : "none";
    await db.execute(sql`
      INSERT INTO auth_oauth_clients (client_id, client_secret, name, uri, redirect_uris, scopes, token_endpoint_auth_method,
                                      grant_types, response_types, require_pkce, skip_consent, disabled, application_type,
                                      metadata, created_at, updated_at)
      VALUES (${c.clientId}, ${secret}, ${c.name}, ${c.uri ?? null}, ${JSON.stringify(c.redirectUris)}::jsonb, ${JSON.stringify(scopes)}::jsonb, ${auth},
              '["authorization_code","refresh_token"]'::jsonb, '["code"]'::jsonb, true, false, false, 'web',
              '{"fourmyDeclared":true}'::jsonb, now(), now())
      ON CONFLICT (client_id) DO UPDATE SET client_secret = EXCLUDED.client_secret, name = EXCLUDED.name, uri = EXCLUDED.uri,
        redirect_uris = EXCLUDED.redirect_uris, scopes = EXCLUDED.scopes, token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
        disabled = false, updated_at = now()`);
    // Ressources ouvertes au client : l'API et le serveur MCP (sinon `invalid_target`).
    for (const [identifier, name] of [[apiResource(), "API Fourmy"], [mcpResource(), "Serveur MCP Fourmy"]] as const) {
      await db.execute(sql`INSERT INTO auth_oauth_resources (identifier, name, disabled, created_at, updated_at, policy_version)
                           VALUES (${identifier}, ${name}, false, now(), now(), 1) ON CONFLICT (identifier) DO NOTHING`);
      await db.execute(sql`INSERT INTO auth_oauth_client_resources (client_id, resource_id, created_at)
                           VALUES (${c.clientId}, ${identifier}, now()) ON CONFLICT (client_id, resource_id) DO NOTHING`);
    }
  }
  return clients.length;
}
