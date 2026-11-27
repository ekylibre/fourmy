import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transporter } from "nodemailer";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { AccessGrant, MemberRole } from "@fourmy/contracts";
import { MEMBER_ROLE_LABELS } from "@fourmy/contracts";
import { createLocalUserIfAbsent } from "../users.js";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Invitations, lot P3 (docs/equipe-personnes-design.md §4.3) : le responsable
 * invite une personne à avoir un compte ; email si le serveur sait en
 * envoyer, sinon un lien à transmettre. Le jeton (32 octets aléatoires) n'est
 * jamais stocké ni journalisé, seulement son SHA-256.
 */
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
export const INVITATION_DAYS = 7;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type InvitationResult = { status: "sent" | "link"; link: string | null; sentByEmail: boolean; expiresAt: string; email: string };

/** Crée l'invitation (la précédente est révoquée) ; envoie l'email si possible, sinon renvoie le lien. */
export async function invitePerson(
  db: Database,
  farmId: string,
  personId: string,
  input: { email?: string; role: MemberRole; grant?: AccessGrant; invitedBy: string; appUrl: string; mailer: Transporter | null },
): Promise<InvitationResult> {
  const token = randomBytes(32).toString("base64url");
  const link = `${input.appUrl.replace(/\/$/, "")}/invitation/${token}`;
  const { email, farmName, firstName, expiresAt, invitationId } = await withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ user_id: string | null; first_name: string | null; name: string; email: string | null; farm: string }>(
      tx,
      sql`SELECT p.user_id, p.first_name, p.name, pp.email, f.name AS farm
          FROM people p JOIN farms f ON f.id = p.farm_id LEFT JOIN person_private pp ON pp.person_id = p.id
          WHERE p.id = ${personId}`,
    );
    if (!p) throw new NotFound("Personne introuvable");
    if (p.user_id) throw new Conflict("Cette personne a déjà un compte sur la ferme.");
    const to = (input.email ?? p.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BadRequest("Email de la personne requis (fiche ou formulaire).");
    if (input.grant) await assertFarmActivities(tx, input.grant);
    await tx.execute(sql`UPDATE person_invitations SET revoked_at = now() WHERE person_id = ${personId} AND accepted_at IS NULL AND revoked_at IS NULL`);
    const id = crypto.randomUUID();
    const [row] = await rows<{ expires_at: string }>(
      tx,
      sql`INSERT INTO person_invitations (id, farm_id, person_id, email, role, access_grant, token_hash, expires_at, created_by)
          VALUES (${id}, ${farmId}, ${personId}, ${to}, ${input.role}, ${input.grant ? JSON.stringify(input.grant) : null}::jsonb,
                  ${hashToken(token)}, now() + ${`${INVITATION_DAYS} days`}::interval, ${input.invitedBy})
          RETURNING expires_at`,
    );
    return { email: to, farmName: p.farm, firstName: p.first_name ?? p.name, expiresAt: new Date(row!.expires_at).toISOString(), invitationId: id };
  });

  let sent = false;
  if (input.mailer) {
    try {
      await input.mailer.sendMail({
        from: { name: "Fourmy", address: process.env.FOURMY_SMTP_FROM ?? "no-reply@fourmy.org" },
        to: email,
        subject: `Fourmy · invitation à rejoindre ${farmName}`,
        text: [
          `Bonjour ${firstName},`,
          "",
          `Vous êtes invité(e) à rejoindre la ferme « ${farmName} » sur Fourmy, en tant que ${MEMBER_ROLE_LABELS[input.role].toLowerCase()}.`,
          "",
          `Pour accepter, ouvrez ce lien (valable ${INVITATION_DAYS} jours, une seule fois) :`,
          link,
          "",
          "Si vous n'attendiez pas cette invitation, ignorez ce message.",
        ].join("\n"),
      });
      sent = true;
    } catch {
      // Envoi en échec : le responsable reçoit le lien à transmettre lui-même.
    }
  }
  if (sent) await withFarm(db, farmId, (tx) => tx.execute(sql`UPDATE person_invitations SET sent_by_email = true WHERE id = ${invitationId}`));
  return sent ? { status: "sent", link: null, sentByEmail: true, expiresAt, email } : { status: "link", link, sentByEmail: false, expiresAt, email };
}

