import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { accessGrant, accessModules, grantWrites, writableOnly, type AccessGrant, type AccessLogEntry, type FarmAccess, type FarmAccessCreate, type FarmAccessUpdate } from "@fourmy/contracts";
import { capGrant, isEmptyGrant, memberGrant, type EffectiveGrant, type MemberRole } from "@fourmy/domain";
import { getAuth } from "../auth.js";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { assertFarmActivities } from "./invitations.js";

/**
 * Accès externes d'une ferme (lot AM4, conception_api_mcp.md §4, §9) : clés
 * d'API, et plus tard applications OAuth (AM5). Le responsable voit et gère
 * tous les accès de la ferme ; un autre membre, les siens. Les droits d'un
 * accès sont plafonnés par ceux de son auteur (API-4), à l'enregistrement et
 * à chaque requête (context.ts).
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

export type Viewer = { userId: string; role: MemberRole };

type AccessRow = {
  id: string;
  kind: "api_key" | "oauth";
  name: string;
  key_start: string | null;
  user_id: string;
  user_name: string;
  access_grant: AccessGrant;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
};

const SELECT = sql`
  SELECT a.id, a.kind, a.name, a.key_start, a.user_id, coalesce(nullif(u.name, ''), u.email) AS user_name, a.access_grant,
         a.created_at::text, a.expires_at::text, a.revoked_at::text, a.last_used_at::text
  FROM farm_accesses a JOIN users u ON u.id = a.user_id`;

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const toView = (r: AccessRow): FarmAccess => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  keyStart: r.key_start,
  user: { id: r.user_id, name: r.user_name },
  grant: r.access_grant,
  createdAt: iso(r.created_at)!,
  expiresAt: iso(r.expires_at),
  revokedAt: iso(r.revoked_at),
  lastUsedAt: iso(r.last_used_at),
});

/** Droits enregistrés : les modules ouverts seulement. */
export const toStored = (g: EffectiveGrant): AccessGrant => ({
  modules: Object.fromEntries(accessModules.filter((m) => g.modules[m] !== "none").map((m) => [m, g.modules[m]])),
  activities: g.activities,
});

/** Droits d'un membre de la ferme (plafond de ses accès) ; null s'il n'en est plus membre. */
async function memberCap(tx: Tx, userId: string): Promise<EffectiveGrant | null> {
  const [m] = await rows<{ role: MemberRole; access_grant: unknown }>(tx, sql`SELECT role, access_grant FROM memberships WHERE user_id = ${userId}`);
  if (!m) return null;
  const stored = m.role === "guest" ? accessGrant.safeParse(m.access_grant) : null;
  return memberGrant(m.role, stored?.success ? stored.data : null);
}

/** Plafonne et vérifie des droits demandés (activités de la ferme, au moins un module). */
export async function capped(tx: Tx, userId: string, requested: AccessGrant) {
  await assertFarmActivities(tx, requested);
  const cap = await memberCap(tx, userId);
  if (!cap) throw new BadRequest("L'auteur de cet accès n'est plus membre de la ferme.");
  // Écriture (lot AM8) : seulement sur les modules à propositions (Interventions).
  const r = capGrant(cap, writableOnly(requested));
  if (isEmptyGrant(r.grant)) throw new BadRequest("Ces droits n'ouvrent rien : choisissez au moins un module (et une activité).");
  return r;
}

async function readOne(tx: Tx, viewer: Viewer, id: string): Promise<AccessRow> {
  const [r] = await rows<AccessRow>(tx, sql`${SELECT} WHERE a.id = ${id}`);
  if (!r || (viewer.role !== "owner" && r.user_id !== viewer.userId)) throw new NotFound("Accès introuvable");
  return r;
}

export async function listAccesses(db: Database, farmId: string, viewer: Viewer): Promise<FarmAccess[]> {
  return withFarm(db, farmId, async (tx) => {
    const mine = viewer.role === "owner" ? sql`` : sql`WHERE a.user_id = ${viewer.userId}`;
    return (await rows<AccessRow>(tx, sql`${SELECT} ${mine} ORDER BY a.revoked_at NULLS FIRST, a.created_at DESC`)).map(toView);
  });
}

