import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { DomainError } from "@fourmy/domain";
import type { Activity, ActivityFamily, ActivityParcelsWrite, ActivityWrite, ReferenceProduction } from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Activités de la ferme (lot C des retours du 08/11/2026) : liste avec les
 * parcelles d'une campagne, création et modification (production de
 * référence Lexicon), rattachement des parcelles d'une campagne.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

/** Adresse publique d'une image du référentiel (« domaine/nom »). */
export const pictureUrl = (key: string | null) => (key ? `/api/v1/lexicon/pictures/${key}` : null);

/** Nature de production d'une famille d'activité (null : pas de parcelles). */
export function natureOf(family: ActivityFamily): "field_crop" | "vine" | "grassland" | null {
  if (family === "vine_farming") return "vine";
  if (family === "plant_farming" || family === "plant_nursery") return "field_crop";
  if (family === "animal_farming") return "grassland";
  return null;
}

type Row = {
  id: string;
  name: string;
  family: ActivityFamily;
  reference: string | null;
  reference_label: string | null;
  cultivation: string | null;
  cultivation_label: string | null;
  color: string | null;
  suspended: boolean;
  crop_code: string | null;
  crop_label: string | null;
  crop_oepp: string | null;
  crop_chosen: boolean;
  picture: string | null;
  parcel_ids: string[] | null;
  area_m2: number | null;
};

const toActivity = (r: Row): Activity => ({
  id: r.id,
  name: r.name,
  family: r.family,
  reference: r.reference,
  referenceLabel: r.reference_label,
  cultivation: r.cultivation,
  cultivationLabel: r.cultivation_label,
  color: r.color,
  suspended: r.suspended,
  crop: r.crop_code ? { code: r.crop_code, label: (r.crop_label ?? "").trim(), oepp: r.crop_oepp, proposed: !r.crop_chosen } : null,
  pictureUrl: pictureUrl(r.picture),
  parcelIds: r.parcel_ids ?? [],
  areaM2: r.area_m2 ?? 0,
});

async function select(tx: Tx, year: number, id?: string): Promise<Activity[]> {
  const list = await rows<Row>(
    tx,
    sql`SELECT a.id, a.name, a.family, a.reference, lx.label AS reference_label,
               coalesce(a.cultivation, lx.specie) AS cultivation,
               (SELECT t.label FROM taxonomy t WHERE t.reference_name = coalesce(a.cultivation, lx.specie)) AS cultivation_label,
               -- Couleur : celle de l'activité, sinon celle de sa variété (nomenclature d'Ekylibre), sinon de la référence.
               coalesce(a.color, fourmy_variety_color(coalesce(a.cultivation, lx.specie)), lx.color) AS color, a.suspended,
               fourmy_activity_picture(coalesce(a.cultivation, lx.specie), a.family, a.reference) AS picture,
               crop.code AS crop_code, crop.label AS crop_label, crop.oepp AS crop_oepp, a.crop_code IS NOT NULL AS crop_chosen,
               prod.parcel_ids, prod.area_m2
        FROM activities a
        LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        LEFT JOIN ref_phyto_crops crop ON crop.code = fourmy_activity_crop(a.id)
        LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT p.land_parcel_id) AS parcel_ids,
                 -- Surface de la parcelle pendant la campagne (sa dernière version qui la recouvre).
                 sum((SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = p.land_parcel_id
                       AND v.valid && tstzrange(c.starts_on::timestamptz, (c.stops_on + 1)::timestamptz)
                       ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1))::float8 AS area_m2
          FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          WHERE p.activity_id = a.id AND c.year = ${year}) prod ON true
        ${id ? sql`WHERE a.id = ${id}` : sql``}
        ORDER BY a.suspended, a.family, a.name`,
  );
  return list.map(toActivity);
}

export async function listActivities(db: Database, farmId: string, year: number): Promise<Activity[]> {
  return withFarm(db, farmId, (tx) => select(tx, year));
}

