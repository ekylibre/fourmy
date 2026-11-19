import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import type { DomainCtx } from "@fourmy/domain";
import type { GeoJsonGeometry, ParcelCreateFromMap, ParcelIdentify, ParcelSheet } from "@fourmy/contracts";
import { fetchCadastralParcels, fetchCapParcels, RPG_YEARS, type CapParcel } from "@fourmy/geo-ign";
import { DomainError } from "@fourmy/domain";
import { NotFound } from "../routes/helpers.js";
import { createParcel } from "./parcels.js";
import { natureOf, pictureUrl } from "./activities.js";

/**
 * Parcelles (lot H des retours du 08/11/2026) : identification d'un point
 * de la carte (parcelle PAC, parcelles cadastrales, comme l'identificateur
 * de parcelle de Lexicon), création rattachée à une activité, références
 * PAC et cadastre gardées dans Fourmy, fiche de la parcelle.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const geo = (g: unknown) => sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326))`;

/** Code culture PAC → libellé et production de référence (campagne la plus proche). */
async function capCode(tx: Tx, code: string, year: number) {
  const [r] = await rows<{ label: string; production: string }>(
    tx,
    sql`SELECT cap_label AS label, production FROM lexicon_cap_codes WHERE cap_code = ${code}
        ORDER BY is_seed, abs(year - ${year}) LIMIT 1`,
  );
  return r ?? null;
}

/** Ce qu'il y a en un point : parcelle PAC de la campagne (ou la dernière publiée), parcelles cadastrales, parcelle de la ferme. */
export async function identifyPoint(db: Database, farmId: string, lat: number, lon: number, year: number, fetchImpl: typeof fetch = fetch): Promise<ParcelIdentify> {
  const point = { type: "Point", coordinates: [lon, lat] };
  const capYear = Math.min(Math.max(year, RPG_YEARS.first), RPG_YEARS.last);
  const [cap, cadastre] = await Promise.all([
    fetchCapParcels(point, capYear, fetchImpl).catch(() => null),
    fetchCadastralParcels(point, fetchImpl).catch(() => null),
  ]);
  return withFarm(db, farmId, async (tx) => {
    const area = async (g: unknown) => (await rows<{ a: number }>(tx, sql`SELECT ST_Area(${geo(g)}::geography) AS a`))[0]!.a;
    let capResult: ParcelIdentify["cap"] = null;
    const c = cap?.[0];
    if (c) {
      const code = await capCode(tx, c.cropCode, c.year);
      const [activity] = code
        ? await rows<{ id: string; name: string }>(tx, sql`SELECT id, name FROM activities WHERE reference = ${code.production} AND NOT suspended ORDER BY name LIMIT 1`)
        : [];
      capResult = {
        id: c.id,
        year: c.year,
        cropCode: c.cropCode,
        cropLabel: code?.label ?? null,
        production: code?.production ?? null,
        suggestedActivity: activity ?? null,
        areaM2: await area(c.geometry),
        geometry: c.geometry as GeoJsonGeometry,
      };
    }
    const cadastral = [];
    for (const p of cadastre ?? []) {
      cadastral.push({ idu: p.idu, label: `${p.section} ${p.numero.replace(/^0+/, "")} ${p.commune}`, areaM2: p.areaM2 ?? (await area(p.geometry)), geometry: p.geometry as GeoJsonGeometry });
    }
    const [existing] = await rows<{ id: string; name: string }>(
      tx,
      sql`SELECT lp.id, lp.name FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
          WHERE (upper_inf(v.valid) OR v.valid @> make_date(${year}, 6, 1)::timestamptz)
            AND ST_Intersects(v.shape, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
          -- Version de la campagne d'abord : les parcelles reprises d'Ekylibre ont une fin (une par campagne).
          ORDER BY (v.valid @> make_date(${year}, 6, 1)::timestamptz) DESC LIMIT 1`,
    );
    return { cap: capResult, cadastre: cadastral, capYear, unavailable: cap === null || cadastre === null, existing: existing ?? null };
  });
}

/** Crée la parcelle (version ouverte au début de la campagne) et sa production pour l'activité. */
export async function createParcelFromMap(db: Database, farmId: string, ctx: DomainCtx, body: ParcelCreateFromMap): Promise<{ id: string }> {
  const id = ctx.newId();
  await createParcel(db, farmId, ctx, {
    id,
    name: body.name,
    shape: body.shape,
    ...(body.capRef ? { pacIslet: body.capRef } : {}),
    validFrom: `${body.year}-01-01T00:00:00Z`,
  });
  if (body.activityId) {
    await withFarm(db, farmId, async (tx) => {
      const [a] = await rows<{ family: Parameters<typeof natureOf>[0]; cultivation: string | null }>(
        tx,
        sql`SELECT a.family, coalesce(a.cultivation, lx.specie) AS cultivation FROM activities a
            LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference WHERE a.id = ${body.activityId}`,
      );
      if (!a) throw new NotFound("Activité introuvable");
      const nature = natureOf(a.family);
      if (!nature) throw new DomainError("Cette activité ne porte pas de parcelles.");
      let [campaign] = await rows<{ id: string }>(tx, sql`SELECT id FROM campaigns WHERE year = ${body.year} LIMIT 1`);
      if (!campaign) {
        campaign = { id: ctx.newId() };
        await tx.execute(sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on)
                             VALUES (${campaign.id}, ${farmId}, ${body.year}, make_date(${body.year}, 1, 1), make_date(${body.year}, 12, 31))`);
      }
      await tx.execute(sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, cultivation, activity_id)
                           VALUES (${ctx.newId()}, ${farmId}, ${campaign.id}, ${id}, ${nature}, ${a.cultivation}, ${body.activityId})`);
    });
  }
  return { id };
}

