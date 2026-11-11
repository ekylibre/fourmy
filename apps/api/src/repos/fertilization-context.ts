import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type {
  FertilizationSettings,
  NitrateZoneStatus,
  ParcelFertilizationContext,
  ParcelNitrateZone,
  SoilAnalysis,
  SoilAnalysisWrite,
  SoilProfileWrite,
  WaterSource,
  WaterSourceWrite,
} from "@fourmy/contracts";
import { communeAt as geoCommuneAt } from "@fourmy/geo-ign";
import { isNaSoilType, nitrateZoneOfCommune, ZONING_REFERENTIAL } from "@fourmy/fertilization-refs";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Contexte de la fertilisation (lot AF, docs/fertilisation-design.md §4.3,
 * 4.4) : paramètres de la ferme, fiche sol des parcelles (type régional,
 * profondeur, point d'eau), analyses de sol, points d'eau d'irrigation et
 * zonage nitrates d'après la commune.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

// --- Paramètres --------------------------------------------------------------

export async function getSettings(db: Database, farmId: string): Promise<FertilizationSettings> {
  return withFarm(db, farmId, settingsInTx);
}

export async function settingsInTx(tx: Tx): Promise<FertilizationSettings> {
  const [r] = await rows<{ region: "nouvelle-aquitaine"; campaign_start_mmdd: string; aplsh_zone: FertilizationSettings["aplshZone"] }>(
    tx,
    sql`SELECT region, campaign_start_mmdd, aplsh_zone FROM fertilization_settings`,
  );
  return { region: r?.region ?? "nouvelle-aquitaine", campaignStartMmdd: r?.campaign_start_mmdd ?? "09-01", aplshZone: r?.aplsh_zone ?? null };
}

export async function putSettings(db: Database, farmId: string, s: FertilizationSettings): Promise<FertilizationSettings> {
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      INSERT INTO fertilization_settings (farm_id, region, campaign_start_mmdd, aplsh_zone) VALUES (${farmId}, ${s.region}, ${s.campaignStartMmdd}, ${s.aplshZone ?? null})
      ON CONFLICT (farm_id) DO UPDATE SET region = excluded.region, campaign_start_mmdd = excluded.campaign_start_mmdd, aplsh_zone = excluded.aplsh_zone, updated_at = now()`),
  );
  return getSettings(db, farmId);
}

// --- Points d'eau ------------------------------------------------------------

type WaterRow = { id: string; name: string; origin: WaterSource["origin"]; nitrate_mg_l: string | null; measured_on: string | null; method: WaterSource["method"]; parcels: number };
const water = (r: WaterRow): WaterSource => ({
  id: r.id,
  name: r.name,
  origin: r.origin,
  nitrateMgL: num(r.nitrate_mg_l),
  measuredOn: r.measured_on,
  method: r.method,
  parcels: r.parcels,
});

export async function listWaterSources(db: Database, farmId: string): Promise<WaterSource[]> {
  return withFarm(db, farmId, async (tx) =>
    (
      await rows<WaterRow>(
        tx,
        sql`SELECT w.id, w.name, w.origin, w.nitrate_mg_l, w.measured_on::text, w.method,
                   (SELECT count(*)::int FROM parcel_soils ps WHERE ps.water_source_id = w.id) AS parcels
            FROM water_sources w ORDER BY w.name`,
      )
    ).map(water),
  );
}

export async function saveWaterSource(db: Database, farmId: string, id: string | null, w: WaterSourceWrite): Promise<WaterSource> {
  if (w.nitrateMgL !== null && !w.measuredOn) throw new BadRequest("Une teneur en nitrates mesurée demande sa date.");
  const wid = id ?? crypto.randomUUID();
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(
      tx,
      id
        ? sql`UPDATE water_sources SET name = ${w.name}, origin = ${w.origin}, nitrate_mg_l = ${w.nitrateMgL}, measured_on = ${w.measuredOn}::date,
                method = ${w.method}, updated_at = now() WHERE id = ${id} RETURNING id`
        : sql`INSERT INTO water_sources (id, farm_id, name, origin, nitrate_mg_l, measured_on, method)
              VALUES (${wid}, ${farmId}, ${w.name}, ${w.origin}, ${w.nitrateMgL}, ${w.measuredOn}::date, ${w.method}) RETURNING id`,
    );
    if (!done.length) throw new NotFound("Point d'eau introuvable.");
    await tx.execute(sql`DELETE FROM regulatory_documents WHERE owner_type = 'water_source' AND owner_id = ${id}`);
  });
  const found = (await listWaterSources(db, farmId)).find((x) => x.id === wid);
  return found!;
}

export async function deleteWaterSource(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(tx, sql`DELETE FROM water_sources WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Point d'eau introuvable.");
    await tx.execute(sql`DELETE FROM regulatory_documents WHERE owner_type = 'water_source' AND owner_id = ${id}`);
  });
}

