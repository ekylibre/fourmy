import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  MODULATION_MIN_VALID_RATIO,
  PRESCRIPTION_UNIT_LABELS,
  type ModulationDate,
  type ModulationZone,
  type Prescription,
  type PrescriptionFormat,
  type PrescriptionSend,
  type PrescriptionSummary,
  type PrescriptionWrite,
  type VegetationIndex,
  type ZoneGeometry,
  type Zoning,
  type ZoningRequest,
} from "@fourmy/contracts";
import { classifyZones, conserveMean, isUsable, modulationRates, prescriptionTotal, utmEpsg } from "@fourmy/domain";
import { INDEX_RASTER_METHOD, type Bbox, type PolygonGeometry } from "@fourmy/sentinel";
import { shapefile, taskData, zip } from "@fourmy/isoxml";
import { agrirouterClient, agrirouterRecipients, connectedAgrirouter, MESSAGE_TYPE_OF } from "../integrations/agrirouter.js";
import { copernicusClient } from "../integrations/providers.js";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { decryptSecret } from "../secrets.js";

/**
 * Cartes de modulation (lot AD, FR-TWIN-6, docs/modulation.md) : zonage
 * d'une parcelle d'après un raster Sentinel-2 à 10 m (Copernicus de la ferme,
 * mis en cache), doses par zone, exports ISO-XML et Shapefile, envoi aux
 * machines par agrirouter.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
const RESOLUTION = 10;
/** Mailles de la grille ISO-XML au plus (une console en accepte rarement davantage). */
const MAX_GRID_CELLS = 250_000;

// --- Raster et zonage -------------------------------------------------------

interface ParcelAt {
  version_id: string;
  name: string;
  area_m2: number;
  lon: number;
  lat: number;
}

/** Version de la parcelle valide à la date (sinon la plus récente). */
async function parcelAt(tx: Tx, farmId: string, parcelId: string, day: string): Promise<ParcelAt> {
  const [p] = await rows<ParcelAt>(
    tx,
    sql`SELECT v.id AS version_id, lp.name, ST_Area(v.shape::geography) AS area_m2,
               ST_X(ST_Centroid(v.shape)) AS lon, ST_Y(ST_Centroid(v.shape)) AS lat
        FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
        WHERE lp.id = ${parcelId} AND lp.farm_id = ${farmId} AND NOT ST_IsEmpty(v.shape)
        ORDER BY (v.valid @> ${day}::date::timestamptz + interval '12 hours') DESC, upper(v.valid) DESC NULLS FIRST
        LIMIT 1`,
  );
  if (!p) throw new NotFound("Parcelle introuvable.");
  return p;
}

