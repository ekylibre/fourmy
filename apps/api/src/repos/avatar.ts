import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { buildAvatarGlb, inspectGlb, resolveAvatar, type AvatarInput, type ResolvedAvatar } from "@fourmy/equipment-3d";
import type { AvatarInfo, AvatarWrite, Hitch, LatestPosition } from "@fourmy/contracts";
import type { DomainCtx } from "@fourmy/domain";
import { createHash } from "node:crypto";
import { BadRequest, NotFound } from "../routes/helpers.js";

/**
 * Avatar 3D des matériels (lot M, docs/materiels-entretien-design.md §10) :
 * paramètres résolus, GLB généré à la demande (mis en cache par empreinte)
 * ou importé, dernières positions et attelages pour la vue 3D.
 */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

type Row = {
  kind: string;
  technical: unknown;
  avatar: AvatarWrite | null;
  model_asset_id: string | null;
  brand_color: string | null;
  logo_id: string | null;
};

/** Logo PNG de l'avatar : celui du matériel, sinon de sa marque ; un SVG passe par sa version PNG. */
const LOGO_PNG = sql`
  (SELECT CASE WHEN a.media_type = 'image/png' THEN a.id WHEN a.media_type = 'image/svg+xml' THEN a.raster_id END
     FROM equipment_assets a WHERE a.id = coalesce(e.logo_asset_id, b.logo_asset_id))`;

async function load(tx: Tx, id: string): Promise<Row> {
  const [r] = await rows<Row>(
    tx,
    sql`SELECT e.kind, e.technical, e.avatar, e.model_asset_id, b.color AS brand_color, ${LOGO_PNG} AS logo_id
        FROM equipments e LEFT JOIN farm_brands b ON b.id = e.brand_id WHERE e.id = ${id}`,
  );
  if (!r) throw new NotFound("Matériel introuvable");
  return r;
}

const strip = (w: AvatarWrite | null): AvatarInput => {
  if (!w) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) if (v !== null && v !== undefined) out[k] = v;
  if (w.colors) out.colors = Object.fromEntries(Object.entries(w.colors).filter(([, v]) => v));
  return out as AvatarInput;
};

const resolve = (r: Row): ResolvedAvatar => resolveAvatar({ kind: r.kind, technical: r.technical, brandColor: r.brand_color, saved: strip(r.avatar), logoId: r.logo_id });

export async function avatarInfo(db: Database, farmId: string, id: string): Promise<AvatarInfo> {
  return withFarm(db, farmId, async (tx) => {
    const r = await load(tx, id);
    const a = resolve(r);
    return { params: a.params as unknown as Record<string, unknown>, provenance: a.provenance, saved: r.avatar, hash: r.model_asset_id ? `m${r.model_asset_id.slice(0, 8)}` : a.hash, imported: !!r.model_asset_id, logoAssetId: r.logo_id };
  });
}

// Cache des GLB générés (empreinte → octets), borné.
const cache = new Map<string, Uint8Array>();
const CACHE_MAX = 200;

/** GLB de l'avatar (importé, sinon généré) et son empreinte (ETag). */
export async function avatarGlb(db: Database, farmId: string, id: string): Promise<{ bytes: Uint8Array; etag: string }> {
  const { r, logo, model } = await withFarm(db, farmId, async (tx) => {
    const r = await load(tx, id);
    const fetchBytes = async (assetId: string | null) =>
      assetId ? ((await rows<{ bytes: Uint8Array }>(tx, sql`SELECT bytes FROM equipment_assets WHERE id = ${assetId}`))[0]?.bytes ?? null) : null;
    return { r, model: await fetchBytes(r.model_asset_id), logo: r.model_asset_id ? null : await fetchBytes(r.logo_id) };
  });
  if (model) return { bytes: new Uint8Array(model), etag: `m-${createHash("sha1").update(model).digest("hex").slice(0, 16)}` };
  const a = resolve(r);
  let bytes = cache.get(a.hash);
  if (!bytes) {
    bytes = (await buildAvatarGlb(a.params, logo ? new Uint8Array(logo) : null)).glb;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(a.hash, bytes);
  }
  return { bytes, etag: a.hash };
}