// --- Fiche sol et analyses ---------------------------------------------------------

async function assertParcel(tx: Tx, farmId: string, parcelId: string) {
  const [p] = await rows(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
  if (!p) throw new NotFound("Parcelle introuvable.");
}

export async function putSoilProfile(db: Database, farmId: string, userId: string, parcelId: string, w: SoilProfileWrite): Promise<ParcelFertilizationContext> {
  const settings = await getSettings(db, farmId);
  if (w.soilType !== null && !isNaSoilType(w.soilType)) throw new BadRequest(`Type de sol inconnu du référentiel ${settings.region} : ${w.soilType}.`);
  await withFarm(db, farmId, async (tx) => {
    await assertParcel(tx, farmId, parcelId);
    if (w.waterSourceId) {
      const [ws] = await rows(tx, sql`SELECT id FROM water_sources WHERE id = ${w.waterSourceId}`);
      if (!ws) throw new BadRequest("Point d'eau inconnu.");
    }
    await tx.execute(sql`
      INSERT INTO parcel_soils (land_parcel_id, farm_id, irrigated, soil_type, soil_type_region, rooting_depth_cm, water_source_id, updated_by)
      VALUES (${parcelId}, ${farmId}, false, ${w.soilType}, ${w.soilType ? settings.region : null}, ${w.rootingDepthCm}, ${w.waterSourceId}, ${userId})
      ON CONFLICT (land_parcel_id) DO UPDATE SET soil_type = excluded.soil_type, soil_type_region = excluded.soil_type_region,
        rooting_depth_cm = excluded.rooting_depth_cm, water_source_id = excluded.water_source_id,
        updated_by = excluded.updated_by, updated_at = now()`);
  });
  return parcelContext(db, farmId, parcelId);
}

type AnalysisRow = { id: string; land_parcel_id: string; sampled_on: string; kind: SoilAnalysis["kind"]; horizons: SoilAnalysis["horizons"]; soil_values: SoilAnalysis["values"]; lab: string | null; created_at: string | Date };
const analysis = (r: AnalysisRow): SoilAnalysis => ({
  id: r.id,
  parcelId: r.land_parcel_id,
  sampledOn: r.sampled_on,
  kind: r.kind,
  horizons: r.horizons,
  values: r.soil_values,
  lab: r.lab,
  createdAt: iso(r.created_at)!,
});

export async function addSoilAnalysis(db: Database, farmId: string, userId: string, parcelId: string, w: SoilAnalysisWrite): Promise<ParcelFertilizationContext> {
  await withFarm(db, farmId, async (tx) => {
    await assertParcel(tx, farmId, parcelId);
    await tx.execute(sql`
      INSERT INTO soil_analyses (id, farm_id, land_parcel_id, sampled_on, kind, horizons, soil_values, lab, created_by)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${parcelId}, ${w.sampledOn}::date, ${w.kind},
              ${w.horizons ? JSON.stringify(w.horizons) : null}::jsonb, ${w.values ? JSON.stringify(w.values) : null}::jsonb, ${w.lab}, ${userId})`);
  });
  return parcelContext(db, farmId, parcelId);
}

export async function deleteSoilAnalysis(db: Database, farmId: string, parcelId: string, id: string): Promise<ParcelFertilizationContext> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows(tx, sql`DELETE FROM soil_analyses WHERE id = ${id} AND land_parcel_id = ${parcelId} RETURNING id`);
    if (!done.length) throw new NotFound("Analyse introuvable.");
    await tx.execute(sql`DELETE FROM regulatory_documents WHERE owner_type = 'soil_analysis' AND owner_id = ${id}`);
  });
  return parcelContext(db, farmId, parcelId);
}

