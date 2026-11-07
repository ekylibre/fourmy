import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import { planVersionChange } from "@fourmy/domain";
import type { DomainCtx } from "@fourmy/domain";
import type { GeoJsonGeometry, LandParcelVersion, LandParcelAt } from "@fourmy/contracts";

/**
 * Dépôt « parcellaire » : versionnement réel via @fourmy/domain + PostGIS,
 * sous contexte de ferme (RLS). La géométrie entre/sort en GeoJSON ; la
 * surface est calculée par PostGIS en géographie.
 */

type Row = {
  id: string;
  land_parcel_id: string;
  shape: GeoJsonGeometry;
  area_m2: string;
  pac_islet: string | null;
  viti: unknown;
  lower: string;
  upper: string | null;
};

function toVersion(r: Row): LandParcelVersion {
  return {
    id: r.id,
    landParcelId: r.land_parcel_id,
    shape: r.shape,
    areaM2: Number(r.area_m2),
    pacIslet: r.pac_islet ?? undefined,
    viti: (r.viti as LandParcelVersion["viti"]) ?? undefined,
    valid: { lower: r.lower, upper: r.upper },
  };
}

const selectVersion = (alias = "v") => sql`
  ${sql.raw(alias)}.id,
  ${sql.raw(alias)}.land_parcel_id,
  ST_AsGeoJSON(${sql.raw(alias)}.shape)::json AS shape,
  ${sql.raw(alias)}.area_m2,
  ${sql.raw(alias)}.pac_islet,
  ${sql.raw(alias)}.viti,
  lower(${sql.raw(alias)}.valid) AS lower,
  upper(${sql.raw(alias)}.valid) AS upper`;

/** Parcellaire à une date : chaque parcelle, son nom et sa version valide à `at`. */
export async function listParcelsAt(db: Database, farmId: string, at: string): Promise<LandParcelAt[]> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT p.name, ${selectVersion()}
      FROM land_parcels p
      JOIN land_parcel_versions v ON v.land_parcel_id = p.id AND v.valid @> ${at}::timestamptz
      ORDER BY p.name`)) as unknown as (Row & { name: string })[];
    return rows.map((r) => ({ id: r.land_parcel_id, name: r.name, version: toVersion(r) }));
  });
}

export interface ParcelWriteInput {
  id: string;
  name: string;
  shape: GeoJsonGeometry;
  pacIslet?: string;
  viti?: LandParcelVersion["viti"];
}

/** Crée une parcelle et sa première version (ouverte à `ctx.now`). */
export async function createParcel(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  input: ParcelWriteInput,
): Promise<LandParcelVersion> {
  return withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO land_parcels (id, farm_id, name)
      VALUES (${input.id}, ${farmId}, ${input.name})`);
    const versionId = ctx.newId();
    const geo = JSON.stringify(input.shape);
    const rows = (await tx.execute(sql`
      INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, pac_islet, viti, valid)
      VALUES (
        ${versionId}, ${input.id},
        ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326),
        ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326)::geography),
        ${input.pacIslet ?? null},
        ${input.viti ? JSON.stringify(input.viti) : null}::jsonb,
        tstzrange(${ctx.now}::timestamptz, NULL)
      )
      RETURNING id, land_parcel_id,
        ST_AsGeoJSON(shape)::json AS shape, area_m2, pac_islet, viti,
        lower(valid) AS lower, upper(valid) AS upper`)) as unknown as Row[];
    return toVersion(rows[0]!);
  });
}

/**
 * Nouvelle version d'une parcelle (PATCH) : clôt la version courante à
 * `ctx.now` et en ouvre une nouvelle, selon @fourmy/domain.
 */
export async function versionParcel(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  parcelId: string,
  input: Omit<ParcelWriteInput, "id">,
): Promise<LandParcelVersion> {
  return withFarm(db, farmId, async (tx) => {
    const current = (await tx.execute(sql`
      SELECT lower(valid) AS lower, upper(valid) AS upper
      FROM land_parcel_versions
      WHERE land_parcel_id = ${parcelId} AND upper(valid) IS NULL
      FOR UPDATE`)) as unknown as { lower: string; upper: string | null }[];

    const change = planVersionChange(
      current[0] ? { valid: { lower: current[0].lower, upper: current[0].upper } } : null,
      ctx.now,
    );
    if (change.close) {
      await tx.execute(sql`
        UPDATE land_parcel_versions
        SET valid = tstzrange(lower(valid), ${ctx.now}::timestamptz)
        WHERE land_parcel_id = ${parcelId} AND upper(valid) IS NULL`);
    }
    const geo = JSON.stringify(input.shape);
    const rows = (await tx.execute(sql`
      INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, pac_islet, viti, valid)
      VALUES (
        ${ctx.newId()}, ${parcelId},
        ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326),
        ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326)::geography),
        ${input.pacIslet ?? null},
        ${input.viti ? JSON.stringify(input.viti) : null}::jsonb,
        tstzrange(${change.openFrom}::timestamptz, NULL)
      )
      RETURNING id, land_parcel_id,
        ST_AsGeoJSON(shape)::json AS shape, area_m2, pac_islet, viti,
        lower(valid) AS lower, upper(valid) AS upper`)) as unknown as Row[];
    return toVersion(rows[0]!);
  });
}
