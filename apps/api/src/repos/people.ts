import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  certiphytoStatusAt,
  displayName,
  type MemberRole,
  type PersonCard,
  type PersonPrivate,
  type PersonProfileWrite,
  type PersonSheet,
} from "@fourmy/contracts";
import type { DomainCtx } from "@fourmy/domain";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";
import { cardsWork } from "./people-work.js";
import { openInvitation } from "./invitations.js";

/**
 * Équipe et personnes, lot P1 (docs/equipe-personnes-design.md) : grille,
 * fiche, profil, photo. Les données personnelles (`person_private`) ne sont
 * lues que si l'appelant y a droit (§3.2).
 */
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const day = (v: unknown) => (v ? (typeof v === "string" ? v.slice(0, 10) : new Date(v as Date).toISOString().slice(0, 10)) : null);

/** Lecteur de la fiche : son rôle et son compte (accès aux données personnelles). */
export type Viewer = { userId: string; role: MemberRole };

/**
 * Tout membre a une personne (design §1) : celles qui manquent (comptes
 * ajoutés hors de l'API, ferme importée) sont créées à la lecture.
 */
export async function ensureMemberPeople(tx: Tx) {
  await tx.execute(sql`
    INSERT INTO people (id, farm_id, name, user_id, active)
    SELECT gen_random_uuid(), m.farm_id, coalesce(nullif(btrim(u.name), ''), split_part(u.email, '@', 1)), m.user_id, true
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.farm_id = current_farm_id()
      AND NOT EXISTS (SELECT 1 FROM people p WHERE p.farm_id = m.farm_id AND p.user_id = m.user_id)
    ON CONFLICT DO NOTHING`);
}

type CardRow = {
  id: string;
  farm_id: string;
  name: string;
  user_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  first_name: string | null;
  last_name: string | null;
  photo_hash: string | null;
  member_role: MemberRole | null;
  certiphyto_category: string | null;
  certiphyto_number: string | null;
  certiphyto_valid_until: string | null;
  external_ids: Record<string, unknown> | null;
  invited: boolean;
};

const CARD = sql`
  SELECT p.id, p.farm_id, p.name, p.user_id, p.active, p.created_at, p.updated_at,
         p.first_name, p.last_name, ph.sha256 AS photo_hash, m.role AS member_role,
         p.certiphyto_category, p.certiphyto_number, p.certiphyto_valid_until, p.external_ids,
         EXISTS (SELECT 1 FROM person_invitations iv WHERE iv.person_id = p.id AND iv.accepted_at IS NULL
                   AND iv.revoked_at IS NULL AND iv.expires_at > now()) AS invited
  FROM people p
  LEFT JOIN person_photos ph ON ph.id = p.photo_id
  LEFT JOIN memberships m ON m.farm_id = p.farm_id AND m.user_id = p.user_id`;

function toCard(r: CardRow, at: string): PersonCard {
  const validUntil = day(r.certiphyto_valid_until);
  return {
    id: r.id,
    farmId: r.farm_id,
    name: r.name,
    userId: r.user_id,
    active: r.active,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    firstName: r.first_name,
    lastName: r.last_name,
    photo: r.photo_hash ? { hash: r.photo_hash.slice(0, 16) } : null,
    account: r.member_role ? { status: "active", role: r.member_role } : { status: r.invited ? "invited" : "none", role: null },
    certiphyto: { status: certiphytoStatusAt(validUntil, at), validUntil },
    monthHours: null,
    lastIntervention: null,
  };
}

/** Grille Équipe : actives d'abord, puis par nom. */
export async function listPeople(db: Database, farmId: string, at: string): Promise<PersonCard[]> {
  return withFarm(db, farmId, async (tx) => {
    await ensureMemberPeople(tx);
    const cards = (await rows<CardRow>(tx, sql`${CARD} ORDER BY p.active DESC, lower(p.name)`)).map((r) => toCard(r, at));
    // Heures du mois et dernière intervention (lot P2).
    const work = await cardsWork(tx, cards.map((c) => c.id), at);
    return cards.map((c) => ({ ...c, ...work.get(c.id) }));
  });
}