/**
 * Références d'une parcelle, rafraîchies depuis l'API Carto : parcelles
 * cadastrales qu'elle recoupe (avec la surface commune), parcelles PAC au
 * même endroit pour chaque campagne publiée (2015 à 2024).
 */
export async function refreshReferences(db: Database, farmId: string, parcelId: string, fetchImpl: typeof fetch = fetch): Promise<{ cadastre: number; cap: number }> {
  const parcel = await withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ shape: GeoJsonGeometry; point: GeoJsonGeometry }>(
      tx,
      sql`SELECT ST_AsGeoJSON(v.shape)::json AS shape, ST_AsGeoJSON(ST_PointOnSurface(v.shape))::json AS point
          FROM land_parcel_versions v WHERE v.land_parcel_id = ${parcelId}
          ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1`,
    );
    return p ?? null;
  });
  if (!parcel) throw new NotFound("Parcelle introuvable");
  const shapeGeom = parcel.shape as { type: string; coordinates: unknown };
  const pointGeom = parcel.point as { type: string; coordinates: unknown };
  const cadastre = await fetchCadastralParcels(shapeGeom, fetchImpl);
  const years = Array.from({ length: RPG_YEARS.last - RPG_YEARS.first + 1 }, (_, i) => RPG_YEARS.first + i);
  const caps: CapParcel[] = [];
  for (let i = 0; i < years.length; i += 4) {
    const batch = await Promise.all(years.slice(i, i + 4).map((y) => fetchCapParcels(pointGeom, y, fetchImpl).catch(() => [])));
    caps.push(...batch.flat());
  }
  await withFarm(db, farmId, async (tx) => {
    // Seules les références de cette recherche (cadastre, RPG anonyme) sont remplacées : celles
    // importées d'un dossier PAC (TelePAC) restent.
    await tx.execute(sql`DELETE FROM parcel_references WHERE land_parcel_id = ${parcelId} AND coalesce(attrs->>'source', '') <> 'telepac'`);
    const shape = geo(parcel.shape);
    for (const c of cadastre) {
      await tx.execute(sql`
        INSERT INTO parcel_references (id, farm_id, land_parcel_id, kind, ref, year, label, area_m2, overlap_m2, attrs, geom)
        VALUES (${crypto.randomUUID()}, ${farmId}, ${parcelId}, 'cadastre', ${c.idu}, 0,
                ${`${c.section} ${c.numero.replace(/^0+/, "")} ${c.commune}`}, ${c.areaM2},
                ST_Area(ST_Intersection(ST_MakeValid(${geo(c.geometry)}), ST_MakeValid(${shape}))::geography),
                ${JSON.stringify({ section: c.section, numero: c.numero, commune: c.commune, inseeCode: c.inseeCode })}::jsonb, ${geo(c.geometry)})
        ON CONFLICT DO NOTHING`);
    }
    for (const c of caps) {
      const code = await capCode(tx, c.cropCode, c.year);
      await tx.execute(sql`
        INSERT INTO parcel_references (id, farm_id, land_parcel_id, kind, ref, year, label, code, area_m2, overlap_m2, attrs, geom)
        VALUES (${crypto.randomUUID()}, ${farmId}, ${parcelId}, 'cap', ${c.id}, ${c.year}, ${code?.label ?? c.cropCode}, ${c.cropCode},
                ${c.areaHa === null ? null : c.areaHa * 10_000},
                ST_Area(ST_Intersection(ST_MakeValid(${geo(c.geometry)}), ST_MakeValid(${shape}))::geography),
                ${JSON.stringify({ production: code?.production ?? null })}::jsonb, ${geo(c.geometry)})
        ON CONFLICT DO NOTHING`);
    }
  });
  return { cadastre: cadastre.length, cap: caps.length };
}