// --- Contexte des parcelles ------------------------------------------------------

type ContextRow = {
  id: string;
  name: string;
  area_m2: string;
  soil_type: string | null;
  soil_type_region: string | null;
  rooting_depth_cm: number | null;
  water_source_id: string | null;
  taw_mm: string | null;
  irrigated: boolean | null;
  z_status: NitrateZoneStatus | null;
  z_insee: string | null;
  z_commune: string | null;
  z_zones: string[] | null;
  z_referential: string | null;
  z_computed_at: string | Date | null;
  z_confirmed_at: string | Date | null;
  z_note: string | null;
};

function context(r: ContextRow, analyses: SoilAnalysis[]): ParcelFertilizationContext {
  const zone: ParcelNitrateZone | null = r.z_status
    ? {
        status: r.z_status,
        insee: r.z_insee,
        commune: r.z_commune,
        zones: r.z_zones ?? [],
        referential: r.z_referential!,
        computedAt: iso(r.z_computed_at)!,
        confirmedAt: iso(r.z_confirmed_at),
        note: r.z_note,
      }
    : null;
  return {
    parcelId: r.id,
    name: r.name,
    areaM2: Math.round(Number(r.area_m2)),
    soil: {
      soilType: r.soil_type,
      soilTypeRegion: r.soil_type_region,
      rootingDepthCm: r.rooting_depth_cm,
      waterSourceId: r.water_source_id,
      tawMm: num(r.taw_mm),
      irrigated: !!r.irrigated,
    },
    zone,
    analyses,
  };
}

/** Parcelles valides à la date (version courante par défaut), avec sol, zonage et analyses. */
async function contexts(tx: Tx, farmId: string, day: string, parcelId?: string): Promise<ParcelFertilizationContext[]> {
  const list = await rows<ContextRow>(
    tx,
    sql`SELECT lp.id, lp.name, v.area_m2, ps.soil_type, ps.soil_type_region, ps.rooting_depth_cm, ps.water_source_id, ps.taw_mm, ps.irrigated,
               z.status AS z_status, z.insee AS z_insee, z.commune AS z_commune, z.zones AS z_zones, z.referential AS z_referential,
               z.computed_at AS z_computed_at, z.confirmed_at AS z_confirmed_at, z.note AS z_note
        FROM land_parcels lp
        JOIN LATERAL (SELECT area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = lp.id
                      ORDER BY (v.valid @> ${day}::date::timestamptz + interval '12 hours') DESC, upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
        LEFT JOIN parcel_soils ps ON ps.land_parcel_id = lp.id
        LEFT JOIN parcel_nitrate_zones z ON z.land_parcel_id = lp.id
        WHERE lp.farm_id = ${farmId}
          ${parcelId ? sql`AND lp.id = ${parcelId}` : sql`AND EXISTS (SELECT 1 FROM land_parcel_versions v2 WHERE v2.land_parcel_id = lp.id AND v2.valid @> ${day}::date::timestamptz + interval '12 hours')`}
        ORDER BY lp.name`,
  );
  if (!list.length) return [];
  const analyses = await rows<AnalysisRow>(
    tx,
    sql`SELECT id, land_parcel_id, sampled_on::text, kind, horizons, soil_values, lab, created_at FROM soil_analyses
        WHERE land_parcel_id IN (SELECT unnest(${`{${list.map((r) => r.id).join(",")}}`}::uuid[])) ORDER BY sampled_on DESC`,
  );
  return list.map((r) => context(r, analyses.filter((a) => a.land_parcel_id === r.id).map(analysis)));
}

export async function parcelContext(db: Database, farmId: string, parcelId: string): Promise<ParcelFertilizationContext> {
  const [c] = await withFarm(db, farmId, (tx) => contexts(tx, farmId, new Date().toISOString().slice(0, 10), parcelId));
  if (!c) throw new NotFound("Parcelle introuvable.");
  return c;
}

