import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { DomainCtx } from "@fourmy/domain";
import { DEFAULT_FARM_DISPLAY, type FarmCertification, type FarmCertificationWrite, type FarmDisplay, type FarmProfile, type FarmProfileIdentity, type FarmSite, type FarmSiteWrite } from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * « Ma ferme », lot F1 (claudedocs/conception_ma_ferme.md §5) : identité sur
 * `farms`, certificats de l'exploitation, sites (le siège porte l'adresse).
 * Toutes les écritures sont journalisées dans `audit_log` (N5).
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const day = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

async function audit(tx: Tx, farmId: string, ctx: DomainCtx, entity: string, entityId: string, action: string, diff: object) {
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
    VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, ${entity}, ${entityId}, ${action}, ${JSON.stringify(diff)}::jsonb)`);
}

// ---------------------------------------------------------------------------
// Identité
// ---------------------------------------------------------------------------

type IdentityRow = {
  name: string; legal_name: string | null; legal_form: FarmProfileIdentity["legalForm"]; siret: string | null; vat_number: string | null;
  naf_code: string | null; pacage: string | null; cvi: string | null; ede: string | null; phone: string | null; email: string | null;
  legal_rep_person_id: string | null; legal_rep_name: string | null;
};

async function identityTx(tx: Tx, farmId: string): Promise<FarmProfileIdentity> {
  const [f] = await rows<IdentityRow>(tx, sql`
    SELECT name, legal_name, legal_form, siret, vat_number, naf_code, pacage, cvi, ede, phone, email, legal_rep_person_id, legal_rep_name
    FROM farms WHERE id = ${farmId}`);
  if (!f) throw new NotFound("Ferme introuvable");
  return {
    name: f.name,
    legalName: f.legal_name,
    legalForm: f.legal_form,
    siret: f.siret,
    vatNumber: f.vat_number,
    nafCode: f.naf_code,
    pacage: f.pacage,
    cvi: f.cvi,
    ede: f.ede,
    phone: f.phone,
    email: f.email,
    legalRep: f.legal_rep_person_id ? { personId: f.legal_rep_person_id } : f.legal_rep_name ? { name: f.legal_rep_name } : null,
  };
}

export async function putIdentity(db: Database, farmId: string, ctx: DomainCtx, body: FarmProfileIdentity): Promise<FarmProfileIdentity> {
  return withFarm(db, farmId, async (tx) => {
    const before = await identityTx(tx, farmId);
    const rep = body.legalRep;
    const personId = rep && "personId" in rep ? rep.personId : null;
    // La contrainte de clé étrangère ignore la RLS : on vérifie que la personne est bien de cette ferme.
    if (personId && !(await rows(tx, sql`SELECT 1 FROM people WHERE id = ${personId}`)).length) throw new BadRequest("Responsable légal : personne inconnue dans cette ferme");
    await tx.execute(sql`
      UPDATE farms SET name = ${body.name}, legal_name = ${body.legalName}, legal_form = ${body.legalForm}, siret = ${body.siret},
        vat_number = ${body.vatNumber}, naf_code = ${body.nafCode}, pacage = ${body.pacage}, cvi = ${body.cvi}, ede = ${body.ede},
        phone = ${body.phone}, email = ${body.email}, legal_rep_person_id = ${personId},
        legal_rep_name = ${rep && "name" in rep ? rep.name : null}, updated_at = now()
      WHERE id = ${farmId}`);
    const after = await identityTx(tx, farmId);
    await audit(tx, farmId, ctx, "farm", farmId, "update_identity", { before, after });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Certificats de l'exploitation
// ---------------------------------------------------------------------------

type CertRow = { id: string; kind: FarmCertification["kind"]; body: string | null; number: string | null; level: FarmCertification["level"]; expires_on: unknown };
const toCert = (r: CertRow): FarmCertification => ({ id: r.id, kind: r.kind, body: r.body, number: r.number, level: r.level, expiresOn: day(r.expires_on) });

export async function listFarmCertifications(tx: Tx): Promise<FarmCertification[]> {
  return (await rows<CertRow>(tx, sql`SELECT id, kind, body, number, level, expires_on FROM farm_certifications ORDER BY kind, expires_on NULLS LAST, created_at`)).map(toCert);
}

export async function createFarmCertification(db: Database, farmId: string, ctx: DomainCtx, body: FarmCertificationWrite): Promise<FarmCertification> {
  return withFarm(db, farmId, async (tx) => {
    const id = ctx.newId();
    const [r] = await rows<CertRow>(tx, sql`
      INSERT INTO farm_certifications (id, farm_id, kind, body, number, level, expires_on)
      VALUES (${id}, ${farmId}, ${body.kind}, ${body.body}, ${body.number}, ${body.level}, ${body.expiresOn})
      RETURNING id, kind, body, number, level, expires_on`);
    await audit(tx, farmId, ctx, "farm_certification", id, "create", body);
    return toCert(r!);
  });
}

export async function updateFarmCertification(db: Database, farmId: string, ctx: DomainCtx, id: string, body: FarmCertificationWrite): Promise<FarmCertification> {
  return withFarm(db, farmId, async (tx) => {
    const [r] = await rows<CertRow>(tx, sql`
      UPDATE farm_certifications SET kind = ${body.kind}, body = ${body.body}, number = ${body.number}, level = ${body.level},
        expires_on = ${body.expiresOn}, updated_at = now()
      WHERE id = ${id} RETURNING id, kind, body, number, level, expires_on`);
    if (!r) throw new NotFound("Certificat introuvable");
    await audit(tx, farmId, ctx, "farm_certification", id, "update", body);
    return toCert(r);
  });
}

export async function deleteFarmCertification(db: Database, farmId: string, ctx: DomainCtx, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [r] = await rows<CertRow>(tx, sql`DELETE FROM farm_certifications WHERE id = ${id} RETURNING id, kind, body, number, level, expires_on`);
    if (!r) throw new NotFound("Certificat introuvable");
    await audit(tx, farmId, ctx, "farm_certification", id, "delete", toCert(r));
  });
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

type SiteRow = {
  id: string; name: string; is_headquarters: boolean; address_line1: string | null; address_line2: string | null; postal_code: string | null;
  city: string | null; insee_code: string | null; lat: number | null; lon: number | null; location_source: FarmSite["locationSource"];
  geocode_score: number | null; geocode_type: NonNullable<FarmSite["geocode"]>["type"] | null; radius_m: number;
};
const SITE_COLUMNS = sql`id, name, is_headquarters, address_line1, address_line2, postal_code, city, insee_code,
  ST_Y(location) AS lat, ST_X(location) AS lon, location_source, geocode_score, geocode_type, radius_m`;
const toSite = (r: SiteRow): FarmSite => ({
  id: r.id,
  name: r.name,
  isHeadquarters: r.is_headquarters,
  address: { line1: r.address_line1, line2: r.address_line2, postalCode: r.postal_code, city: r.city, inseeCode: r.insee_code },
  location: r.lat === null || r.lon === null ? null : { lat: Number(r.lat), lon: Number(r.lon) },
  locationSource: r.location_source,
  geocode: r.geocode_score === null || r.geocode_type === null ? null : { score: Number(r.geocode_score), type: r.geocode_type },
  radiusM: r.radius_m,
});

const point = (s: FarmSiteWrite) => (s.location ? sql`ST_SetSRID(ST_MakePoint(${s.location.lon}, ${s.location.lat}), 4326)` : sql`NULL`);

export async function listSites(tx: Tx): Promise<FarmSite[]> {
  return (await rows<SiteRow>(tx, sql`SELECT ${SITE_COLUMNS} FROM farm_sites ORDER BY is_headquarters DESC, position, created_at`)).map(toSite);
}

export async function createSite(db: Database, farmId: string, ctx: DomainCtx, body: FarmSiteWrite): Promise<FarmSite> {
  return withFarm(db, farmId, async (tx) => {
    const id = ctx.newId();
    const [r] = await rows<SiteRow>(tx, sql`
      INSERT INTO farm_sites (id, farm_id, name, address_line1, address_line2, postal_code, city, insee_code, location, location_source,
        geocode_score, geocode_type, radius_m, position)
      VALUES (${id}, ${farmId}, ${body.name}, ${body.address.line1}, ${body.address.line2}, ${body.address.postalCode}, ${body.address.city},
        ${body.address.inseeCode}, ${point(body)}, ${body.locationSource}, ${body.geocode?.score ?? null}, ${body.geocode?.type ?? null},
        ${body.radiusM}, (SELECT coalesce(max(position), 0) + 1 FROM farm_sites))
      RETURNING ${SITE_COLUMNS}`);
    await audit(tx, farmId, ctx, "farm_site", id, "create", body);
    return toSite(r!);
  });
}

export async function updateSite(db: Database, farmId: string, ctx: DomainCtx, id: string, body: FarmSiteWrite): Promise<FarmSite> {
  return withFarm(db, farmId, async (tx) => {
    const [before] = await rows<SiteRow>(tx, sql`SELECT ${SITE_COLUMNS} FROM farm_sites WHERE id = ${id}`);
    if (!before) throw new NotFound("Site introuvable");
    const [r] = await rows<SiteRow>(tx, sql`
      UPDATE farm_sites SET name = ${body.name}, address_line1 = ${body.address.line1}, address_line2 = ${body.address.line2},
        postal_code = ${body.address.postalCode}, city = ${body.address.city}, insee_code = ${body.address.inseeCode},
        location = ${point(body)}, location_source = ${body.locationSource}, geocode_score = ${body.geocode?.score ?? null},
        geocode_type = ${body.geocode?.type ?? null}, radius_m = ${body.radiusM}, updated_at = now()
      WHERE id = ${id} RETURNING ${SITE_COLUMNS}`);
    await audit(tx, farmId, ctx, "farm_site", id, "update", { before: toSite(before), after: body });
    return toSite(r!);
  });
}

export async function deleteSite(db: Database, farmId: string, ctx: DomainCtx, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [r] = await rows<SiteRow>(tx, sql`SELECT ${SITE_COLUMNS} FROM farm_sites WHERE id = ${id}`);
    if (!r) throw new NotFound("Site introuvable");
    // Le trigger le refuse aussi (E20) ; ici pour un message clair.
    if (r.is_headquarters) throw new Conflict("Le siège ne se supprime pas : déplacez-le.");
    await tx.execute(sql`DELETE FROM farm_sites WHERE id = ${id}`);
    await audit(tx, farmId, ctx, "farm_site", id, "delete", toSite(r));
  });
}

/**
 * Parcelles actuelles qui ne tiennent pas entièrement dans les zones des
 * sites (E19). Null si aucun site n'a de point : il n'y a pas encore de zone.
 */
async function parcelsOutsideTx(tx: Tx): Promise<number | null> {
  const [r] = await rows<{ located: number; outside: number }>(tx, sql`
    WITH zones AS (
      SELECT ST_Union(ST_Buffer(location::geography, radius_m)::geometry) AS g FROM farm_sites WHERE location IS NOT NULL
    )
    SELECT (SELECT count(*) FROM farm_sites WHERE location IS NOT NULL)::int AS located,
           (SELECT count(*) FROM land_parcel_versions v, zones
             WHERE v.valid @> now() AND (zones.g IS NULL OR NOT ST_Covers(zones.g, v.shape)))::int AS outside`);
  return r && r.located > 0 ? r.outside : null;
}

// ---------------------------------------------------------------------------
// Préférences d'affichage (F2)
// ---------------------------------------------------------------------------

async function displayTx(tx: Tx): Promise<FarmDisplay> {
  const [s] = await rows<{ display: Partial<FarmDisplay> }>(tx, sql`SELECT display FROM farm_settings`);
  return { ...DEFAULT_FARM_DISPLAY, ...(s?.display ?? {}) };
}

export async function putDisplay(db: Database, farmId: string, ctx: DomainCtx, body: FarmDisplay): Promise<FarmDisplay> {
  return withFarm(db, farmId, async (tx) => {
    const before = await displayTx(tx);
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, display) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET display = excluded.display, updated_at = now()`);
    await audit(tx, farmId, ctx, "farm_settings", farmId, "update_display", { before, after: body });
    return displayTx(tx);
  });
}

/** Point du siège, s'il est placé (repli de la météo, E11). */
export async function headquartersPoint(tx: Tx): Promise<{ lat: number; lon: number } | null> {
  const [r] = await rows<{ lat: number; lon: number }>(tx, sql`SELECT ST_Y(location) AS lat, ST_X(location) AS lon FROM farm_sites WHERE is_headquarters AND location IS NOT NULL`);
  return r ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
}

export async function getProfile(db: Database, farmId: string, canEdit: boolean): Promise<FarmProfile> {
  return withFarm(db, farmId, async (tx) => ({
    identity: await identityTx(tx, farmId),
    certifications: await listFarmCertifications(tx),
    sites: await listSites(tx),
    parcelsOutside: await parcelsOutsideTx(tx),
    display: await displayTx(tx),
    canEdit,
  }));
}
