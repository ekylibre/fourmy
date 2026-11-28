import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import { accessGrant, ACCESS_MODULE_LABELS, accessModules, grantWrites, writableOnly, type AccessGrant, type OAuthRequest } from "@fourmy/contracts";
import { memberGrant, type MemberRole } from "@fourmy/domain";
import type { Transporter } from "nodemailer";
import { OAUTH_SCOPES } from "../auth.js";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { capped, toStored } from "./accesses.js";

/**
 * Consentement OAuth (lot AM5, conception_api_mcp.md §7.1). Le plugin gère
 * le protocole ; Fourmy ajoute le choix de la ferme (référence du
 * consentement, `auth_sessions.active_farm_id`) et les droits consentis
 * (`farm_accesses`, plafonnés par ceux de l'utilisateur sur la ferme).
 */

type Session = { userId: string; sessionId: string };

/** Paramètres de la demande d'autorisation, lus dans la requête signée par le plugin. */
function parseQuery(oauthQuery: string) {
  const q = new URLSearchParams(oauthQuery);
  const clientId = q.get("client_id");
  if (!clientId || !q.get("sig")) throw new BadRequest("Demande d'autorisation invalide : recommencez depuis l'application.");
  return { clientId, scopes: (q.get("scope") ?? "").split(" ").filter(Boolean) };
}

type ClientRow = { client_id: string; name: string | null; uri: string | null; icon: string | null; disabled: boolean | null };

/** Application (table du plugin, hors RLS). */
async function client(db: Database, clientId: string) {
  const [c] = (await db.execute(
    sql`SELECT client_id, name, uri, icon, disabled FROM auth_oauth_clients WHERE client_id = ${clientId}`,
  )) as unknown as ClientRow[];
  if (!c || c.disabled) throw new NotFound("Application inconnue ou désactivée.");
  const host = c.uri ? new URL(c.uri).host : null;
  return { id: c.client_id, name: (c.name || host || "Application sans nom").slice(0, 100), uri: c.uri, icon: c.icon };
}

type FarmRow = { id: string; name: string; role: MemberRole; access_grant: unknown };

/** Fermes de l'utilisateur avec ses droits (plafond du consentement). */
async function myFarms(db: Database, userId: string) {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return (await tx.execute(sql`SELECT farm_id AS id, name, role, access_grant FROM fourmy_user_farms(${userId})`)) as unknown as FarmRow[];
  });
  return rows.map((f) => {
    const stored = f.role === "guest" ? accessGrant.safeParse(f.access_grant) : null;
    const g = memberGrant(f.role, stored?.success ? stored.data : null);
    return { id: f.id, name: f.name, role: f.role, grant: toStored(g) };
  });
}

async function activeFarm(db: Database, s: Session): Promise<string | null> {
  const [r] = (await db.execute(sql`SELECT active_farm_id FROM auth_sessions WHERE id = ${s.sessionId}::uuid AND user_id = ${s.userId}::uuid`)) as unknown as {
    active_farm_id: string | null;
  }[];
  return r?.active_farm_id ?? null;
}

/** Ce que l'écran de consentement affiche. */
export async function oauthRequestInfo(db: Database, s: Session, oauthQuery: string): Promise<OAuthRequest> {
  const { clientId, scopes } = parseQuery(oauthQuery);
  const app = await client(db, clientId);
  const farms = await myFarms(db, s.userId);
  const farmId = await activeFarm(db, s);
  let current: AccessGrant | null = null;
  if (farmId && farms.some((f) => f.id === farmId)) {
    const [a] = (await withFarm(db, farmId, (tx) =>
      tx.execute(sql`SELECT access_grant FROM farm_accesses
                     WHERE kind = 'oauth' AND oauth_client_id = ${clientId} AND user_id = ${s.userId} AND revoked_at IS NULL`),
    )) as unknown as { access_grant: AccessGrant }[];
    current = a?.access_grant ?? null;
  }
  return { client: app, write: scopes.includes(OAUTH_SCOPES.write), farms, farmId: farms.some((f) => f.id === farmId) ? farmId : null, current };
}

/** Étape « ferme » : la ferme devient la référence du consentement. */
export async function chooseOAuthFarm(db: Database, s: Session, farmId: string): Promise<void> {
  const farms = await myFarms(db, s.userId);
  if (!farms.some((f) => f.id === farmId)) throw new NotFound("Ferme introuvable.");
  await db.execute(sql`UPDATE auth_sessions SET active_farm_id = ${farmId}::uuid WHERE id = ${s.sessionId}::uuid AND user_id = ${s.userId}::uuid`);
}

/**
 * Consentement accordé : droits plafonnés, enregistrés dans `farm_accesses`
 * (un accès par application, utilisateur et ferme). Renvoie la ferme, et
 * `first` quand l'application n'avait encore aucun accès à cette ferme.
 */