async function checkCrop(tx: Tx, body: ActivityWrite) {
  if (!body.cropCode) return;
  const [c] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM ref_phyto_crops WHERE code = ${body.cropCode}`);
  if (!c!.n) throw new BadRequest("Culture inconnue du référentiel du ministère.");
}

async function checkReference(tx: Tx, body: ActivityWrite) {
  if (!body.reference) return;
  const [ref] = await rows<{ family: string }>(tx, sql`SELECT family FROM lexicon_productions WHERE reference_name = ${body.reference}`);
  if (!ref) {
    // Table vide : le référentiel n'est pas chargé (worker non lancé), la référence n'est pas en cause.
    const [any] = await rows<{ one: number }>(tx, sql`SELECT 1 AS one FROM lexicon_productions LIMIT 1`);
    if (!any) {
      throw new DomainError(
        "Référentiel Lexicon non chargé : productions de référence indisponibles. Lancer le worker ou `corepack pnpm --filter @fourmy/lexicon sync`.",
      );
    }
    throw new DomainError(`Production de référence inconnue : ${body.reference}.`);
  }
}

async function uniqueName(tx: Tx, name: string, self: string | null) {
  const [same] = await rows<{ id: string }>(tx, sql`SELECT id FROM activities WHERE name = ${name} ${self ? sql`AND id <> ${self}` : sql``}`);
  if (same) throw new Conflict(`Une activité « ${name} » existe déjà.`);
}

export async function createActivity(db: Database, farmId: string, body: ActivityWrite, year: number): Promise<Activity> {
  return withFarm(db, farmId, async (tx) => {
    await checkReference(tx, body);
    await checkCrop(tx, body);
    await uniqueName(tx, body.name, null);
    const id = crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO activities (id, farm_id, name, family, reference, cultivation, color, suspended, crop_code)
      VALUES (${id}, ${farmId}, ${body.name}, ${body.family}, ${body.reference ?? null}, ${body.cultivation ?? null},
              ${body.color ?? null}, ${body.suspended ?? false}, ${body.cropCode ?? null})`);
    return (await select(tx, year, id))[0]!;
  });
}