interface RasterRow {
  epsg: number;
  x_min: number;
  y_max: number;
  resolution: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

const toByte = (v: number | null) => (v === null ? 0 : Math.max(1, Math.min(255, 1 + Math.round((v + 1) * 127))));
const fromByte = (b: number) => (b === 0 ? null : (b - 1) / 127 - 1);

/**
 * Raster de l'indice de la parcelle à la date : en cache, sinon demandé à
 * Copernicus avec l'intégration de la ferme (budget mensuel compté).
 */
async function parcelRaster(db: Database, farmId: string, parcel: ParcelAt, date: string, index: VegetationIndex): Promise<RasterRow> {
  const [cached] = await withFarm(db, farmId, (tx) =>
    rows<RasterRow>(
      tx,
      sql`SELECT epsg, x_min, y_max, resolution, width, height, pixels FROM parcel_index_rasters
          WHERE land_parcel_version_id = ${parcel.version_id} AND acquired_on = ${date}::date
            AND vegetation_index = ${index} AND method = ${INDEX_RASTER_METHOD}`,
    ),
  );
  if (cached) return { ...cached, pixels: new Uint8Array(cached.pixels) };

  const epsg = utmEpsg(parcel.lon, parcel.lat);
  const { integ, frame } = await withFarm(db, farmId, async (tx) => {
    const [integ] = await rows<{ settings: Record<string, string>; secret_ciphertext: string | null; enabled: boolean }>(
      tx,
      sql`SELECT settings, secret_ciphertext, enabled FROM integrations WHERE provider = 'copernicus'`,
    );
    const [frame] = await rows<{ geom: PolygonGeometry; xmin: number; ymin: number; xmax: number; ymax: number }>(
      tx,
      sql`WITH g AS (SELECT ST_Transform(shape, ${epsg}::int) AS g FROM land_parcel_versions WHERE id = ${parcel.version_id})
          SELECT ST_AsGeoJSON(g, 2)::json AS geom, ST_XMin(g) AS xmin, ST_YMin(g) AS ymin, ST_XMax(g) AS xmax, ST_YMax(g) AS ymax FROM g`,
    );
    return { integ, frame };
  });
  if (!integ?.secret_ciphertext || !integ.enabled) throw new BadRequest("Intégration Copernicus non configurée : elle fournit les images du zonage.");
  if (!frame) throw new NotFound("Parcelle introuvable.");
  const bbox: Bbox = [
    Math.floor(frame.xmin / RESOLUTION) * RESOLUTION,
    Math.floor(frame.ymin / RESOLUTION) * RESOLUTION,
    Math.ceil(frame.xmax / RESOLUTION) * RESOLUTION,
    Math.ceil(frame.ymax / RESOLUTION) * RESOLUTION,
  ];
  const client = copernicusClient(farmId, integ.settings, decryptSecret(integ.secret_ciphertext));
  const raster = await client.indexRaster({ epsg, geometry: frame.geom }, bbox, date, index, RESOLUTION);
  const row: RasterRow = {
    epsg,
    x_min: bbox[0],
    y_max: bbox[3],
    resolution: RESOLUTION,
    width: raster.width,
    height: raster.height,
    pixels: Uint8Array.from(raster.values, toByte),
  };
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      INSERT INTO parcel_index_rasters (farm_id, land_parcel_version_id, acquired_on, vegetation_index, method, epsg, x_min, y_max, resolution, width, height, pixels)
      VALUES (${farmId}, ${parcel.version_id}, ${date}::date, ${index}, ${INDEX_RASTER_METHOD}, ${epsg}, ${row.x_min}, ${row.y_max}, ${RESOLUTION}, ${row.width}, ${row.height}, ${Buffer.from(row.pixels)})
      ON CONFLICT (land_parcel_version_id, acquired_on, vegetation_index) DO UPDATE SET
        method = excluded.method, epsg = excluded.epsg, x_min = excluded.x_min, y_max = excluded.y_max,
        resolution = excluded.resolution, width = excluded.width, height = excluded.height, pixels = excluded.pixels, fetched_at = now()`),
  );
  return row;
}

/** Bandes horizontales de pixels de même zone (une ligne à la fois) : moins de rectangles à unir. */
function runs(zones: Uint8Array, width: number, height: number): { x0: number[]; x1: number[]; y: number[]; z: number[] } {
  const out = { x0: [] as number[], x1: [] as number[], y: [] as number[], z: [] as number[] };
  for (let y = 0; y < height; y++) {
    let start = 0;
    for (let x = 1; x <= width; x++) {
      const prev = zones[y * width + x - 1]!;
      if (x === width || zones[y * width + x] !== prev) {
        if (prev) {
          out.x0.push(start);
          out.x1.push(x);
          out.y.push(y);
          out.z.push(prev);
        }
        start = x;
      }
    }
  }
  return out;
}

/** Zonage d'une parcelle : classes d'indice, contours découpés par la parcelle. */
export async function zoning(db: Database, farmId: string, req: ZoningRequest): Promise<Zoning> {
  const parcel = await withFarm(db, farmId, (tx) => parcelAt(tx, farmId, req.parcelId, req.date));
  const r = await parcelRaster(db, farmId, parcel, req.date, req.index);
  const values = Array.from(r.pixels, fromByte);
  const grid = classifyZones(values, r.width, r.height, req.zoneCount);
  const parcelPixels = parcel.area_m2 / (r.resolution * r.resolution);
  const validRatio = Math.min(1, grid.validPixels / Math.max(1, parcelPixels));
  if (grid.validPixels === 0 || validRatio < MODULATION_MIN_VALID_RATIO) {
    throw new BadRequest(`Image du ${req.date} inutilisable : ${Math.round(validRatio * 100)} % de la parcelle sans nuage (${Math.round(MODULATION_MIN_VALID_RATIO * 100)} % au moins).`);
  }
  const strips = runs(grid.zones, r.width, r.height);
  const shapes = await withFarm(db, farmId, (tx) =>
    rows<{ code: number; geom: ZoneGeometry | null; area_m2: number }>(
      tx,
      sql`
        WITH s AS (
          SELECT * FROM unnest(${`{${strips.x0.join(",")}}`}::int[], ${`{${strips.x1.join(",")}}`}::int[],
                               ${`{${strips.y.join(",")}}`}::int[], ${`{${strips.z.join(",")}}`}::int[]) AS t(x0, x1, y, z)),
        p AS (SELECT ST_Transform(shape, ${r.epsg}::int) AS g FROM land_parcel_versions WHERE id = ${parcel.version_id}),
        z AS (
          SELECT s.z AS code,
                 ST_CollectionExtract(ST_Intersection(
                   ST_Union(ST_MakeEnvelope(${r.x_min} + s.x0 * ${r.resolution}, ${r.y_max} - (s.y + 1) * ${r.resolution},
                                            ${r.x_min} + s.x1 * ${r.resolution}, ${r.y_max} - s.y * ${r.resolution}, ${r.epsg}::int)),
                   (SELECT g FROM p)), 3) AS g
          FROM s GROUP BY s.z)
        SELECT code, CASE WHEN ST_IsEmpty(g) THEN NULL ELSE ST_AsGeoJSON(ST_Multi(ST_Transform(g, 4326)), 7)::json END AS geom, ST_Area(g) AS area_m2
        FROM z ORDER BY code`,
    ),
  );
  const zones: ModulationZone[] = [];
  for (const s of grid.stats) {
    const shape = shapes.find((x) => x.code === s.code);
    if (!shape?.geom || shape.area_m2 < 1) continue;
    zones.push({ code: s.code, meanIndex: round3(s.mean), minIndex: round3(s.min), maxIndex: round3(s.max), areaM2: Math.round(shape.area_m2), geometry: shape.geom });
  }
  return {
    parcelId: req.parcelId,
    parcelName: parcel.name,
    parcelAreaM2: Math.round(parcel.area_m2),
    date: req.date,
    index: req.index,
    zoneCount: req.zoneCount,
    validRatio: Math.round(validRatio * 100) / 100,
    zones,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Dates proposées : acquisitions de la parcelle assez dégagées, des 3 dernières années, les plus récentes d'abord. */
export async function modulationDates(db: Database, farmId: string, parcelId: string, index: VegetationIndex): Promise<ModulationDate[]> {
  return withFarm(db, farmId, async (tx) => {
    const [parcel] = await rows<{ id: string }>(tx, sql`SELECT id FROM land_parcels WHERE id = ${parcelId} AND farm_id = ${farmId}`);
    if (!parcel) throw new NotFound("Parcelle introuvable.");
    const all = await rows<{ d: string; mean: number; valid_px: number; parcel_px: number }>(
      tx,
      sql`SELECT pi.acquired_on::text AS d, pi.mean, pi.valid_px, pi.parcel_px
          FROM parcel_indices pi JOIN land_parcel_versions v ON v.id = pi.land_parcel_version_id
          WHERE v.land_parcel_id = ${parcelId} AND pi.vegetation_index = ${index} AND pi.mean IS NOT NULL
            AND pi.acquired_on >= (now() - interval '3 years')::date
          ORDER BY pi.acquired_on DESC`,
    );
    return all
      .filter((r) => isUsable(r.valid_px, r.parcel_px) && r.valid_px >= MODULATION_MIN_VALID_RATIO * r.parcel_px)
      .slice(0, 80)
      .map((r) => ({ date: r.d, mean: round3(r.mean), validRatio: Math.min(1, Math.round((r.valid_px / Math.max(1, r.parcel_px)) * 100) / 100) }));
  });
}

// --- Cartes enregistrées ------------------------------------------------------

interface PrescriptionRow {
  id: string;
  name: string;
  land_parcel_id: string;
  parcel_name: string;
  parcel_area_m2: number;
  acquired_on: string;
  vegetation_index: VegetationIndex;
  zone_count: number;
  product: string;
  unit: Prescription["unit"];
  strategy: Prescription["strategy"];
  base_rate: number;
  modulation_pct: number;
  min_rate: number;
  max_rate: number;
  width_m: number;
  created_at: string | Date;
  total: number;
  last_sent_at: string | Date | null;
  fertilization_plan_id: string | null;
  plan_stage: string | null;
  target_rate: number | null;
}

const iso = (v: string | Date) => new Date(v).toISOString();

function summary(r: PrescriptionRow): PrescriptionSummary {
  return {
    id: r.id,
    name: r.name,
    parcelId: r.land_parcel_id,
    parcelName: r.parcel_name,
    parcelAreaM2: Math.round(r.parcel_area_m2),
    date: r.acquired_on,
    index: r.vegetation_index,
    zoneCount: r.zone_count,
    product: r.product,
    unit: r.unit,
    strategy: r.strategy,
    baseRate: r.base_rate,
    modulationPct: r.modulation_pct,
    minRate: r.min_rate,
    maxRate: r.max_rate,
    widthM: r.width_m,
    totalQuantity: Math.round(r.total * 10) / 10,
    plan: r.fertilization_plan_id && r.target_rate ? { planId: r.fertilization_plan_id, stage: r.plan_stage, targetRate: r.target_rate } : null,
    createdAt: iso(r.created_at),
    lastSentAt: r.last_sent_at ? iso(r.last_sent_at) : null,
  };
}

const SELECT = sql`
  SELECT p.id, p.name, p.land_parcel_id, lp.name AS parcel_name,
         (SELECT coalesce(sum(z.area_m2), 0) FROM prescription_zones z WHERE z.prescription_id = p.id) AS parcel_area_m2,
         p.acquired_on::text, p.vegetation_index, p.zone_count, p.product, p.unit, p.strategy, p.base_rate, p.modulation_pct,
         p.min_rate, p.max_rate, p.width_m, p.created_at, p.fertilization_plan_id, p.plan_stage, p.target_rate,
         (SELECT coalesce(sum(z.rate * z.area_m2 / 10000), 0) FROM prescription_zones z WHERE z.prescription_id = p.id) AS total,
         (SELECT max(s.sent_at) FROM prescription_sends s WHERE s.prescription_id = p.id AND s.status = 'sent') AS last_sent_at
  FROM prescriptions p JOIN land_parcels lp ON lp.id = p.land_parcel_id`;

export async function listPrescriptions(db: Database, farmId: string, parcelId?: string): Promise<PrescriptionSummary[]> {
  return withFarm(db, farmId, async (tx) =>
    (await rows<PrescriptionRow>(tx, sql`${SELECT} ${parcelId ? sql`WHERE p.land_parcel_id = ${parcelId}` : sql``} ORDER BY p.created_at DESC`)).map(summary),
  );
}

export async function getPrescription(db: Database, farmId: string, id: string): Promise<Prescription> {
  return withFarm(db, farmId, async (tx) => {
    const [row] = await rows<PrescriptionRow>(tx, sql`${SELECT} WHERE p.id = ${id}`);
    if (!row) throw new NotFound("Carte de modulation introuvable.");
    const zones = await rows<{ code: number; mean_index: number; min_index: number; max_index: number; area_m2: number; rate: number; geom: ZoneGeometry }>(
      tx,
      sql`SELECT code, mean_index, min_index, max_index, area_m2, rate, ST_AsGeoJSON(shape, 7)::json AS geom
          FROM prescription_zones WHERE prescription_id = ${id} ORDER BY code`,
    );
    const sends = await rows<{ id: string; format: PrescriptionFormat; channel: "agrirouter"; recipients: { id: string; name: string }[]; sent_at: string | Date; sent_by: string | null; status: "sent" | "error"; error: string | null }>(
      tx,
      sql`SELECT s.id, s.format, s.channel, s.recipients, s.sent_at, coalesce(u.name, u.email) AS sent_by, s.status, s.error
          FROM prescription_sends s LEFT JOIN users u ON u.id = s.sent_by
          WHERE s.prescription_id = ${id} ORDER BY s.sent_at DESC`,
    );
    const { lastSentAt: _last, ...base } = summary(row);
    return {
      ...base,
      zones: zones.map((z) => ({ code: z.code, meanIndex: z.mean_index, minIndex: z.min_index, maxIndex: z.max_index, areaM2: Math.round(z.area_m2), rate: z.rate, geometry: z.geom })),
      sends: sends.map((s): PrescriptionSend => ({ id: s.id, format: s.format, channel: s.channel, recipients: s.recipients, sentAt: iso(s.sent_at), sentBy: s.sent_by, status: s.status, error: s.error })),
    };
  });
}

function checkRates(w: { minRate: number; maxRate: number }) {
  if (w.maxRate < w.minRate) throw new BadRequest("Dose maximale inférieure à la dose minimale.");
}

/**
 * Doses d'une carte : saisies (une par code de zone, de 1 à n), sinon
 * calculées par la stratégie ; partie d'un apport du plan, leur moyenne
 * pondérée par la surface des zones est ramenée à la dose de l'apport.
 */
function ratesFor(w: PrescriptionWrite, zones: { code: number; areaM2: number }[]): number[] {
  if (w.rates) {
    if (w.rates.length !== w.zoneCount) throw new BadRequest(`Une dose par zone attendue (${w.zoneCount}).`);
    return w.rates;
  }
  const rates = modulationRates(w);
  if (!w.planLink) return rates;
  const areas = rates.map((_, k) => zones.find((z) => z.code === k + 1)?.areaM2 ?? 0);
  return conserveMean(rates, areas, w.planLink.targetRate, w).rates;
}

export async function createPrescription(db: Database, farmId: string, userId: string, w: PrescriptionWrite): Promise<Prescription> {
  checkRates(w);
  const z = await zoning(db, farmId, w);
  const rates = ratesFor(w, z.zones);
  if (w.planLink) {
    const [plan] = await withFarm(db, farmId, (tx) => rows(tx, sql`SELECT id FROM fertilization_plans WHERE id = ${w.planLink!.planId} AND land_parcel_id = ${w.parcelId}`));
    if (!plan) throw new BadRequest("Plan de fumure introuvable pour cette parcelle.");
  }
  const id = crypto.randomUUID();
  await withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO prescriptions (id, farm_id, land_parcel_id, name, acquired_on, vegetation_index, zone_count, product, unit, strategy,
                                 base_rate, modulation_pct, min_rate, max_rate, width_m, created_by, fertilization_plan_id, plan_stage, target_rate)
      VALUES (${id}, ${farmId}, ${w.parcelId}, ${w.name}, ${w.date}::date, ${w.index}, ${w.zoneCount}, ${w.product}, ${w.unit}, ${w.strategy},
              ${w.baseRate}, ${w.modulationPct}, ${w.minRate}, ${w.maxRate}, ${w.widthM}, ${userId},
              ${w.planLink?.planId ?? null}, ${w.planLink?.stage ?? null}, ${w.planLink?.targetRate ?? null})`);
    for (const zone of z.zones) {
      await tx.execute(sql`
        INSERT INTO prescription_zones (prescription_id, farm_id, code, mean_index, min_index, max_index, area_m2, rate, shape)
        VALUES (${id}, ${farmId}, ${zone.code}, ${zone.meanIndex}, ${zone.minIndex}, ${zone.maxIndex}, ${zone.areaM2}, ${rates[zone.code - 1]!},
                ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(zone.geometry)}), 4326)))`);
    }
  });
  return getPrescription(db, farmId, id);
}

