import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { checkReading, readingCheckMessage, usageSeries, type DomainCtx } from "@fourmy/domain";
import type {
  EquipmentHistoryEntry,
  EquipmentOption,
  EquipmentOptionWrite,
  EquipmentSheet,
  EquipmentSummary,
  EquipmentWrite,
  FarmBrand,
  FarmBrandWrite,
  MeterReading,
  MeterReadingResult,
  MeterReadingWrite,
} from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Matériels, lot I (docs/materiels-entretien-design.md) : fiche, compteur,
 * relevés (contrôle de cohérence du domaine), marques de la ferme et logos.
 */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function audit(tx: Tx, farmId: string, ctx: DomainCtx, entity: string, entityId: string, action: string, diff: object) {
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
    VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, ${entity}, ${entityId}, ${action}, ${JSON.stringify(diff)}::jsonb)`);
}

// ---------------------------------------------------------------------------
// Liste et fiche
// ---------------------------------------------------------------------------

const SUMMARY = sql`
  SELECT e.id, e.name, e.kind, e.state, e.brand, e.brand_id AS "brandId", e.model,
         e.serial_number AS "serialNumber", e.year, e.meter_unit AS "meterUnit",
         coalesce(e.logo_asset_id, b.logo_asset_id) AS "logoAssetId",
         CASE WHEN e.logo_asset_id IS NOT NULL THEN 'equipment' WHEN b.logo_asset_id IS NOT NULL THEN 'brand' END AS "logoSource",
         (SELECT json_build_object('readAt', r.read_at, 'value', r.value, 'origin', r.origin)
            FROM meter_readings r WHERE r.equipment_id = e.id ORDER BY r.read_at DESC LIMIT 1) AS "lastReading",
         EXISTS (SELECT 1 FROM tracker_bindings t WHERE t.equipment_id = e.id AND t.valid @> now()) AS tracked
  FROM equipments e LEFT JOIN farm_brands b ON b.id = e.brand_id`;

type SummaryRow = Omit<EquipmentSummary, "lastReading"> & { lastReading: { readAt: string; value: unknown; origin: string } | null };
const toSummary = (r: SummaryRow): EquipmentSummary => ({
  ...r,
  year: num(r.year),
  lastReading: r.lastReading ? { readAt: iso(r.lastReading.readAt)!, value: Number(r.lastReading.value), origin: r.lastReading.origin as never } : null,
});

export async function listEquipments(db: Database, farmId: string): Promise<EquipmentSummary[]> {
  return withFarm(db, farmId, async (tx) =>
    (await rows<SummaryRow>(tx, sql`${SUMMARY} ORDER BY coalesce(e.state, 'active') = 'active' DESC, e.name`)).map(toSummary),
  );
}

async function readingsOf(tx: Tx, equipmentId: string): Promise<MeterReading[]> {
  const raw = await rows<Record<string, unknown>>(
    tx,
    sql`SELECT r.id, r.equipment_id, r.read_at, r.value, r.origin, r.correction, r.correction_reason, r.intervention_id, r.note,
               coalesce(u.name, u.email) AS author_name
        FROM meter_readings r LEFT JOIN users u ON u.id::text = r.author
        WHERE r.equipment_id = ${equipmentId}`,
  );
  const readings = raw.map((r) => ({
    id: r.id as string,
    equipmentId: r.equipment_id as string,
    readAt: iso(r.read_at)!,
    value: Number(r.value),
    origin: r.origin as MeterReading["origin"],
    correction: (r.correction as MeterReading["correction"]) ?? null,
    correctionReason: (r.correction_reason as string) ?? null,
    interventionId: (r.intervention_id as string) ?? null,
    authorName: (r.author_name as string) ?? null,
    note: (r.note as string) ?? null,
  }));
  return usageSeries(readings).map((p) => ({ ...p.reading, usage: p.usage, status: p.status }));
}

export async function equipmentSheet(db: Database, farmId: string, id: string): Promise<EquipmentSheet> {
  return withFarm(db, farmId, async (tx) => {
    const [s] = await rows<SummaryRow>(tx, sql`${SUMMARY} WHERE e.id = ${id}`);
    if (!s) throw new NotFound("Matériel introuvable");
    const [x] = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT manufacturer_type, commissioned_at, aggregates, technical, external_ids, notes FROM equipments WHERE id = ${id}`,
    );
    const options = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT id, code, label, lower(valid) AS "from", upper(valid) AS "to" FROM equipment_options WHERE equipment_id = ${id} ORDER BY lower(valid), label`,
    );
    const history = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT i.id, i.procedure, i.status, i.started_at, p.role,
                 coalesce((SELECT array_agg(lp.name ORDER BY lp.name) FROM intervention_parameters t
                             JOIN land_parcels lp ON lp.id = t.ref_id
                            WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'), '{}') AS parcels
          FROM interventions i
          JOIN LATERAL (SELECT min(role) AS role FROM intervention_parameters q
                         WHERE q.intervention_id = i.id AND q.ref_type = 'equipment' AND q.ref_id = ${id}
                           AND q.role IN ('target', 'tool')) p ON p.role IS NOT NULL
          WHERE i.status <> 'cancelled'
          ORDER BY coalesce(i.started_at, i.created_at) DESC LIMIT 300`,
    );
    const trackers = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT device_id, lower(valid) AS "from", upper(valid) AS "to" FROM tracker_bindings WHERE equipment_id = ${id} ORDER BY lower(valid) DESC`,
    );
    const brandInfo = s.brandId ? (await listBrandsTx(tx, s.brandId))[0] ?? null : null;
    return {
      ...toSummary(s),
      manufacturerType: (x!.manufacturer_type as string) ?? null,
      commissionedAt: iso(x!.commissioned_at),
      aggregates: (x!.aggregates as EquipmentSheet["aggregates"]) ?? [],
      technical: x!.technical ?? null,
      externalIds: (x!.external_ids as Record<string, string>) ?? {},
      notes: (x!.notes as string) ?? null,
      brandInfo,
      options: options.map((o) => ({ id: o.id as string, code: o.code as string, label: o.label as string, from: iso(o.from)!, to: iso(o.to) })),
      readings: await readingsOf(tx, id),
      history: history.map(
        (h): EquipmentHistoryEntry => ({
          interventionId: h.id as string,
          procedure: h.procedure as string,
          status: h.status as string,
          startedAt: iso(h.started_at),
          role: h.role === "target" ? "target" : "tool",
          parcels: (h.parcels as string[]) ?? [],
        }),
      ),
      trackers: trackers.map((t) => ({ deviceId: t.device_id as string, from: iso(t.from)!, to: iso(t.to) })),
    };
  });
}

// ---------------------------------------------------------------------------
// Écriture de la fiche (responsable)
// ---------------------------------------------------------------------------

/** Marque saisie en texte → marque de la ferme (créée au besoin). */
async function ensureBrand(tx: Tx, farmId: string, name: string | null | undefined): Promise<string | null> {
  const n = name?.trim();
  if (!n) return null;
  const norm = normName(n);
  if (!norm) return null;
  const [b] = await rows<{ id: string }>(
    tx,
    sql`INSERT INTO farm_brands (id, farm_id, name, name_norm) VALUES (${crypto.randomUUID()}, ${farmId}, ${n}, ${norm})
        ON CONFLICT (farm_id, name_norm) DO UPDATE SET name_norm = excluded.name_norm RETURNING id`,
  );
  return b!.id;
}

export async function createEquipment(db: Database, farmId: string, ctx: DomainCtx, body: EquipmentWrite): Promise<{ id: string }> {
  return withFarm(db, farmId, async (tx) => {
    const id = ctx.newId();
    const brandId = await ensureBrand(tx, farmId, body.brand);
    const meterUnit = body.meterUnit === undefined ? (["tractor", "self_propelled_equipment"].includes(body.kind) ? "hours" : null) : body.meterUnit;
    await tx.execute(sql`
      INSERT INTO equipments (id, farm_id, name, kind, state, brand, brand_id, model, serial_number, manufacturer_type, year,
                              meter_unit, commissioned_at, aggregates, external_ids, notes)
      VALUES (${id}, ${farmId}, ${body.name}, ${body.kind}, ${body.state ?? "active"}, ${body.brand || null}, ${brandId},
              ${body.model || null}, ${body.serialNumber || null}, ${body.manufacturerType || null}, ${body.year ?? null},
              ${meterUnit}, ${body.commissionedAt ?? null}, ${JSON.stringify(body.aggregates)}::jsonb,
              ${JSON.stringify(body.externalIds)}::jsonb, ${body.notes || null})`);
    await audit(tx, farmId, ctx, "equipment", id, "create", body);
    return { id };
  });
}

export async function updateEquipment(db: Database, farmId: string, ctx: DomainCtx, id: string, body: EquipmentWrite): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const brandId = await ensureBrand(tx, farmId, body.brand);
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE equipments SET name = ${body.name}, kind = ${body.kind}, state = ${body.state ?? "active"},
            brand = ${body.brand || null}, brand_id = ${brandId}, model = ${body.model || null},
            serial_number = ${body.serialNumber || null}, manufacturer_type = ${body.manufacturerType || null},
            year = ${body.year ?? null}, meter_unit = ${body.meterUnit ?? null}, commissioned_at = ${body.commissionedAt ?? null},
            aggregates = ${JSON.stringify(body.aggregates)}::jsonb, external_ids = ${JSON.stringify(body.externalIds)}::jsonb,
            notes = ${body.notes || null}, updated_at = now()
          WHERE id = ${id} RETURNING id`,
    );
    if (!done.length) throw new NotFound("Matériel introuvable");
    await audit(tx, farmId, ctx, "equipment", id, "update", body);
  });
}

