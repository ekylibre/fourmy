import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";
import { apiResource, getAuth, mcpResource, OAUTH_SCOPES, oauthIssuer } from "../auth.js";

/**
 * Jetons d'accès OAuth (lot AM5, essai AM0 §1 point 5) : JWT signés par le
 * plugin `jwt`, vérifiés ici sur les clés lues en base (aucun appel réseau),
 * avec l'émetteur et l'audience de Fourmy (`/mcp` ou `/api/v1`).
 */

export type OAuthClaims = { userId: string; clientId: string; scopes: Set<string>; farmId: string | null };

/** Un jeton OAuth au format JWT (trois segments) ; les jetons de session mobile n'en ont que deux. */
export const looksLikeJwt = (token: string) => /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(token);

let keys: { set: ReturnType<typeof createLocalJWKSet>; at: number } | null = null;

async function keySet(force = false) {
  // Relues au plus toutes les 10 minutes, ou aussitôt qu'une clé inconnue se présente (rotation).
  if (!keys || force || Date.now() - keys.at > 600_000) {
    keys = { set: createLocalJWKSet((await getAuth().api.getJwks()) as JSONWebKeySet), at: Date.now() };
  }
  return keys.set;
}

/** Vérifie un jeton d'accès ; null s'il est invalide, expiré ou destiné à une autre ressource. */
export async function verifyOAuthToken(token: string): Promise<OAuthClaims | null> {
  const verify = async (force: boolean) =>
    jwtVerify(token, await keySet(force), { issuer: oauthIssuer(), audience: [mcpResource(), apiResource()] });
  let payload;
  try {
    payload = (await verify(false)).payload;
  } catch (e) {
    if (!(e instanceof errors.JWKSNoMatchingKey)) return null;
    try {
      payload = (await verify(true)).payload;
    } catch {
      return null;
    }
  }
  const clientId = (payload.azp ?? payload.client_id) as string | undefined;
  if (!payload.sub || !clientId) return null;
  const scopes = new Set(String(payload.scope ?? "").split(" ").filter(Boolean));
  if (!scopes.has(OAUTH_SCOPES.read) && !scopes.has(OAUTH_SCOPES.write)) return null;
  const farm = payload.fourmy_farm;
  return { userId: payload.sub, clientId, scopes, farmId: typeof farm === "string" ? farm : null };
}

/** Oublie les clés en cache (tests). */
export function resetOAuthKeys() {
  keys = null;
}