/** Doses corrigées zone par zone (de la zone 1 à n). */
export async function updatePrescriptionRates(db: Database, farmId: string, id: string, rates: number[]): Promise<Prescription> {
  await withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ zone_count: number; max_rate: number; min_rate: number }>(tx, sql`SELECT zone_count, min_rate, max_rate FROM prescriptions WHERE id = ${id}`);
    if (!p) throw new NotFound("Carte de modulation introuvable.");
    if (rates.length !== p.zone_count) throw new BadRequest(`Une dose par zone attendue (${p.zone_count}).`);
    for (const [k, rate] of rates.entries()) {
      await tx.execute(sql`UPDATE prescription_zones SET rate = ${rate} WHERE prescription_id = ${id} AND code = ${k + 1}`);
    }
    await tx.execute(sql`UPDATE prescriptions SET updated_at = now() WHERE id = ${id}`);
  });
  return getPrescription(db, farmId, id);
}

export async function deletePrescription(db: Database, farmId: string, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const removed = await rows(tx, sql`DELETE FROM prescriptions WHERE id = ${id} RETURNING id`);
    if (!removed.length) throw new NotFound("Carte de modulation introuvable.");
  });
}

// --- Fichiers ---------------------------------------------------------------

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60) || "carte";

const INDEX_LABELS: Record<VegetationIndex, string> = { ndvi: "NDVI", ndre: "NDRE", ndmi: "NDMI" };
const fr = (v: number, digits = 2) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Archive zip d'une carte : TaskData ISO-XML ou Shapefile. */
export async function prescriptionFile(db: Database, farmId: string, id: string, format: PrescriptionFormat): Promise<{ filename: string; bytes: Uint8Array }> {
  const p = await getPrescription(db, farmId, id);
  const base = slug(`${p.parcelName}-${p.name}`);
  if (format === "shape") {
    const files = shapefile(
      base,
      [
        { name: "ZONE", type: "N", length: 3 },
        { name: "DOSE", type: "N", length: 12, decimals: 1 },
        { name: "UNITE", type: "C", length: 10 },
        { name: "PRODUIT", type: "C", length: 60 },
        { name: "INDICE", type: "N", length: 7, decimals: 3 },
        { name: "SURF_HA", type: "N", length: 10, decimals: 4 },
      ],
      p.zones.map((z) => ({
        geometry: z.geometry.coordinates,
        attributes: { ZONE: z.code, DOSE: z.rate, UNITE: PRESCRIPTION_UNIT_LABELS[p.unit], PRODUIT: p.product, INDICE: z.meanIndex, SURF_HA: z.areaM2 / 10_000 },
      })),
    );
    return { filename: `${base}-shapefile.zip`, bytes: zip(files) };
  }

  const width = p.widthM;
  const { farm, boundary, cells } = await withFarm(db, farmId, async (tx) => {
    const [farm] = await rows<{ name: string }>(tx, sql`SELECT name FROM farms WHERE id = ${farmId}`);
    const [frame] = await rows<{ w: number; s: number; e: number; n: number }>(
      tx,
      sql`SELECT ST_XMin(e) AS w, ST_YMin(e) AS s, ST_XMax(e) AS e, ST_YMax(e) AS n
          FROM (SELECT ST_Extent(shape) AS e FROM prescription_zones WHERE prescription_id = ${id}) x`,
    );
    const [b] = await rows<{ geom: ZoneGeometry }>(
      tx,
      sql`SELECT ST_AsGeoJSON(ST_Multi(ST_Union(shape)), 9)::json AS geom FROM prescription_zones WHERE prescription_id = ${id}`,
    );
    if (!frame || !b) throw new NotFound("Carte de modulation sans zone.");
    const lat = ((frame.s + frame.n) / 2) * (Math.PI / 180);
    const cellLat = width / 110_574;
    const cellLon = width / (111_320 * Math.cos(lat));
    const columns = Math.max(1, Math.ceil((frame.e - frame.w) / cellLon));
    const rowsCount = Math.max(1, Math.ceil((frame.n - frame.s) / cellLat));
    if (columns * rowsCount > MAX_GRID_CELLS) {
      throw new BadRequest(`Grille trop fine (${columns * rowsCount} mailles) : augmentez la largeur de travail.`);
    }
    // Zone de chaque maille d'après son centre ; lignes du sud au nord, colonnes d'ouest en est.
    const coded = await rows<{ i: number; code: number }>(
      tx,
      sql`WITH g AS (
            SELECT r * ${columns} + c AS i,
                   ST_SetSRID(ST_MakePoint(${frame.w} + (c + 0.5) * ${cellLon}, ${frame.s} + (r + 0.5) * ${cellLat}), 4326) AS pt
            FROM generate_series(0, ${rowsCount - 1}) r, generate_series(0, ${columns - 1}) c)
          SELECT g.i, z.code FROM g JOIN prescription_zones z ON z.prescription_id = ${id} AND ST_Intersects(z.shape, g.pt)`,
    );
    const cells = new Uint8Array(columns * rowsCount);
    for (const c of coded) cells[c.i] = c.code;
    return { farm, boundary: b.geom, cells: { minLat: frame.s, minLon: frame.w, cellLat, cellLon, columns, rows: rowsCount, cells } };
  });
  const area = p.zones.reduce((s, z) => s + z.areaM2, 0);
  const files = taskData({
    software: { manufacturer: "Fourmy", version: process.env.FOURMY_VERSION ?? "dev" },
    customer: farm?.name ?? "Ferme",
    farm: farm?.name ?? "Ferme",
    partfield: { name: p.parcelName, areaM2: area, boundary: boundary.coordinates },
    task: p.name,
    product: p.product,
    unit: p.unit,
    zones: p.zones.map((z) => ({ code: z.code, name: `Zone ${z.code} ${INDEX_LABELS[p.index]} ${fr(z.meanIndex)}`, rate: z.rate })),
    defaultRate: area > 0 ? prescriptionTotal(p.zones) / (area / 10_000) : p.baseRate,
    grid: cells,
  });
  return { filename: `${base}-isoxml.zip`, bytes: zip(files) };
}