/** Fiche d'une parcelle : forme et surface, activités par campagne, références, eau, interventions. */
export async function parcelSheet(db: Database, farmId: string, parcelId: string): Promise<ParcelSheet> {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ id: string; name: string; shape: GeoJsonGeometry; area_m2: number; centroid: { coordinates: [number, number] }; pac_islet: string | null; since: string; until: string | null }>(
      tx,
      sql`SELECT lp.id, lp.name, ST_AsGeoJSON(v.shape)::json AS shape, v.area_m2::float8, ST_AsGeoJSON(ST_PointOnSurface(v.shape))::json AS centroid,
                 v.pac_islet, (SELECT min(lower(x.valid)) FROM land_parcel_versions x WHERE x.land_parcel_id = lp.id)::text AS since,
                 upper(v.valid)::text AS until
          FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
          WHERE lp.id = ${parcelId} ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1`,
    );
    if (!p) throw new NotFound("Parcelle introuvable");
    const productions = await rows<{ year: number; activity_id: string | null; name: string | null; color: string | null; picture: string | null }>(
      tx,
      sql`SELECT c.year, a.id AS activity_id, a.name,
                 coalesce(a.color, fourmy_variety_color(coalesce(a.cultivation, lx.specie)), lx.color) AS color,
                 fourmy_activity_picture(coalesce(a.cultivation, lx.specie), a.family) AS picture
          FROM productions pr JOIN campaigns c ON c.id = pr.campaign_id
          LEFT JOIN activities a ON a.id = pr.activity_id LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
          WHERE pr.land_parcel_id = ${parcelId} ORDER BY c.year DESC, a.name`,
    );
    const references = await rows<{ kind: "cadastre" | "cap" | "cap_islet"; ref: string; year: number; label: string | null; code: string | null; area_m2: number | null; overlap_m2: number | null; fetched_at: string; geometry: GeoJsonGeometry; attrs: Record<string, unknown> | null }>(
      tx,
      sql`SELECT kind, ref, year, label, code, area_m2, overlap_m2, fetched_at::text, ST_AsGeoJSON(geom)::json AS geometry, attrs
          FROM parcel_references WHERE land_parcel_id = ${parcelId} ORDER BY kind, year DESC, ref`,
    );
    const water = await rows<{ id: string; name: string | null; kind: string; permanent: boolean | null; ditch: boolean; distance_m: number; geometry: GeoJsonGeometry }>(
      tx,
      sql`SELECT w.id, w.name, w.kind, w.permanent, w.ditch, ST_Distance(w.geom::geography, v.shape::geography) AS distance_m,
                 ST_AsGeoJSON(w.geom)::json AS geometry
          FROM water_items w, (SELECT shape FROM land_parcel_versions WHERE land_parcel_id = ${parcelId} ORDER BY upper(valid) DESC NULLS FIRST LIMIT 1) v
          WHERE ST_DWithin(w.geom::geography, v.shape::geography, 250) ORDER BY distance_m LIMIT 50`,
    );
    const interventions = await rows<{ id: string; procedure: string; status: string; started_at: string | null }>(
      tx,
      sql`SELECT DISTINCT i.id, i.procedure, i.status, coalesce(i.started_at, i.stopped_at)::text AS started_at
          FROM interventions i JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
          WHERE i.status <> 'cancelled' ORDER BY 4 DESC NULLS LAST LIMIT 100`,
    );
    return {
      id: p.id,
      name: p.name,
      shape: p.shape,
      areaM2: p.area_m2,
      center: p.centroid.coordinates,
      pacIslet: p.pac_islet,
      since: p.since,
      until: p.until,
      productions: productions.map((r) => ({ year: r.year, activity: r.activity_id ? { id: r.activity_id, name: r.name!, color: r.color, pictureUrl: pictureUrl(r.picture) } : null })),
      cadastre: references.filter((r) => r.kind === "cadastre").map((r) => ({ idu: r.ref, label: r.label, areaM2: r.area_m2, overlapM2: r.overlap_m2, geometry: r.geometry })),
      cap: references
        .filter((r) => r.kind === "cap")
        .map((r) => {
          const telepac = r.attrs?.source === "telepac";
          return {
            id: r.ref,
            year: r.year,
            cropCode: r.code,
            // Dossier PAC : « Îlot 3 – parcelle 2 : Prairie temporaire » → le libellé de culture seul.
            cropLabel: telepac ? (r.label?.split(" : ")[1] ?? null) : r.label,
            areaM2: r.area_m2,
            overlapM2: r.overlap_m2,
            source: telepac ? ("telepac" as const) : ("rpg" as const),
            islet: telepac ? ((r.attrs?.isletNumber as string | undefined) ?? null) : null,
            parcelNumber: telepac ? ((r.attrs?.parcelNumber as string | undefined) ?? null) : null,
          };
        }),
      islets: references.filter((r) => r.kind === "cap_islet").map((r) => ({ ref: r.ref, number: (r.attrs?.isletNumber as string | undefined) ?? null, year: r.year, overlapM2: r.overlap_m2 })),
      referencesFetchedAt: references.find((r) => r.attrs?.source !== "telepac")?.fetched_at ?? null,
      water: water.map((w) => ({ id: w.id, name: w.name, kind: w.kind, permanent: w.permanent, ditch: w.ditch, distanceM: Math.round(w.distance_m), geometry: w.geometry })),
      interventions: interventions.map((i) => ({ id: i.id, procedure: i.procedure, status: i.status, at: i.started_at })),
    };
  });
}