export async function recordOAuthConsent(db: Database, s: Session, oauthQuery: string, requested: AccessGrant) {
  const { clientId } = parseQuery(oauthQuery);
  const app = await client(db, clientId);
  const farmId = await activeFarm(db, s);
  if (!farmId) throw new BadRequest("Choisissez d'abord la ferme.");
  // Écriture (lot AM8) : seulement là où l'on dépose des propositions (Interventions),
  // et seulement si l'application a demandé la portée d'écriture.
  const writes = parseQuery(oauthQuery).scopes.includes(OAUTH_SCOPES.write);
  const allowed = writableOnly(writes ? requested : { ...requested, modules: Object.fromEntries(Object.entries(requested.modules).map(([m, l]) => [m, l === "write" ? "read" : l])) });
  return withFarm(db, farmId, async (tx) => {
    const { grant } = await capped(tx, s.userId, allowed);
    const stored = JSON.stringify(toStored(grant));
    const [existing] = (await tx.execute(sql`SELECT id, access_grant FROM farm_accesses
      WHERE kind = 'oauth' AND oauth_client_id = ${clientId} AND user_id = ${s.userId} AND revoked_at IS NULL`)) as unknown as { id: string; access_grant: AccessGrant }[];
    let created: string | null = null;
    if (existing) {
      await tx.execute(sql`UPDATE farm_accesses SET access_grant = ${stored}::jsonb, name = ${app.name} WHERE id = ${existing.id}`);
    } else {
      created = crypto.randomUUID();
      await tx.execute(sql`INSERT INTO farm_accesses (id, farm_id, kind, name, user_id, oauth_client_id, access_grant)
                           VALUES (${created}, ${farmId}, 'oauth', ${app.name}, ${s.userId}, ${clientId}, ${stored}::jsonb)`);
    }
    const [row] = (await tx.execute(sql`SELECT count(*)::int AS n FROM farm_accesses WHERE kind = 'oauth' AND oauth_client_id = ${clientId}`)) as unknown as {
      n: number;
    }[];
    const g = toStored(grant);
    // Écriture nouvelle pour cette application (API-28) : les responsables sont prévenus.
    const newWrite = grantWrites(g) && !(existing && grantWrites(existing.access_grant));
    return { farmId, app, grant: g, created, first: row?.n === 1 && !existing, newWrite };
  });
}

/** Consentement refusé par le serveur d'autorisation (requête expirée…) : l'accès tout juste créé disparaît. */
export async function dropOAuthAccess(db: Database, farmId: string, accessId: string): Promise<void> {
  await withFarm(db, farmId, (tx) => tx.execute(sql`DELETE FROM farm_accesses WHERE id = ${accessId}`));
}

/** Fin d'une autorisation : la ferme choisie est oubliée. */
export async function clearOAuthFarm(db: Database, s: Session): Promise<void> {
  await db.execute(sql`UPDATE auth_sessions SET active_farm_id = NULL WHERE id = ${s.sessionId}::uuid`);
}

/**
 * Prévient les responsables de la ferme à la première connexion d'une
 * application (API-28).
 */
export async function notifyOwnersOfNewApp(
  db: Database,
  mailer: Transporter | null,
  input: { farmId: string; appName: string; grant: AccessGrant; userName: string; appUrl: string },
): Promise<number> {
  const modules = accessModules.filter((m) => input.grant.modules[m] && input.grant.modules[m] !== "none").map((m) => ACCESS_MODULE_LABELS[m]);
  const writes = grantWrites(input.grant);
  return mailOwners(db, mailer, input.farmId, (farm) => ({
    subject: `Fourmy · nouvelle application connectée à ${farm}`,
    text: [
      "Bonjour,",
      "",
      `${input.userName} vient d'autoriser l'application « ${input.appName} » à consulter la ferme « ${farm} » sur Fourmy${writes ? " et à y proposer des interventions" : ""}.`,
      `Modules ouverts : ${modules.join(", ") || "aucun"} ; ${input.grant.activities === "all" ? "toutes les activités" : `${input.grant.activities.length} activité(s)`}.`,
      ...(writes ? ["Ses propositions n'écrivent rien : elles attendent votre validation dans « À valider »."] : []),
      "",
      "Vous pouvez voir ses appels ou lui retirer l'accès dans Ma ferme → Accès externes :",
      `${input.appUrl}/f/${input.farmId}/farm?tab=accesses`,
    ].join("\n"),
  }));
}

/**
 * Prévient les responsables à l'ouverture d'un accès en écriture (API-28) :
 * clé d'API créée ou modifiée, ou application déjà connue qui reçoit l'écriture.
 */
export async function notifyOwnersOfWriteAccess(
  db: Database,
  mailer: Transporter | null,
  input: { farmId: string; accessName: string; kind: "api_key" | "oauth"; userName: string; appUrl: string },
): Promise<number> {
  return mailOwners(db, mailer, input.farmId, (farm) => ({
    subject: `Fourmy · accès en écriture ouvert sur ${farm}`,
    text: [
      "Bonjour,",
      "",
      `${input.userName} vient d'ouvrir ${input.kind === "api_key" ? "la clé d'API" : "à l'application"} « ${input.accessName} » l'écriture sur la ferme « ${farm} » :`,
      "elle peut désormais proposer des interventions. Ses propositions n'écrivent rien : elles attendent votre validation dans « À valider ».",
      "",
      "Vous pouvez voir ses appels ou lui retirer l'accès dans Ma ferme → Accès externes :",
      `${input.appUrl}/f/${input.farmId}/farm?tab=accesses`,
    ].join("\n"),
  }));
}

/** Un e-mail à chaque responsable de la ferme ; sans serveur d'envoi configuré, rien ne part. */
async function mailOwners(db: Database, mailer: Transporter | null, farmId: string, compose: (farm: string) => { subject: string; text: string }): Promise<number> {
  if (!mailer) return 0;
  const { farm, owners } = await withFarm(db, farmId, async (tx) => {
    const [f] = (await tx.execute(sql`SELECT name FROM farms WHERE id = ${farmId}`)) as unknown as { name: string }[];
    const o = (await tx.execute(sql`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'owner'`)) as unknown as { email: string }[];
    return { farm: f?.name ?? "", owners: o.map((r) => r.email) };
  });
  const { subject, text } = compose(farm);
  let sent = 0;
  for (const to of owners) {
    try {
      await mailer.sendMail({ from: { name: "Fourmy", address: process.env.FOURMY_SMTP_FROM ?? "no-reply@fourmy.org" }, to, subject, text });
      sent++;
    } catch (e) {
      console.error("[accès externes] e-mail aux responsables :", e);
    }
  }
  return sent;
}
