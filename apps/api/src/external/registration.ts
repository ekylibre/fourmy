import { sql } from "drizzle-orm";
import { OAUTH_SCOPES } from "../auth.js";
import { db } from "../db.js";

/**
 * Enregistrement dynamique d'un client OAuth (RFC 7591, lot AM7) : le plugin
 * oauth-provider inscrit sur chaque client toutes les portées permises, quelle
 * que soit sa demande. On retire `fourmy:write` d'un client qui ne l'a pas
 * demandée : il ne pourra pas la réclamer plus tard sans se réinscrire.
 * `offline_access` et les portées d'identité restent, car les assistants les
 * demandent souvent à l'autorisation sans les avoir déclarées.
 */
export async function narrowRegistration(request: Request, handler: (r: Request) => Promise<Response>): Promise<Response> {
  const raw = await request.text();
  const response = await handler(new Request(request, { body: raw }));
  if (response.status !== 200 && response.status !== 201) return response;
  let requested: string[];
  try {
    const scope = (JSON.parse(raw) as { scope?: unknown }).scope;
    requested = typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
  } catch {
    return response;
  }
  if (requested.includes(OAUTH_SCOPES.write)) return response;
  const body = (await response.clone().json().catch(() => null)) as { client_id?: string; scope?: string } | null;
  if (!body?.client_id || !body.scope?.split(" ").includes(OAUTH_SCOPES.write)) return response;
  const scopes = body.scope.split(" ").filter((s) => s !== OAUTH_SCOPES.write);
  await db().execute(sql`UPDATE auth_oauth_clients SET scopes = ${JSON.stringify(scopes)}::jsonb WHERE client_id = ${body.client_id}`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ ...body, scope: scopes.join(" ") }), { status: response.status, headers });
}