/** Responsable, ou la personne elle-même. */
export const canSeePrivate = (viewer: Viewer, person: { userId: string | null }) => viewer.role === "owner" || (!!person.userId && person.userId === viewer.userId);

type PrivateRow = {
  email: string | null;
  mobile: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  birth_date: string | null;
  contract_type: string | null;
  contract_started_on: string | null;
  contract_ended_on: string | null;
};

const toPrivate = (r: PrivateRow | undefined): PersonPrivate => ({
  email: r?.email ?? null,
  mobile: r?.mobile ?? null,
  address: { line1: r?.address_line1 ?? null, line2: r?.address_line2 ?? null, postalCode: r?.postal_code ?? null, city: r?.city ?? null, country: r?.country ?? null },
  birthDate: day(r?.birth_date),
  contract: { type: (r?.contract_type as PersonPrivate["contract"]["type"]) ?? null, startedOn: day(r?.contract_started_on), endedOn: day(r?.contract_ended_on) },
});

/** Fiche : `private` seulement pour le responsable et la personne elle-même. */
export async function personSheet(db: Database, farmId: string, id: string, at: string, viewer: Viewer): Promise<PersonSheet> {
  return withFarm(db, farmId, async (tx) => {
    await ensureMemberPeople(tx);
    const [r] = await rows<CardRow>(tx, sql`${CARD} WHERE p.id = ${id}`);
    if (!r) throw new NotFound("Personne introuvable");
    const card = { ...toCard(r, at), ...(await cardsWork(tx, [id], at)).get(id) };
    const sheet: PersonSheet = {
      ...card,
      certiphyto: {
        status: card.certiphyto.status,
        category: (r.certiphyto_category as PersonSheet["certiphyto"]["category"]) ?? null,
        number: r.certiphyto_number,
        validUntil: card.certiphyto.validUntil,
      },
      external: { ekylibre: Object.keys(r.external_ids ?? {}).some((k) => k.startsWith("ekylibre")) },
      canEditContact: canSeePrivate(viewer, card),
    };
    if (canSeePrivate(viewer, card)) {
      const [p] = await rows<PrivateRow>(tx, sql`SELECT * FROM person_private WHERE person_id = ${id}`);
      sheet.private = toPrivate(p);
    }
    if (viewer.role === "owner") sheet.invitation = await openInvitation(tx, id);
    return sheet;
  });
}

/** Champs du profil réservés au responsable (identité, Certiphyto, contrat, naissance). */
function ownerOnlyFields(body: PersonProfileWrite): string[] {
  const out: string[] = [];
  for (const k of ["firstName", "lastName", "name", "active", "certiphyto"] as const) if (body[k] !== undefined) out.push(k);
  if (body.private?.birthDate !== undefined) out.push("private.birthDate");
  if (body.private?.contract !== undefined) out.push("private.contract");
  return out;
}

/** Une contrainte de la base (format, dates de contrat) devient une erreur 400 lisible. */
async function checked(tx: Tx, q: ReturnType<typeof sql>) {
  try {
    await tx.execute(q);
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23514") throw new BadRequest("Valeur refusée : vérifiez le portable, le pays et les dates du contrat.");
    throw e;
  }
}