export async function addOption(db: Database, farmId: string, ctx: DomainCtx, equipmentId: string, body: EquipmentOptionWrite): Promise<EquipmentOption> {
  return withFarm(db, farmId, async (tx) => {
    const [e] = await rows<{ id: string }>(tx, sql`SELECT id FROM equipments WHERE id = ${equipmentId}`);
    if (!e) throw new NotFound("Matériel introuvable");
    if (body.to && body.to <= body.from) throw new BadRequest("La fin doit suivre le début.");
    const id = ctx.newId();
    try {
      await tx.execute(sql`
        INSERT INTO equipment_options (id, farm_id, equipment_id, code, label, valid)
        VALUES (${id}, ${farmId}, ${equipmentId}, ${body.code}, ${body.label}, tstzrange(${body.from}::timestamptz, ${body.to ?? null}::timestamptz))`);
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === "23P01") throw new Conflict("Cette option est déjà montée sur cette période.");
      throw e;
    }
    await audit(tx, farmId, ctx, "equipment_option", id, "create", body);
    return { id, code: body.code, label: body.label, from: body.from, to: body.to ?? null };
  });
}

export async function deleteOption(db: Database, farmId: string, ctx: DomainCtx, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(tx, sql`DELETE FROM equipment_options WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Option introuvable");
    await audit(tx, farmId, ctx, "equipment_option", id, "delete", {});
  });
}

// ---------------------------------------------------------------------------
// Relevés de compteur (FR-MAT-10 à 12)
// ---------------------------------------------------------------------------

export async function listReadings(db: Database, farmId: string, equipmentId: string): Promise<MeterReading[]> {
  return withFarm(db, farmId, (tx) => readingsOf(tx, equipmentId));
}

/**
 * Nouveau relevé, dans une transaction déjà ouverte (API, synchro mobile) :
 * idempotent par identifiant client ; refusé (409) s'il sort de l'intervalle
 * de ses voisins sans correction motivée ; la correction est auditée.
 */
export async function addReadingInTx(
  tx: Tx,
  farmId: string,
  ctx: DomainCtx,
  equipmentId: string,
  body: MeterReadingWrite,
  extra: { origin?: "manual" | "reference" | "intervention"; interventionId?: string } = {},
): Promise<MeterReadingResult> {
  const [e] = await rows<{ meter_unit: string | null; name: string }>(tx, sql`SELECT meter_unit, name FROM equipments WHERE id = ${equipmentId}`);
  if (!e) throw new NotFound("Matériel introuvable");
  if (!e.meter_unit) throw new BadRequest(`${e.name} n'a pas de compteur.`);
  const id = body.id ?? ctx.newId();
  const existing = await readingsOf(tx, equipmentId);
  const already = existing.find((r) => r.id === id);
  if (already) return { reading: already, warning: null }; // re-push idempotent
  const next = { id, readAt: body.readAt, value: body.value, correction: body.correction ?? null, correctionReason: body.correctionReason ?? null };
  const check = checkReading(existing, next);
  if (!check.ok) throw new Conflict(readingCheckMessage(check, (v) => `${v.toLocaleString("fr-FR")} h`)!);
  const origin = extra.origin ?? body.origin ?? "manual";
  await tx.execute(sql`
    INSERT INTO meter_readings (id, farm_id, equipment_id, read_at, value, origin, correction, correction_reason, intervention_id, client_id, author, note)
    VALUES (${id}, ${farmId}, ${equipmentId}, ${body.readAt}, ${body.value}, ${origin}, ${body.correction ?? null},
            ${body.correction ? body.correctionReason!.trim() : null}, ${extra.interventionId ?? null}, ${body.id ?? null},
            ${ctx.actor}, ${body.note || null})`);
  if (body.correction) await audit(tx, farmId, ctx, "meter_reading", id, `correction_${body.correction}`, { equipmentId, ...body });
  await tx.execute(sql`UPDATE equipments SET updated_at = now() WHERE id = ${equipmentId}`);
  const reading = (await readingsOf(tx, equipmentId)).find((r) => r.id === id)!;
  const warning =
    check.warning?.code === "too_fast"
      ? `Le compteur avance de ${check.warning.hours.toLocaleString("fr-FR")} h depuis le relevé du ${new Date(check.warning.neighbour.readAt).toLocaleDateString("fr-FR")} : vérifiez la saisie.`
      : null;
  return { reading, warning };
}

export async function addReading(db: Database, farmId: string, ctx: DomainCtx, equipmentId: string, body: MeterReadingWrite): Promise<MeterReadingResult> {
  return withFarm(db, farmId, (tx) => addReadingInTx(tx, farmId, ctx, equipmentId, body));
}

export async function deleteReading(db: Database, farmId: string, ctx: DomainCtx, id: string): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [r] = await rows<Record<string, unknown>>(tx, sql`SELECT * FROM meter_readings WHERE id = ${id}`);
    if (!r) throw new NotFound("Relevé introuvable");
    if (r.origin !== "manual" && r.origin !== "reference") {
      throw new BadRequest("Ce relevé vient d'une intervention ou d'une intégration : corrigez sa source.");
    }
    await tx.execute(sql`DELETE FROM meter_readings WHERE id = ${id}`);
    await audit(tx, farmId, ctx, "meter_reading", id, "delete", { equipmentId: r.equipment_id, readAt: iso(r.read_at), value: Number(r.value) });
  });
}