// --- Envoi aux machines -----------------------------------------------------------

/**
 * Envoie la carte par agrirouter aux destinataires choisis (parmi ceux que
 * la route permet). L'envoi est tracé, réussi ou non ; « envoyé » veut dire
 * accepté par agrirouter, pas reçu par la console.
 */
export async function sendPrescription(
  db: Database,
  farmId: string,
  userId: string,
  id: string,
  req: { format: PrescriptionFormat; recipients: string[] },
): Promise<PrescriptionSend> {
  const { tenantId, settings } = await withFarm(db, farmId, connectedAgrirouter);
  const { recipients } = await agrirouterRecipients(tenantId, settings.endpointId);
  const chosen = req.recipients.map((r) => recipients.find((x) => x.id === r));
  if (chosen.some((r) => !r)) throw new BadRequest("Destinataire inconnu ou sans route depuis Fourmy dans agrirouter.");
  const refused = chosen.filter((r) => !r!.formats.includes(req.format));
  if (refused.length) throw new BadRequest(`${refused.map((r) => r!.name).join(", ")} : ce format ne peut pas lui être envoyé (route agrirouter).`);
  const file = await prescriptionFile(db, farmId, id, req.format);

  let error: string | null = null;
  try {
    await agrirouterClient().sendFile(tenantId, {
      senderEndpointId: settings.endpointId,
      messageType: MESSAGE_TYPE_OF[req.format],
      recipients: req.recipients,
      filename: file.filename,
      payload: file.bytes,
    });
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  }
  const send: PrescriptionSend = {
    id: crypto.randomUUID(),
    format: req.format,
    channel: "agrirouter",
    recipients: chosen.map((r) => ({ id: r!.id, name: r!.name })),
    sentAt: new Date().toISOString(),
    sentBy: null,
    status: error ? "error" : "sent",
    error,
  };
  await withFarm(db, farmId, (tx) =>
    tx.execute(sql`
      INSERT INTO prescription_sends (id, prescription_id, farm_id, channel, format, recipients, status, error, sent_by, sent_at)
      VALUES (${send.id}, ${id}, ${farmId}, 'agrirouter', ${send.format}, ${JSON.stringify(send.recipients)}::jsonb, ${send.status}, ${error}, ${userId}, ${send.sentAt})`),
  );
  if (error) throw new BadRequest(`Envoi refusé : ${error}`);
  return send;
}

export const prescriptionUnits = PRESCRIPTION_UNIT_LABELS;