export async function revokeInvitation(db: Database, farmId: string, personId: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE person_invitations SET revoked_at = now() WHERE person_id = ${personId} AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at > now() RETURNING id`,
    );
    if (!done.length) throw new NotFound("Aucune invitation en cours pour cette personne.");
  });
}

/** Invitation ouverte d'une personne (fiche, responsable). */
export async function openInvitation(tx: Tx, personId: string) {
  const [i] = await rows<{ email: string; expires_at: string; sent_by_email: boolean; role: MemberRole; access_grant: AccessGrant | null }>(
    tx,
    sql`SELECT email, expires_at, sent_by_email, role, access_grant FROM person_invitations
        WHERE person_id = ${personId} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
  );
  return i
    ? { email: i.email, role: i.role, grant: i.access_grant, expiresAt: new Date(i.expires_at).toISOString(), sentByEmail: i.sent_by_email }
    : null;
}

// ---------------------------------------------------------------------------
// Hors ferme : lecture et acceptation par le jeton
// ---------------------------------------------------------------------------

type PublicInvitation = { farmId: string; farmName: string; firstName: string; email: string; role: MemberRole; status: "open" | "expired" | "accepted" | "revoked"; accountExists: boolean };

/** Requête en tant que fourmy_app (fonctions SECURITY DEFINER), hors contexte de ferme. */
const asApp = <T>(db: Database, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return fn(tx as unknown as Tx);
  });

export async function readInvitation(db: Database, token: string): Promise<PublicInvitation> {
  if (!TOKEN_RE.test(token)) throw new NotFound("Invitation introuvable.");
  const [i] = await asApp(db, (tx) =>
    rows<{ farm_id: string; farm_name: string; first_name: string | null; person_name: string; email: string; role: MemberRole; status: PublicInvitation["status"] }>(
      tx,
      sql`SELECT * FROM fourmy_invitation(${hashToken(token)})`,
    ),
  );
  if (!i) throw new NotFound("Invitation introuvable.");
  const [u] = (await db.execute(sql`SELECT 1 FROM users WHERE email = ${i.email}`)) as unknown as unknown[];
  return { farmId: i.farm_id, farmName: i.farm_name, firstName: i.first_name ?? i.person_name, email: i.email, role: i.role, status: i.status, accountExists: !!u };
}

/**
 * Acceptation. Sans compte pour cet email : création avec le mot de passe
 * choisi (l'invitation l'autorise, même inscription fermée). Avec un compte :
 * il faut être connecté avec, sous le même email.
 */
export async function acceptInvitation(
  db: Database,
  token: string,
  input: { sessionUser: { id: string; email: string } | null; password?: string; name?: string },
): Promise<{ farmId: string; created: boolean }> {
  const inv = await readInvitation(db, token);
  if (inv.status !== "open") throw new Conflict("Invitation expirée, révoquée ou déjà utilisée.");
  let userId: string;
  let created = false;
  if (inv.accountExists) {
    if (!input.sessionUser) throw new Conflict("Un compte existe déjà pour cet email : connectez-vous, puis acceptez.");
    if (input.sessionUser.email.toLowerCase() !== inv.email) throw new Conflict(`Connectez-vous avec le compte ${inv.email} pour accepter.`);
    userId = input.sessionUser.id;
  } else {
    if (!input.password || input.password.length < 10) throw new BadRequest("Mot de passe de 10 caractères au moins.");
    // Jamais un compte existant (son mot de passe serait remplacé) ; le lien reçu fait foi pour l'email.
    const id = await createLocalUserIfAbsent(db, { email: inv.email, name: input.name?.trim() || inv.firstName, password: input.password });
    if (!id) throw new Conflict("Un compte existe déjà pour cet email : connectez-vous, puis acceptez.");
    userId = id;
    created = true;
  }
  try {
    const [r] = await asApp(db, (tx) => rows<{ farm: string }>(tx, sql`SELECT fourmy_accept_invitation(${hashToken(token)}, ${userId}) AS farm`));
    return { farmId: r!.farm, created };
  } catch (e) {
    const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = err.code ?? err.cause?.code;
    if (code === "P0001") throw new Conflict(err.cause?.message ?? err.message ?? "Invitation refusée.");
    throw e;
  }
}

/** Les activités d'un périmètre sont celles de la ferme (sinon 400). */
export async function assertFarmActivities(tx: Tx, grant: AccessGrant): Promise<void> {
  if (grant.activities === "all") return;
  const ids = [...new Set(grant.activities)];
  const [r] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM activities WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  if ((r?.n ?? 0) !== ids.length) throw new BadRequest("Activité inconnue sur cette ferme dans les droits.");
}