async function writePrivate(tx: Tx, farmId: string, id: string, priv: NonNullable<PersonProfileWrite["private"]>) {
  const a = priv.address;
  // Un champ absent du corps garde sa valeur ; null l'efface.
  const keep = <T>(v: T | undefined, column: string) => (v === undefined ? sql.raw(`person_private.${column}`) : sql`${v}`);
  const empty = <T>(v: T | undefined) => (v === undefined ? null : v);
  await checked(tx, sql`
    INSERT INTO person_private (person_id, farm_id, email, mobile, address_line1, address_line2, postal_code, city, country,
                                birth_date, contract_type, contract_started_on, contract_ended_on)
    VALUES (${id}, ${farmId}, ${empty(priv.email)}, ${empty(priv.mobile)}, ${empty(a?.line1)}, ${empty(a?.line2)}, ${empty(a?.postalCode)},
            ${empty(a?.city)}, ${empty(a?.country)}, ${empty(priv.birthDate)}, ${empty(priv.contract?.type)},
            ${empty(priv.contract?.startedOn)}, ${empty(priv.contract?.endedOn)})
    ON CONFLICT (person_id) DO UPDATE SET
      email = ${keep(priv.email, "email")}, mobile = ${keep(priv.mobile, "mobile")},
      address_line1 = ${keep(a?.line1, "address_line1")}, address_line2 = ${keep(a?.line2, "address_line2")},
      postal_code = ${keep(a?.postalCode, "postal_code")}, city = ${keep(a?.city, "city")}, country = ${keep(a?.country, "country")},
      birth_date = ${keep(priv.birthDate, "birth_date")}, contract_type = ${keep(priv.contract?.type, "contract_type")},
      contract_started_on = ${keep(priv.contract?.startedOn, "contract_started_on")},
      contract_ended_on = ${keep(priv.contract?.endedOn, "contract_ended_on")}, updated_at = now()`);
}