export async function updateActivity(db: Database, farmId: string, id: string, body: ActivityWrite, year: number): Promise<Activity> {
  return withFarm(db, farmId, async (tx) => {
    const [current] = await rows<{ family: string }>(tx, sql`SELECT family FROM activities WHERE id = ${id}`);
    if (!current) throw new NotFound("Activité introuvable");
    await checkReference(tx, body);
    await checkCrop(tx, body);
    await uniqueName(tx, body.name, id);
    const nature = natureOf(body.family);
    if (!nature) {
      const [used] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM productions WHERE activity_id = ${id}`);
      if (used!.n > 0) throw new DomainError("Cette activité a des parcelles : sa famille doit rester une famille de cultures, de vigne ou d'élevage.");
    }
    await tx.execute(sql`
      UPDATE activities SET name = ${body.name}, family = ${body.family}, reference = ${body.reference ?? null},
             cultivation = ${body.cultivation ?? null}, color = ${body.color ?? null},
             suspended = ${body.suspended ?? false},
             crop_code = ${body.cropCode === undefined ? sql`crop_code` : body.cropCode}, deduced = false, updated_at = now()
      WHERE id = ${id}`);
    // Les productions suivent la famille (nature) ; la culture vient désormais de l'activité.
    if (nature) await tx.execute(sql`UPDATE productions SET nature = ${nature}, updated_at = now() WHERE activity_id = ${id} AND nature <> ${nature}`);
    return (await select(tx, year, id))[0]!;
  });
}

export async function deleteActivity(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [a] = await rows<{ n: number }>(
      tx,
      sql`SELECT (SELECT count(*) FROM productions p WHERE p.activity_id = a.id)::int AS n FROM activities a WHERE a.id = ${id}`,
    );
    if (!a) throw new NotFound("Activité introuvable");
    if (a.n > 0) throw new DomainError(`Cette activité a ${a.n} production(s) : retirez ses parcelles ou mettez-la en sommeil.`);
    await tx.execute(sql`DELETE FROM activities WHERE id = ${id}`);
  });
}

/**
 * Parcelles de l'activité pour une campagne : une production par parcelle
 * ajoutée, celles retirées sont supprimées. Les productions des autres
 * activités (cultures successives) ne sont pas touchées.
 */
export async function setActivityParcels(db: Database, farmId: string, id: string, body: ActivityParcelsWrite): Promise<Activity> {
  return withFarm(db, farmId, async (tx) => {
    const [a] = await rows<{ family: ActivityFamily; cultivation: string | null }>(
      tx,
      sql`SELECT a.family, coalesce(a.cultivation, lx.specie) AS cultivation FROM activities a
          LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference WHERE a.id = ${id}`,
    );
    if (!a) throw new NotFound("Activité introuvable");
    const nature = natureOf(a.family);
    if (!nature) throw new DomainError("Cette activité ne porte pas de parcelles (famille sans culture).");
    const wanted = [...new Set(body.parcelIds)];
    if (wanted.length) {
      const [known] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM land_parcels WHERE id = ANY(${`{${wanted.join(",")}}`}::uuid[])`);
      if (known!.n !== wanted.length) throw new NotFound("Parcelle introuvable");
    }
    // Campagne de l'année (créée au besoin, année civile).
    let [campaign] = await rows<{ id: string }>(tx, sql`SELECT id FROM campaigns WHERE year = ${body.year} LIMIT 1`);
    if (!campaign) {
      campaign = { id: crypto.randomUUID() };
      await tx.execute(sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on)
                           VALUES (${campaign.id}, ${farmId}, ${body.year}, make_date(${body.year}, 1, 1), make_date(${body.year}, 12, 31))`);
    }
    const ids = `{${wanted.join(",")}}`;
    await tx.execute(sql`DELETE FROM productions WHERE activity_id = ${id} AND campaign_id = ${campaign.id}
                         AND NOT (land_parcel_id = ANY(${ids}::uuid[]))`);
    await tx.execute(sql`
      INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, cultivation, activity_id)
      SELECT gen_random_uuid(), ${farmId}, ${campaign.id}, lp.id, ${nature}, ${a.cultivation}, ${id}
      FROM land_parcels lp
      WHERE lp.id = ANY(${ids}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM productions p WHERE p.land_parcel_id = lp.id AND p.campaign_id = ${campaign.id} AND p.activity_id = ${id})`);
    await tx.execute(sql`UPDATE activities SET deduced = false, updated_at = now() WHERE id = ${id}`);
    return (await select(tx, body.year, id))[0]!;
  });
}

/** Productions de référence Lexicon (création d'une activité). */
export async function searchReferences(db: Database, farmId: string, q: string, family: string | null): Promise<ReferenceProduction[]> {
  const pattern = `%${q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ reference_name: string; label: string; family: ActivityFamily; specie: string | null; specie_label: string | null; color: string | null; picture: string | null }>(
      tx,
      sql`SELECT lx.reference_name, lx.label, lx.family, lx.specie,
                 (SELECT t.label FROM taxonomy t WHERE t.reference_name = lx.specie) AS specie_label,
                 coalesce(fourmy_variety_color(lx.specie), lx.color) AS color,
                 fourmy_activity_picture(lx.specie, lx.family, lx.reference_name) AS picture
          FROM lexicon_productions lx
          WHERE (lx.label ILIKE ${pattern} OR lx.reference_name ILIKE ${pattern})
            ${family ? sql`AND lx.family = ${family}` : sql``}
          ORDER BY (lx.label ILIKE ${`${q.trim()}%`}) DESC, lx.label LIMIT 40`,
    );
    return list.map((r) => ({
      referenceName: r.reference_name,
      label: r.label,
      family: r.family,
      specie: r.specie,
      specieLabel: r.specie_label,
      color: r.color,
      pictureUrl: pictureUrl(r.picture),
    }));
  });
}

/** Image du référentiel (publique : données Lexicon, sans donnée de ferme). */
export async function readPicture(db: Database, domain: string, name: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const [r] = (await db.execute(
    sql`SELECT picture, extension FROM lexicon_pictures WHERE domain = ${domain} AND name = ${name}`,
  )) as unknown as { picture: Uint8Array; extension: string }[];
  if (!r) return null;
  const type = r.extension === "png" ? "image/png" : r.extension === "svg" ? "image/svg+xml" : "image/jpeg";
  return { bytes: r.picture, type };
}