export async function saveAvatar(db: Database, farmId: string, ctx: DomainCtx, id: string, body: AvatarWrite): Promise<AvatarInfo> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(tx, sql`UPDATE equipments SET avatar = ${JSON.stringify(body)}::jsonb, updated_at = now() WHERE id = ${id} RETURNING id`);
    if (!done.length) throw new NotFound("Matériel introuvable");
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
      VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'equipment', ${id}, 'avatar', ${JSON.stringify(body)}::jsonb)`);
  });
  return avatarInfo(db, farmId, id);
}

/** Modèle GLB importé (FR-MAT-83) : vérifié (en-tête, 5 Mo, 100 000 triangles) ; null le retire. */
export async function setModel(db: Database, farmId: string, ctx: DomainCtx, id: string, glb: Uint8Array | null): Promise<AvatarInfo> {
  if (glb) {
    try {
      await inspectGlb(glb);
    } catch (e) {
      throw new BadRequest(e instanceof Error ? e.message : String(e));
    }
  }
  await withFarm(db, farmId, async (tx) => {
    const [cur] = await rows<{ model_asset_id: string | null }>(tx, sql`SELECT model_asset_id FROM equipments WHERE id = ${id}`);
    if (!cur) throw new NotFound("Matériel introuvable");
    let assetId: string | null = null;
    if (glb) {
      assetId = crypto.randomUUID();
      await tx.execute(sql`
        INSERT INTO equipment_assets (id, farm_id, kind, media_type, bytes, size, sha256)
        VALUES (${assetId}, ${farmId}, 'model', 'model/gltf-binary', ${Buffer.from(glb)}, ${glb.length}, ${createHash("sha256").update(glb).digest("hex")})`);
    }
    await tx.execute(sql`UPDATE equipments SET model_asset_id = ${assetId}, updated_at = now() WHERE id = ${id}`);
    if (cur.model_asset_id) await tx.execute(sql`DELETE FROM equipment_assets WHERE id = ${cur.model_asset_id}`);
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
      VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'equipment', ${id}, ${glb ? "model_set" : "model_removed"}, ${JSON.stringify({ size: glb?.length ?? 0 })}::jsonb)`);
  });
  return avatarInfo(db, farmId, id);
}

/** Dernière position de chaque matériel suivi, avant `at`, sur au plus 30 jours (FR-MAT-86). */
export async function latestPositions(db: Database, farmId: string, at: string): Promise<LatestPosition[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<Record<string, unknown> & Row & { id: string; name: string }>(
      tx,
      sql`SELECT DISTINCT ON (e.id) e.id, e.name, e.kind, e.technical, e.avatar, e.model_asset_id, b.color AS brand_color, ${LOGO_PNG} AS logo_id,
                 p.time, ST_X(p.point) AS lon, ST_Y(p.point) AS lat, p.heading, p.speed
          FROM tracker_bindings t
          JOIN equipments e ON e.id = t.equipment_id
          LEFT JOIN farm_brands b ON b.id = e.brand_id
          JOIN LATERAL (SELECT * FROM positions p WHERE p.binding_id = t.id AND p.time <= ${at}::timestamptz
                          AND p.time > ${at}::timestamptz - interval '30 days' ORDER BY p.time DESC LIMIT 1) p ON true
          WHERE t.valid @> ${at}::timestamptz
          ORDER BY e.id, p.time DESC`,
    );
    return list.map((r) => ({
      equipmentId: r.id,
      name: r.name,
      kind: r.kind,
      time: iso(r.time)!,
      lon: Number(r.lon),
      lat: Number(r.lat),
      heading: r.heading === null ? null : Number(r.heading),
      speedKmh: r.speed === null ? null : Number(r.speed),
      avatarHash: r.model_asset_id ? `m${r.model_asset_id.slice(0, 8)}` : resolve(r).hash,
    }));
  });
}

/**
 * Outils attelés à un matériel entre deux dates (FR-MAT-85) : les autres
 * matériels des interventions réalisées qui l'utilisent, sur leurs périodes
 * de travail. L'attribut `tool` de Traccar viendra s'y ajouter.
 */
export async function hitches(db: Database, farmId: string, equipmentId: string, from: string, to: string): Promise<Hitch[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<Record<string, unknown> & Row & { tool_id: string; name: string; started_at: string; stopped_at: string }>(
      tx,
      // Attelages (lot N3) : outils du même attelage que le matériel, sur les
      // périodes de cet attelage. Mode libre : tous les outils de
      // l'intervention, sur toutes ses périodes (déduction d'avant).
      sql`SELECT e.id AS tool_id, e.name, e.kind, e.technical, e.avatar, e.model_asset_id, b.color AS brand_color, ${LOGO_PNG} AS logo_id,
                 w.started_at, w.stopped_at
          FROM interventions i
          JOIN intervention_parameters me ON me.intervention_id = i.id AND me.role = 'tool' AND me.ref_id = ${equipmentId}
          JOIN intervention_parameters o ON o.intervention_id = i.id AND o.role = 'tool' AND o.ref_type = 'equipment' AND o.ref_id <> ${equipmentId}
           AND (i.staffing = 'free' OR o.crew_id = me.crew_id)
          JOIN intervention_periods w ON w.intervention_id = i.id AND (i.staffing = 'free' OR w.crew_id = me.crew_id)
          JOIN equipments e ON e.id = o.ref_id
          LEFT JOIN farm_brands b ON b.id = e.brand_id
          WHERE i.status = 'done' AND w.stopped_at > ${from}::timestamptz AND w.started_at < ${to}::timestamptz
            AND e.kind NOT IN ('tractor', 'self_propelled_equipment')
          ORDER BY w.started_at`,
    );
    return list.map((r) => {
      const a = resolve(r);
      return {
        toolId: r.tool_id,
        toolName: r.name,
        from: iso(r.started_at)!,
        to: iso(r.stopped_at)!,
        hitchOffsetM: a.params.hitchOffsetM,
        avatarHash: r.model_asset_id ? `m${r.model_asset_id.slice(0, 8)}` : a.hash,
      };
    });
  });
}