/** Création par le responsable (ancien format accepté : `name`, `role`, `userId`). */
export async function createPerson(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  body: PersonProfileWrite & { id?: string; role?: string; userId?: string },
): Promise<{ id: string }> {
  const name = displayName(body);
  if (!name) throw new BadRequest("Prénom et nom, ou nom, requis.");
  const id = body.id ?? ctx.newId();
  return withFarm(db, farmId, async (tx) => {
    if (body.userId) {
      const [m] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM memberships WHERE user_id = ${body.userId}`);
      if (!m || m.n === 0) throw new BadRequest("Ce compte n'est pas membre de la ferme.");
      const [taken] = await rows<{ id: string }>(tx, sql`SELECT id FROM people WHERE user_id = ${body.userId}`);
      if (taken) throw new Conflict("Ce compte a déjà sa personne sur la ferme.");
    }
    const c = body.certiphyto;
    await tx.execute(sql`
      INSERT INTO people (id, farm_id, name, first_name, last_name, user_id, active,
                          certiphyto_category, certiphyto_number, certiphyto_valid_until)
      VALUES (${id}, ${farmId}, ${name}, ${body.firstName ?? null}, ${body.lastName ?? null},
              ${body.userId ?? null}, ${body.active ?? true}, ${c?.category ?? null}, ${c?.number ?? null}, ${c?.validUntil ?? null})
      ON CONFLICT (id) DO NOTHING`);
    if (body.private) await writePrivate(tx, farmId, id, body.private);
    await audit(tx, farmId, ctx, id, "create");
    return { id };
  });
}

/**
 * Modification : le responsable change tout ; la personne elle-même ne
 * change que ses coordonnées (email, portable, adresse).
 */
export async function updatePerson(db: Database, farmId: string, ctx: DomainCtx, id: string, viewer: Viewer, body: PersonProfileWrite): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ user_id: string | null; first_name: string | null; last_name: string | null; name: string }>(
      tx,
      sql`SELECT user_id, first_name, last_name, name FROM people WHERE id = ${id}`,
    );
    if (!p) throw new NotFound("Personne introuvable");
    const self = !!p.user_id && p.user_id === viewer.userId;
    if (viewer.role !== "owner") {
      if (!self) throw new NotFound("Personne introuvable"); // pas d'énumération des fiches d'autrui
      const forbidden = ownerOnlyFields(body);
      if (forbidden.length) throw new BadRequest(`Champs réservés au responsable : ${forbidden.join(", ")}.`);
    }
    const firstName = body.firstName === undefined ? p.first_name : body.firstName;
    const lastName = body.lastName === undefined ? p.last_name : body.lastName;
    const name = displayName({ firstName, lastName, name: body.name ?? p.name });
    if (!name) throw new BadRequest("Prénom et nom, ou nom, requis.");
    const c = body.certiphyto;
    await tx.execute(sql`
      UPDATE people SET
        name = ${name}, first_name = ${firstName}, last_name = ${lastName},
        active = coalesce(${body.active ?? null}::boolean, active),
        certiphyto_category = ${c && c.category !== undefined ? sql`${c.category}` : sql`certiphyto_category`},
        certiphyto_number = ${c && c.number !== undefined ? sql`${c.number}` : sql`certiphyto_number`},
        certiphyto_valid_until = ${c && c.validUntil !== undefined ? sql`${c.validUntil}` : sql`certiphyto_valid_until`},
        updated_at = now()
      WHERE id = ${id}`);
    if (body.private) await writePrivate(tx, farmId, id, body.private);
    await audit(tx, farmId, ctx, id, "update");
  });
}

/** Journal : qui a modifié quelle fiche, sans les valeurs (données personnelles). */
async function audit(tx: Tx, farmId: string, ctx: DomainCtx, id: string, action: string) {
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
    VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'person', ${id}, ${action}, '{}'::jsonb)`);
}

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Type d'image d'après les premiers octets (PNG, JPEG), sinon null. */
export function photoType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Vérifie que l'appelant peut changer la photo : responsable ou la personne elle-même. */
async function assertPhotoWriter(tx: Tx, id: string, viewer: Viewer) {
  const [p] = await rows<{ user_id: string | null; photo_id: string | null }>(tx, sql`SELECT user_id, photo_id FROM people WHERE id = ${id}`);
  if (!p || (viewer.role !== "owner" && p.user_id !== viewer.userId)) throw new NotFound("Personne introuvable");
  return p;
}

export async function setPhoto(db: Database, farmId: string, id: string, viewer: Viewer, bytes: Uint8Array | null): Promise<void> {
  if (bytes) {
    if (bytes.length > PHOTO_MAX_BYTES) throw new BadRequest("Photo trop lourde (2 Mo au plus).");
    if (!photoType(bytes)) throw new BadRequest("Photo PNG ou JPEG attendue.");
  }
  await withFarm(db, farmId, async (tx) => {
    const p = await assertPhotoWriter(tx, id, viewer);
    let photoId: string | null = null;
    if (bytes) {
      photoId = crypto.randomUUID();
      const sha = createHash("sha256").update(bytes).digest("hex");
      await tx.execute(sql`
        INSERT INTO person_photos (id, farm_id, media_type, bytes, size, sha256)
        VALUES (${photoId}, ${farmId}, ${photoType(bytes)}, ${Buffer.from(bytes)}, ${bytes.length}, ${sha})`);
    }
    await tx.execute(sql`UPDATE people SET photo_id = ${photoId}, updated_at = now() WHERE id = ${id}`);
    if (p.photo_id) await tx.execute(sql`DELETE FROM person_photos WHERE id = ${p.photo_id}`);
  });
}

export async function getPhoto(db: Database, farmId: string, id: string): Promise<{ bytes: Uint8Array; mediaType: string; etag: string } | null> {
  return withFarm(db, farmId, async (tx) => {
    const [r] = await rows<{ bytes: Uint8Array; media_type: string; sha256: string }>(
      tx,
      sql`SELECT ph.bytes, ph.media_type, ph.sha256 FROM people p JOIN person_photos ph ON ph.id = p.photo_id WHERE p.id = ${id}`,
    );
    return r ? { bytes: new Uint8Array(r.bytes), mediaType: r.media_type, etag: `"${r.sha256.slice(0, 16)}"` } : null;
  });
}

// ---------------------------------------------------------------------------
// Compte d'une personne (rôle, retrait de l'accès)
// ---------------------------------------------------------------------------

async function memberOf(tx: Tx, id: string): Promise<string> {
  const [p] = await rows<{ user_id: string | null }>(tx, sql`SELECT user_id FROM people WHERE id = ${id}`);
  if (!p) throw new NotFound("Personne introuvable");
  if (!p.user_id) throw new Conflict("Cette personne n'a pas de compte sur la ferme.");
  return p.user_id;
}

async function assertAnotherOwner(tx: Tx, userId: string) {
  const [r] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM memberships WHERE role = 'owner' AND user_id <> ${userId}`);
  if (!r || r.n === 0) throw new Conflict("La ferme doit garder au moins un responsable.");
}

export async function setAccountRole(db: Database, farmId: string, id: string, role: MemberRole): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const userId = await memberOf(tx, id);
    if (role !== "owner") await assertAnotherOwner(tx, userId);
    await tx.execute(sql`UPDATE memberships SET role = ${role} WHERE user_id = ${userId}`);
  });
}

/** Retire l'accès : la personne et son historique restent, sans compte. */
export async function removeAccount(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const userId = await memberOf(tx, id);
    await assertAnotherOwner(tx, userId);
    await tx.execute(sql`DELETE FROM memberships WHERE user_id = ${userId}`);
    await tx.execute(sql`UPDATE people SET user_id = NULL, updated_at = now() WHERE id = ${id}`);
  });
}

// ---------------------------------------------------------------------------
// Effacement (design §4.4)
// ---------------------------------------------------------------------------

/**
 * Sans historique (aucune intervention, aucun attelage type) : la personne est
 * supprimée. Avec un historique : anonymisée — nom remplacé, identité,
 * coordonnées, photo et Certiphyto effacés, accès retiré ; ses interventions
 * et ses heures restent (registres réglementaires).
 */
export async function erasePerson(db: Database, farmId: string, ctx: DomainCtx, id: string): Promise<"deleted" | "anonymized"> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ user_id: string | null; photo_id: string | null; used: boolean }>(
      tx,
      sql`SELECT p.user_id, p.photo_id,
                 EXISTS (SELECT 1 FROM intervention_parameters ip WHERE ip.ref_type = 'person' AND ip.ref_id = p.id)
                 OR EXISTS (SELECT 1 FROM crew_template_members m WHERE m.person_id = p.id) AS used
          FROM people p WHERE p.id = ${id}`,
    );
    if (!p) throw new NotFound("Personne introuvable");
    if (p.user_id) {
      await assertAnotherOwner(tx, p.user_id);
      await tx.execute(sql`DELETE FROM memberships WHERE user_id = ${p.user_id}`);
    }
    await tx.execute(sql`UPDATE person_invitations SET revoked_at = now() WHERE person_id = ${id} AND accepted_at IS NULL AND revoked_at IS NULL`);
    if (!p.used) {
      await tx.execute(sql`DELETE FROM people WHERE id = ${id}`);
      if (p.photo_id) await tx.execute(sql`DELETE FROM person_photos WHERE id = ${p.photo_id}`);
      await audit(tx, farmId, ctx, id, "delete");
      return "deleted";
    }
    const [n] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int + 1 AS n FROM people WHERE name LIKE 'Personne anonymisée %'`);
    await tx.execute(sql`
      UPDATE people SET name = ${`Personne anonymisée ${n!.n}`}, first_name = NULL, last_name = NULL, user_id = NULL,
        active = false, photo_id = NULL, certiphyto_category = NULL, certiphyto_number = NULL, certiphyto_valid_until = NULL,
        external_ids = '{}'::jsonb, updated_at = now()
      WHERE id = ${id}`);
    await tx.execute(sql`DELETE FROM person_private WHERE person_id = ${id}`);
    if (p.photo_id) await tx.execute(sql`DELETE FROM person_photos WHERE id = ${p.photo_id}`);
    await audit(tx, farmId, ctx, id, "anonymize");
    return "anonymized";
  });
}

/** Personne du compte connecté sur la ferme (créée si besoin, comme pour tout membre). */
export async function personOfUser(db: Database, farmId: string, userId: string): Promise<string> {
  return withFarm(db, farmId, async (tx) => {
    await ensureMemberPeople(tx);
    const [p] = await rows<{ id: string }>(tx, sql`SELECT id FROM people WHERE user_id = ${userId}`);
    if (!p) throw new NotFound("Aucune fiche pour ce compte sur la ferme.");
    return p.id;
  });
}