export async function listParcelContexts(db: Database, farmId: string, day: string): Promise<ParcelFertilizationContext[]> {
  return withFarm(db, farmId, (tx) => contexts(tx, farmId, day));
}

// --- Zonage nitrates ----------------------------------------------------------------

/** Commune d'un point (API Géo de l'État). Remplaçable dans les tests. */
let communeAt = (lon: number, lat: number): Promise<{ insee: string; name: string } | null> => geoCommuneAt(lon, lat);
export const setCommuneLookup = (f: typeof communeAt) => {
  communeAt = f;
};

/**
 * Zonage des parcelles valides aujourd'hui, d'après la commune de leur point
 * intérieur. Une parcelle dont le zonage a été confirmé à la main n'est pas
 * recalculée. Renvoie le nombre de parcelles traitées et les échecs.
 */
export async function refreshNitrateZones(db: Database, farmId: string): Promise<{ updated: number; failed: string[] }> {
  const day = new Date().toISOString().slice(0, 10);
  const parcels = await withFarm(db, farmId, (tx) =>
    rows<{ id: string; name: string; lon: number; lat: number; confirmed: boolean }>(
      tx,
      sql`SELECT lp.id, lp.name, ST_X(ST_PointOnSurface(v.shape)) AS lon, ST_Y(ST_PointOnSurface(v.shape)) AS lat,
                 coalesce(z.confirmed_at IS NOT NULL, false) AS confirmed
          FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
          LEFT JOIN parcel_nitrate_zones z ON z.land_parcel_id = lp.id
          WHERE lp.farm_id = ${farmId} AND v.valid @> ${day}::date::timestamptz + interval '12 hours' AND NOT ST_IsEmpty(v.shape)`,
    ),
  );
  // Une seule requête par commune déjà vue (parcelles voisines).
  const cache = new Map<string, { insee: string; name: string } | null>();
  let updated = 0;
  const failed: string[] = [];
  for (const p of parcels.filter((x) => !x.confirmed)) {
    const key = `${p.lon.toFixed(3)},${p.lat.toFixed(3)}`;
    let commune = cache.get(key);
    if (commune === undefined) {
      commune = await communeAt(p.lon, p.lat).catch(() => null);
      cache.set(key, commune);
    }
    if (!commune) {
      failed.push(p.name);
      continue;
    }
    const z = nitrateZoneOfCommune(commune.insee);
    await withFarm(db, farmId, (tx) =>
      tx.execute(sql`
        INSERT INTO parcel_nitrate_zones (land_parcel_id, farm_id, insee, commune, status, zones, referential, note)
        VALUES (${p.id}, ${farmId}, ${commune.insee}, ${commune.name}, ${z.status}, ${`{${z.zones.join(",")}}`}::text[], ${ZONING_REFERENTIAL}, ${z.note})
        ON CONFLICT (land_parcel_id) DO UPDATE SET insee = excluded.insee, commune = excluded.commune, status = excluded.status,
          zones = excluded.zones, referential = excluded.referential, note = excluded.note, computed_at = now()`),
    );
    updated++;
  }
  return { updated, failed };
}

/** Zonage confirmé ou corrigé par le responsable (commune en partie en zone vulnérable, erreur de cadastre…). */
export async function confirmNitrateZone(db: Database, farmId: string, userId: string, parcelId: string, w: { status: NitrateZoneStatus; note: string | null }): Promise<ParcelFertilizationContext> {
  await withFarm(db, farmId, async (tx) => {
    await assertParcel(tx, farmId, parcelId);
    await tx.execute(sql`
      INSERT INTO parcel_nitrate_zones (land_parcel_id, farm_id, status, referential, confirmed_by, confirmed_at, note)
      VALUES (${parcelId}, ${farmId}, ${w.status}, ${ZONING_REFERENTIAL}, ${userId}, now(), ${w.note})
      ON CONFLICT (land_parcel_id) DO UPDATE SET status = excluded.status, confirmed_by = excluded.confirmed_by,
        confirmed_at = now(), note = excluded.note`);
  });
  return parcelContext(db, farmId, parcelId);
}