// ---------------------------------------------------------------------------
// Marques de la ferme
// ---------------------------------------------------------------------------

async function listBrandsTx(tx: Tx, id?: string): Promise<FarmBrand[]> {
  const list = await rows<FarmBrand & { equipments: unknown }>(
    tx,
    sql`SELECT b.id, b.name, b.color, b.logo_asset_id AS "logoAssetId",
               (SELECT count(*) FROM equipments e WHERE e.brand_id = b.id) AS equipments
        FROM farm_brands b ${id ? sql`WHERE b.id = ${id}` : sql``} ORDER BY b.name`,
  );
  return list.map((b) => ({ ...b, equipments: Number(b.equipments) }));
}

export async function listBrands(db: Database, farmId: string): Promise<FarmBrand[]> {
  return withFarm(db, farmId, (tx) => listBrandsTx(tx));
}

export async function updateBrand(db: Database, farmId: string, id: string, body: FarmBrandWrite): Promise<FarmBrand> {
  return withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE farm_brands SET name = ${body.name}, name_norm = ${normName(body.name)}, color = ${body.color ?? null}, updated_at = now()
          WHERE id = ${id} RETURNING id`,
    );
    if (!done.length) throw new NotFound("Marque introuvable");
    await tx.execute(sql`UPDATE equipments SET brand = ${body.name}, updated_at = now() WHERE brand_id = ${id}`);
    return (await listBrandsTx(tx, id))[0]!;
  });
}

// ---------------------------------------------------------------------------
// Logos (FR-MAT-80) : fichiers en base, type vérifié par les octets.
// ---------------------------------------------------------------------------

export const LOGO_MAX_BYTES = 1_048_576;

/** Type réel d'une image (signature), ou null. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/svg+xml" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048)).replace(/^\uFEFF/, "").trimStart();
  if ((head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) && /<svg[\s>]/.test(head)) return "image/svg+xml";
  return null;
}

async function insertAsset(tx: Tx, farmId: string, kind: "logo" | "logo_raster", mediaType: string, bytes: Uint8Array, rasterId: string | null = null) {
  const id = crypto.randomUUID();
  const sha = createHash("sha256").update(bytes).digest("hex");
  await tx.execute(sql`
    INSERT INTO equipment_assets (id, farm_id, kind, media_type, bytes, size, sha256, raster_id)
    VALUES (${id}, ${farmId}, ${kind}, ${mediaType}, ${Buffer.from(bytes)}, ${bytes.length}, ${sha}, ${rasterId})`);
  return id;
}

export interface LogoUpload {
  file: Uint8Array;
  /** PNG dérivé d'un SVG par le navigateur (texture 3D). */
  raster?: Uint8Array;
}

/** Valide un logo (type par les octets, taille) et renvoie son type. */
export function validateLogo(upload: LogoUpload): string {
  if (upload.file.length === 0) throw new BadRequest("Fichier vide.");
  if (upload.file.length > LOGO_MAX_BYTES) throw new BadRequest("Logo trop lourd (1 Mo au plus).");
  const type = sniffImage(upload.file);
  if (!type) throw new BadRequest("Format non reconnu : PNG, JPEG ou SVG attendu.");
  if (upload.raster) {
    if (upload.raster.length > LOGO_MAX_BYTES || sniffImage(upload.raster) !== "image/png") throw new BadRequest("Version PNG du logo invalide.");
  }
  return type;
}

export async function setLogo(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  target: { equipmentId: string } | { brandId: string },
  upload: LogoUpload | null,
): Promise<{ logoAssetId: string | null }> {
  const type = upload ? validateLogo(upload) : null;
  return withFarm(db, farmId, async (tx) => {
    const isEquipment = "equipmentId" in target;
    const targetId = isEquipment ? target.equipmentId : target.brandId;
    const [current] = await rows<{ logo_asset_id: string | null }>(
      tx,
      isEquipment ? sql`SELECT logo_asset_id FROM equipments WHERE id = ${targetId}` : sql`SELECT logo_asset_id FROM farm_brands WHERE id = ${targetId}`,
    );
    if (!current) throw new NotFound(isEquipment ? "Matériel introuvable" : "Marque introuvable");
    let assetId: string | null = null;
    if (upload && type) {
      const rasterId = type === "image/svg+xml" && upload.raster ? await insertAsset(tx, farmId, "logo_raster", "image/png", upload.raster) : null;
      assetId = await insertAsset(tx, farmId, "logo", type, upload.file, rasterId);
    }
    await tx.execute(
      isEquipment
        ? sql`UPDATE equipments SET logo_asset_id = ${assetId}, updated_at = now() WHERE id = ${targetId}`
        : sql`UPDATE farm_brands SET logo_asset_id = ${assetId}, updated_at = now() WHERE id = ${targetId}`,
    );
    if (current.logo_asset_id) {
      await tx.execute(sql`DELETE FROM equipment_assets WHERE raster_id IS NULL AND id IN (SELECT raster_id FROM equipment_assets WHERE id = ${current.logo_asset_id})`);
      await tx.execute(sql`DELETE FROM equipment_assets WHERE id = ${current.logo_asset_id}`);
    }
    await audit(tx, farmId, ctx, isEquipment ? "equipment" : "farm_brand", targetId, assetId ? "logo_set" : "logo_removed", { type });
    return { logoAssetId: assetId };
  });
}

export async function readAsset(db: Database, farmId: string, id: string): Promise<{ mediaType: string; bytes: Uint8Array; sha256: string }> {
  return withFarm(db, farmId, async (tx) => {
    const [a] = await rows<{ media_type: string; bytes: Uint8Array; sha256: string }>(
      tx,
      sql`SELECT media_type, bytes, sha256 FROM equipment_assets WHERE id = ${id}`,
    );
    if (!a) throw new NotFound("Fichier introuvable");
    return { mediaType: a.media_type, bytes: a.bytes, sha256: a.sha256 };
  });
}