/** Crée une clé d'API pour la ferme ; la clé complète n'est renvoyée qu'ici. */
export async function createAccessKey(db: Database, farmId: string, viewer: Viewer, body: FarmAccessCreate): Promise<{ access: FarmAccess; key: string }> {
  const { grant, reduced } = await withFarm(db, farmId, (tx) => capped(tx, viewer.userId, body.grant));
  const days = body.expiresInDays ?? null;
  const created = await getAuth().api.createApiKey({
    body: { userId: viewer.userId, name: body.name, ...(days ? { expiresIn: days * 86_400 } : {}), metadata: { farmId } },
  });
  const access = await withFarm(db, farmId, async (tx) => {
    const id = crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO farm_accesses (id, farm_id, kind, name, user_id, api_key_id, key_start, access_grant, expires_at)
      VALUES (${id}, ${farmId}, 'api_key', ${body.name}, ${viewer.userId}, ${created.id}, ${created.start},
              ${JSON.stringify(toStored(grant))}::jsonb, ${days ? sql`now() + ${`${days} days`}::interval` : null})`);
    return toView(await readOne(tx, viewer, id));
  });
  return { access: { ...access, ...(reduced.length ? { reduced } : {}) }, key: created.key };
}

/** Renomme ou change les droits d'un accès (toujours plafonnés par ceux de son auteur). */
export async function updateAccess(
  db: Database,
  farmId: string,
  viewer: Viewer,
  id: string,
  body: FarmAccessUpdate,
  onNewWrite?: (access: FarmAccess) => void,
): Promise<FarmAccess> {
  return withFarm(db, farmId, async (tx) => {
    const r = await readOne(tx, viewer, id);
    if (r.revoked_at) throw new BadRequest("Accès révoqué : créez-en un autre.");
    let reduced: FarmAccess["reduced"];
    const wasWriting = grantWrites(r.access_grant);
    if (body.grant) {
      const c = await capped(tx, r.user_id, body.grant);
      reduced = c.reduced;
      await tx.execute(sql`UPDATE farm_accesses SET access_grant = ${JSON.stringify(toStored(c.grant))}::jsonb WHERE id = ${id}`);
    }
    if (body.name) await tx.execute(sql`UPDATE farm_accesses SET name = ${body.name} WHERE id = ${id}`);
    const view = toView(await readOne(tx, viewer, id));
    if (!wasWriting && grantWrites(view.grant)) onNewWrite?.(view);
    return reduced?.length ? { ...view, reduced } : view;
  });
}

/** Révoque un accès : refusé dès la requête suivante ; la clé est aussi désactivée. */
export async function revokeAccess(db: Database, farmId: string, viewer: Viewer, id: string): Promise<void> {
  const { keyId, oauth } = await withFarm(db, farmId, async (tx) => {
    const r = await readOne(tx, viewer, id);
    const [a] = await rows<{ api_key_id: string | null; oauth_client_id: string | null; user_id: string }>(
      tx,
      sql`UPDATE farm_accesses SET revoked_at = coalesce(revoked_at, now()) WHERE id = ${r.id} RETURNING api_key_id, oauth_client_id, user_id`,
    );
    return { keyId: a?.api_key_id ?? null, oauth: a?.oauth_client_id ? { clientId: a.oauth_client_id, userId: a.user_id } : null };
  });
  // Application OAuth : son consentement sur cette ferme et ses jetons de rafraîchissement tombent ;
  // une nouvelle autorisation repassera par l'écran de consentement.
  if (oauth) await forgetOAuthConsent(db, farmId, oauth.clientId, oauth.userId);
  // Tables des plugins, hors RLS (rôle de connexion).
  if (keyId) await db.execute(sql`UPDATE auth_api_keys SET enabled = false, updated_at = now() WHERE id = ${keyId}`);
}

/** Efface le consentement OAuth d'un utilisateur à une application pour une ferme (tables du plugin). */
export async function forgetOAuthConsent(db: Database, farmId: string, clientId: string, userId: string): Promise<void> {
  await db.execute(sql`DELETE FROM auth_oauth_consents WHERE client_id = ${clientId} AND user_id = ${userId}::uuid AND reference_id = ${farmId}`);
  await db.execute(sql`UPDATE auth_oauth_refresh_tokens SET revoked = now()
                       WHERE client_id = ${clientId} AND user_id = ${userId}::uuid AND reference_id = ${farmId} AND revoked IS NULL`);
}

/** Journal des appels d'un accès, du plus récent au plus ancien (90 jours). */
export async function accessLog(db: Database, farmId: string, viewer: Viewer, id: string, q: { limit: number; before?: string }): Promise<AccessLogEntry[]> {
  return withFarm(db, farmId, async (tx) => {
    await readOne(tx, viewer, id);
    const list = await rows<{ at: string; channel: "rest" | "mcp"; operation: string; status: number; duration_ms: number | null; written: { proposals: string[] } | null }>(
      tx,
      sql`SELECT at::text, channel, operation, status, duration_ms, written FROM access_log
          WHERE access_id = ${id} ${q.before ? sql`AND at < ${q.before}::timestamptz` : sql``}
          ORDER BY at DESC LIMIT ${q.limit}`,
    );
    return list.map((l) => ({ at: new Date(l.at).toISOString(), channel: l.channel, operation: l.operation, status: l.status, durationMs: l.duration_ms, written: l.written }));
  });
}

/** Purge du journal (worker) : appels de plus de 90 jours (Q6). */
export async function purgeAccessLog(db: Database): Promise<number> {
  const r = (await db.execute(sql`DELETE FROM access_log WHERE at < now() - interval '90 days'`)) as unknown as { count?: number };
  return r.count ?? 0;
}
