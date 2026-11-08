import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { checkTreatment, hazardPictograms, worstLevel, type ParcelContext, type PhytoProductRef, type PhytoUsageRef } from "@fourmy/domain";
import {
  PROCEDURES,
  type ComplianceResult,
  type ComplianceWrite,
  type InterventionTarget,
  type FarmPhytoArticle,
  type InterventionWaterMap,
  type PhytoProduct,
  type PhytoStatus,
  type TreatmentCheckDto,
  type WorkPeriod,
} from "@fourmy/contracts";
import { expand, fetchWater, type Bounds } from "@fourmy/geo-ign";

/**
 * Réglementation phytosanitaire côté serveur (lot 2) : rassemble ce que le
 * contrôle du domaine demande (produit et usages E-Phy, culture et surface
 * de chaque parcelle à la date, distance réelle à l'eau, applications de la
 * campagne, prochaine récolte) et appelle `checkTreatment`.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const HARVEST_CODES = PROCEDURES.filter((p) => p.shape === "harvest").map((p) => p.code);

export interface CheckableBody {
  procedure: string;
  periods: WorkPeriod[];
  targets: InterventionTarget[];
  inputs: { articleId: string; quantity: number; per: "hectare" | "total" }[];
  plannedAt?: string;
  compliance?: ComplianceWrite;
}

/** Date de référence du traitement : fin de la dernière période, sinon date prévue. */
export function treatmentAt(body: Pick<CheckableBody, "periods" | "plannedAt">, fallback = new Date().toISOString()): string {
  const last = [...body.periods].sort((a, b) => a.stoppedAt.localeCompare(b.stoppedAt)).at(-1);
  return last?.stoppedAt ?? body.plannedAt ?? fallback;
}

async function referential(tx: Tx): Promise<string | null> {
  const [r] = await rows<{ version: string }>(tx, sql`SELECT version FROM lexicon_packages WHERE name = 'phytosanitary'`);
  return r?.version ?? null;
}

let cropsetCache: { version: string | null; map: Record<string, string[]> } | null = null;
async function cropsets(tx: Tx, version: string | null): Promise<Record<string, string[]>> {
  if (cropsetCache && cropsetCache.version === version) return cropsetCache.map;
  const list = await rows<{ name: string; crop_names: string[] }>(tx, sql`SELECT name, crop_names FROM phyto_cropsets`);
  cropsetCache = { version, map: Object.fromEntries(list.map((c) => [c.name, c.crop_names])) };
  return cropsetCache.map;
}

async function lineage(tx: Tx, cultivation: string): Promise<{ names: string[]; label: string | null }> {
  const list = await rows<{ reference_name: string; label: string | null }>(
    tx,
    sql`WITH RECURSIVE l AS (
          SELECT reference_name, parent, label, 0 AS depth FROM taxonomy WHERE reference_name = ${cultivation}
          UNION ALL
          SELECT t.reference_name, t.parent, t.label, l.depth + 1 FROM taxonomy t JOIN l ON t.reference_name = l.parent WHERE l.depth < 30
        ) SELECT reference_name, label FROM l ORDER BY depth`,
  );
  if (list.length === 0) return { names: [cultivation], label: cultivation };
  return { names: list.map((r) => r.reference_name), label: list[0]!.label };
}

async function productByAmm(tx: Tx, amm: string): Promise<{ id: number; ref: PhytoProductRef } | null> {
  const [p] = await rows<{
    id: number;
    amm: string;
    name: string;
    state: string;
    started_on: string | null;
    stopped_on: string | null;
    reentry_delay_hours: number | null;
    natures: string[];
  }>(
    tx,
    sql`SELECT id, amm, name, state, started_on::text, stopped_on::text, reentry_delay_hours, natures
        FROM phyto_products WHERE amm = ${amm}
        ORDER BY (state = 'authorized') DESC, stopped_on DESC NULLS FIRST LIMIT 1`,
  );
  if (!p) return null;
  return {
    id: p.id,
    ref: { amm: p.amm, name: p.name, state: p.state, startedOn: p.started_on, stoppedOn: p.stopped_on, reentryDelayHours: p.reentry_delay_hours, natures: p.natures },
  };
}

async function usagesOf(tx: Tx, productId: number): Promise<PhytoUsageRef[]> {
  const list = await rows<Record<string, unknown>>(
    tx,
    sql`SELECT id, crop_label, species, target_label, dose_quantity::float8 AS dose_quantity, dose_unit_label,
               pre_harvest_delay_days, applications_count, untreated_buffer_aquatic, state, decision_date::text,
               is_derogation, derogation_started_on::text, derogation_stopped_on::text
        FROM phyto_usages WHERE product_id = ${productId} ORDER BY crop_label, target_label, dose_quantity`,
  );
  return list.map((u) => ({
    id: u.id as string,
    cropLabel: (u.crop_label as string | null) ?? null,
    species: (u.species as string[]) ?? [],
    targetLabel: (u.target_label as string | null) ?? null,
    doseQuantity: (u.dose_quantity as number | null) ?? null,
    doseUnitLabel: (u.dose_unit_label as string | null) ?? null,
    preHarvestDelayDays: (u.pre_harvest_delay_days as number | null) ?? null,
    applicationsCount: (u.applications_count as number | null) ?? null,
    untreatedBufferAquatic: (u.untreated_buffer_aquatic as number | null) ?? null,
    state: u.state as string,
    decisionDate: (u.decision_date as string | null) ?? null,
    isDerogation: Boolean(u.is_derogation),
    derogationStartedOn: (u.derogation_started_on as string | null) ?? null,
    derogationStoppedOn: (u.derogation_stopped_on as string | null) ?? null,
  }));
}

/** Parcelle à la date : nom, surface traitée, culture, distance à l'eau, prochaine récolte. */
async function parcelContext(
  tx: Tx,
  target: InterventionTarget,
  at: string,
  selfId: string | null,
  waterLoaded: boolean,
): Promise<Omit<ParcelContext, "previousApplications"> & { cultivation: string | null }> {
  const zone = target.workingZone ? JSON.stringify(target.workingZone) : null;
  const [r] = await rows<{
    name: string;
    area: number | null;
    zone_area: number | null;
    cultivation: string | null;
    activity: string | null;
    reference: string | null;
    water_name: string | null;
    water_m: number | null;
    next_harvest: string | null;
  }>(
    tx,
    sql`WITH v AS (SELECT shape, area_m2 FROM land_parcel_versions WHERE land_parcel_id = ${target.id} AND valid @> ${at}::timestamptz LIMIT 1),
             z AS (SELECT coalesce(${zone ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${zone}), 4326)` : sql`NULL::geometry`}, (SELECT shape FROM v)) AS g),
             w AS (SELECT wi.name, ST_Distance(wi.geom::geography, z.g::geography) AS d
                   FROM water_items wi, z WHERE z.g IS NOT NULL AND NOT wi.ditch
                   ORDER BY wi.geom <-> z.g LIMIT 10)
        SELECT lp.name,
               (SELECT area_m2::float8 FROM v) AS area,
               (SELECT ST_Area(g::geography) FROM z) AS zone_area,
               prod.cultivation, prod.activity, prod.reference,
               (SELECT name FROM w ORDER BY d LIMIT 1) AS water_name,
               (SELECT d FROM w ORDER BY d LIMIT 1) AS water_m,
               (SELECT min(coalesce(i.started_at, i.stopped_at)) FROM interventions i
                 JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = lp.id
                 WHERE i.procedure = ANY(${`{${HARVEST_CODES.join(",")}}`}::text[]) AND i.status <> 'cancelled'
                   AND coalesce(i.started_at, i.stopped_at) > ${at}::timestamptz
                   ${selfId ? sql`AND i.id <> ${selfId}` : sql``}) AS next_harvest
        FROM land_parcels lp
        -- Production de la campagne et son activité : la culture vient de l'activité
        -- (variété cultivée, sinon celle de sa production de référence), sinon de la production.
        LEFT JOIN LATERAL (
          SELECT coalesce(a.cultivation, lx.specie, p.cultivation, CASE p.nature WHEN 'vine' THEN 'vitis' END) AS cultivation,
                 a.name AS activity, a.reference
          FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          LEFT JOIN activities a ON a.id = p.activity_id
          LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
          WHERE p.land_parcel_id = lp.id AND ${at}::timestamptz::date BETWEEN c.starts_on AND c.stops_on
          ORDER BY (a.id IS NULL), 1 NULLS LAST LIMIT 1) prod ON true
        WHERE lp.id = ${target.id}`,
  );
  const fallow = isFallow(r?.reference ?? null, r?.activity ?? null);
  // Jachère : espèce générique « plant », usages E-Phy des jachères (et traitements généraux).
  const cultivation = fallow ? "plant" : (r?.cultivation ?? null);
  const lin = cultivation && (fallow || cultivation !== "plant") ? await lineage(tx, cultivation) : null;
  const treatedM2 = target.workedAreaM2 ?? r?.zone_area ?? r?.area ?? 0;
  return {
    id: target.id,
    name: r?.name ?? "parcelle inconnue",
    treatedHa: treatedM2 / 10_000,
    lineage: lin?.names ?? null,
    cultivationLabel: fallow ? (r?.activity ?? "Jachère") : (lin?.label ?? null),
    cropLabels: fallow ? FALLOW_CROP_LABELS : null,
    cultivation,
    waterLoaded,
    waterDistanceM: r?.water_m ?? null,
    waterName: r?.water_name ?? null,
    nextHarvestAt: iso(r?.next_harvest),
  };
}

/** Libellés E-Phy des usages admis sur une jachère. */
const FALLOW_CROP_LABELS = ["Jachères et cultures intermédiaires", "Traitements généraux"];
/** Activité de jachère : production de référence `fallow`, `spring_fallow`… ou nommée ainsi. */
export const isFallow = (reference: string | null, name: string | null) => /fallow/.test(reference ?? "") || /^jach[èe]re/i.test(name ?? "");

/** Applications du même produit (n° AMM) sur la parcelle dans la campagne de la date, l'intervention exclue. */
async function previousApplications(tx: Tx, parcelId: string, amm: string, at: string, selfId: string | null): Promise<number> {
  const [r] = await rows<{ n: number }>(
    tx,
    sql`WITH c AS (SELECT coalesce((SELECT starts_on FROM campaigns WHERE ${at}::timestamptz::date BETWEEN starts_on AND stops_on LIMIT 1),
                                   date_trunc('year', ${at}::timestamptz)::date) AS s,
                          coalesce((SELECT stops_on FROM campaigns WHERE ${at}::timestamptz::date BETWEEN starts_on AND stops_on LIMIT 1),
                                   (date_trunc('year', ${at}::timestamptz) + interval '1 year - 1 day')::date) AS e)
        SELECT count(DISTINCT i.id)::int AS n
        FROM interventions i, c
        JOIN intervention_parameters t ON true
        JOIN intervention_parameters inp ON true
        JOIN articles a ON a.id = inp.ref_id
        WHERE t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
          AND inp.intervention_id = i.id AND inp.role = 'input' AND a.amm = ${amm}
          AND i.status = 'done' AND i.stopped_at::date BETWEEN c.s AND c.e
          ${selfId ? sql`AND i.id <> ${selfId}` : sql``}`,
  );
  return r?.n ?? 0;
}

/**
 * Contrôle réglementaire des produits phyto d'une saisie (sans l'écrire).
 * `selfId` : l'intervention elle-même (modification), exclue des décomptes.
 */
export async function checkCompliance(tx: Tx, body: CheckableBody, selfId: string | null = null): Promise<ComplianceResult> {
  const checkedAt = new Date().toISOString();
  const version = await referential(tx);
  const articleIds = [...new Set(body.inputs.map((i) => i.articleId))];
  const articles = articleIds.length
    ? await rows<{ id: string; name: string; unit: string; amm: string | null; kind: string }>(
        tx,
        sql`SELECT id, name, unit, amm, kind FROM articles WHERE id IN (${sql.join(articleIds.map((id) => sql`${id}`), sql`, `)})`,
      )
    : [];
  const phytoInputs = body.inputs.filter((i) => articles.find((a) => a.id === i.articleId)?.kind === "phyto");
  if (phytoInputs.length === 0) return { level: "ok", checkedAt, referential: version, checks: [], reason: body.compliance?.reason ?? null };

  const at = treatmentAt(body);
  const [water] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM water_syncs`);
  const waterLoaded = (water?.n ?? 0) > 0;
  const parcelTargets = body.targets.filter((t) => t.kind === "land_parcel");
  const contexts = await Promise.all(parcelTargets.map((t) => parcelContext(tx, t, at, selfId, waterLoaded)));
  const sets = await cropsets(tx, version);

  const checks: TreatmentCheckDto[] = [];
  for (const input of phytoInputs) {
    const article = articles.find((a) => a.id === input.articleId)!;
    const amm = article.amm?.trim() || null;
    const product = amm && version ? await productByAmm(tx, amm) : null;
    const usages = product ? await usagesOf(tx, product.id) : [];
    const parcels: ParcelContext[] = [];
    for (const c of contexts) parcels.push({ ...c, previousApplications: amm ? await previousApplications(tx, c.id, amm, at, selfId) : 0 });
    const usageId = body.compliance?.usages?.[input.articleId] ?? null;
    const result = checkTreatment({
      at,
      article: { name: article.name, amm, unit: article.unit },
      dose: { quantity: input.quantity, per: input.per },
      product: version ? (product?.ref ?? null) : null,
      usages,
      usageId,
      cropsets: sets,
      parcels,
    });
    if (!version) {
      result.indicators.unshift({ code: "authorization", level: "warning", message: "Référentiel phytosanitaire (Lexicon) non chargé : contrôle impossible." });
      result.level = worstLevel(result.indicators.map((i) => i.level));
    }
    checks.push({ articleId: input.articleId, ...result });
  }
  return { level: worstLevel(checks.map((c) => c.level)), checkedAt, referential: version, checks, reason: body.compliance?.reason ?? null };
}

/** Contrôle à la demande (formulaire), dans le contexte de la ferme. */
export async function checkComplianceFor(db: Database, farmId: string, body: CheckableBody, selfId: string | null = null) {
  return withFarm(db, farmId, (tx) => checkCompliance(tx, body, selfId));
}

// ---------------------------------------------------------------------------
// Référentiel : recherche, état, articles
// ---------------------------------------------------------------------------

export async function searchProducts(db: Database, farmId: string, q: string, limit = 20): Promise<PhytoProduct[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return withFarm(db, farmId, async (tx) => {
    const like = `%${term.toLowerCase()}%`;
    const list = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT id, amm, name, other_names, natures, state, stopped_on::text, reentry_delay_hours
          FROM phyto_products
          WHERE amm = ${term} OR lower(name) LIKE ${like} OR EXISTS (SELECT 1 FROM unnest(other_names) o WHERE lower(o) LIKE ${like})
          ORDER BY (amm = ${term}) DESC, (state = 'authorized') DESC, name LIMIT ${limit}`,
    );
    return list.map((p) => ({
      id: p.id as number,
      amm: p.amm as string,
      name: p.name as string,
      otherNames: ((p.other_names as string[]) ?? []).map((n) => n.trim()),
      natures: (p.natures as string[]) ?? [],
      state: p.state as string,
      stoppedOn: (p.stopped_on as string | null) ?? null,
      reentryDelayHours: (p.reentry_delay_hours as number | null) ?? null,
    }));
  });
}

export async function phytoStatus(db: Database, farmId: string): Promise<PhytoStatus> {
  return withFarm(db, farmId, async (tx) => {
    const packages = await rows<{ name: string; version: string; loaded_at: string }>(tx, sql`SELECT name, version, loaded_at FROM lexicon_packages`);
    const [w] = await rows<{ synced_at: string; items: number; last_error: string | null }>(tx, sql`SELECT synced_at, items, last_error FROM water_syncs`);
    const [a] = await rows<{ phyto: number; linked: number; without: number; unknown: number }>(
      tx,
      sql`SELECT count(*)::int AS phyto,
                 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM phyto_products p WHERE p.amm = btrim(a.amm)))::int AS linked,
                 count(*) FILTER (WHERE nullif(btrim(a.amm), '') IS NULL)::int AS without,
                 count(*) FILTER (WHERE nullif(btrim(a.amm), '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM phyto_products p WHERE p.amm = btrim(a.amm)))::int AS unknown
          FROM articles a WHERE a.kind = 'phyto'`,
    );
    const phyto = packages.find((p) => p.name === "phytosanitary");
    return {
      referential: { phytosanitary: phyto?.version ?? null, taxonomy: packages.find((p) => p.name === "taxonomy")?.version ?? null, loadedAt: iso(phyto?.loaded_at) },
      water: { syncedAt: iso(w?.synced_at), items: w?.items ?? 0, lastError: w?.last_error ?? null },
      articles: { phyto: a?.phyto ?? 0, linked: a?.linked ?? 0, withoutAmm: a?.without ?? 0, unknownAmm: a?.unknown ?? 0 },
    };
  });
}

// ---------------------------------------------------------------------------
// Eau autour de la ferme (BD TOPO)
// ---------------------------------------------------------------------------

/** Emprise de toutes les parcelles de la ferme (toutes dates), élargie de 200 m. */
async function farmBounds(tx: Tx): Promise<Bounds | null> {
  const [b] = await rows<{ west: number | null; south: number | null; east: number | null; north: number | null }>(
    tx,
    sql`SELECT ST_XMin(e) AS west, ST_YMin(e) AS south, ST_XMax(e) AS east, ST_YMax(e) AS north
        FROM (SELECT ST_Extent(v.shape)::geometry AS e FROM land_parcel_versions v JOIN land_parcels lp ON lp.id = v.land_parcel_id) x`,
  );
  if (!b || b.west === null) return null;
  return expand({ west: b.west, south: b.south!, east: b.east!, north: b.north! }, 200);
}

/** Recharge l'eau autour de la ferme ; une erreur est notée, l'ancien jeu reste en place. */
export async function syncFarmWater(db: Database, farmId: string, fetchImpl: typeof fetch = fetch): Promise<{ items: number; error: string | null }> {
  const bounds = await withFarm(db, farmId, farmBounds);
  if (!bounds) return { items: 0, error: "Aucune parcelle : rien à charger." };
  const box = sql`ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)`;
  let items;
  try {
    items = await fetchWater(bounds, fetchImpl);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await withFarm(db, farmId, (tx) =>
      tx.execute(sql`
        INSERT INTO water_syncs (farm_id, bounds, items, synced_at, last_error) VALUES (${farmId}, ${box}, 0, now(), ${error})
        ON CONFLICT (farm_id) DO UPDATE SET last_error = excluded.last_error`),
    );
    return { items: 0, error };
  }
  await withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`DELETE FROM water_items WHERE farm_id = ${farmId}`);
    for (const w of items) {
      await tx.execute(sql`
        INSERT INTO water_items (id, farm_id, kind, nature, name, permanent, ditch, geom)
        VALUES (${w.id}, ${farmId}, ${w.kind}, ${w.nature}, ${w.name}, ${w.permanent}, ${w.ditch},
                ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(w.geometry)}), 4326)))
        ON CONFLICT (farm_id, id) DO NOTHING`);
    }
    await tx.execute(sql`
      INSERT INTO water_syncs (farm_id, bounds, items, synced_at, last_error) VALUES (${farmId}, ${box}, ${items.length}, now(), NULL)
      ON CONFLICT (farm_id) DO UPDATE SET bounds = excluded.bounds, items = excluded.items, synced_at = now(), last_error = NULL`);
  });
  return { items: items.length, error: null };
}

/** Eau de la ferme en GeoJSON (carte de la fiche, du formulaire). */
export async function farmWater(db: Database, farmId: string) {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ id: string; name: string | null; kind: string; permanent: boolean | null; ditch: boolean; geometry: unknown }>(
      tx,
      sql`SELECT id, name, kind, permanent, ditch, ST_AsGeoJSON(geom)::json AS geometry FROM water_items`,
    );
    return {
      type: "FeatureCollection" as const,
      features: list.map((w) => ({ type: "Feature" as const, geometry: w.geometry, properties: { id: w.id, name: w.name, kind: w.kind, permanent: w.permanent, ditch: w.ditch } })),
    };
  });
}

/**
 * Eau autour d'une intervention, pour la carte de sa fiche : la bande de ZNT
 * (zones traitées élargies de la ZNT la plus exigeante des produits, d'après
 * le contrôle enregistré) et les cours d'eau, plans d'eau et fossés à moins
 * de 200 m au-delà de la bande.
 */
export async function interventionWater(
  db: Database,
  farmId: string,
  interventionId: string,
  checks: Pick<TreatmentCheckDto, "zntM" | "indicators">[],
): Promise<InterventionWaterMap | null> {
  return withFarm(db, farmId, async (tx) => {
    const [i] = await rows<{ at: string }>(
      tx,
      sql`SELECT coalesce(started_at, stopped_at, created_at)::text AS at FROM interventions WHERE id = ${interventionId}`,
    );
    if (!i) return null;
    // ZNT retenue par produit ; les contrôles enregistrés avant son ajout la donnent dans leur message.
    const widths = checks.map((c) => {
      if (typeof c.zntM === "number") return c.zntM;
      const m = /ZNT de (\d+(?:[.,]\d+)?) m/.exec(c.indicators.find((x) => x.code === "znt")?.message ?? "");
      return m ? Number(m[1]!.replace(",", ".")) : null;
    });
    const known = widths.filter((w): w is number => w !== null && w > 0);
    const zntM = known.length ? Math.max(...known) : null;
    const [r] = await rows<{ buffer: unknown; water: { id: string; name: string | null; kind: string; permanent: boolean | null; ditch: boolean; geometry: unknown }[] | null }>(
      tx,
      sql`WITH t AS (
            SELECT coalesce(p.working_zone,
                            (SELECT v.shape FROM land_parcel_versions v WHERE v.land_parcel_id = p.ref_id AND v.valid @> ${i.at}::timestamptz LIMIT 1)) AS g
            FROM intervention_parameters p WHERE p.intervention_id = ${interventionId} AND p.role = 'target'),
          u AS (SELECT ST_Union(g) AS g FROM t WHERE g IS NOT NULL),
          b AS (SELECT CASE WHEN ${zntM}::float8 IS NULL THEN NULL ELSE ST_Buffer(u.g::geography, ${zntM}::float8)::geometry END AS g FROM u)
        SELECT (SELECT ST_AsGeoJSON(b.g)::json FROM b) AS buffer,
               (SELECT json_agg(json_build_object('id', w.id, 'name', w.name, 'kind', w.kind, 'permanent', w.permanent, 'ditch', w.ditch,
                                                  'geometry', ST_AsGeoJSON(w.geom)::json))
                FROM water_items w, u
                WHERE u.g IS NOT NULL AND ST_DWithin(w.geom::geography, u.g::geography, coalesce(${zntM}::float8, 0) + 200)) AS water`,
    );
    return {
      zntM,
      buffer: r?.buffer ?? null,
      water: {
        type: "FeatureCollection" as const,
        features: (r?.water ?? []).map(({ geometry, ...properties }) => ({ type: "Feature" as const, geometry, properties })),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Articles phyto de la ferme et délais en cours d'une parcelle
// ---------------------------------------------------------------------------

/** Articles phyto avec leur produit E-Phy (rattachement par n° AMM). */
export async function phytoArticles(db: Database, farmId: string) {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{
      id: string;
      name: string;
      unit: string;
      amm: string | null;
      product_name: string | null;
      state: string | null;
      stopped_on: string | null;
      reentry: number | null;
      risks: { code: string; phrase: string }[] | null;
      symbols: string[] | null;
    }>(
      tx,
      sql`SELECT a.id, a.name, a.unit, nullif(btrim(a.amm), '') AS amm, p.name AS product_name, p.state, p.stopped_on::text,
                 p.reentry_delay_hours AS reentry,
                 (SELECT json_agg(json_build_object('code', r.code, 'phrase', r.phrase) ORDER BY r.code) FROM phyto_risks r WHERE r.product_id = p.id) AS risks,
                 (SELECT array_agg(DISTINCT s.symbol) FROM phyto_risks r
                    JOIN phyto_hazard_symbols s ON s.code = substring(r.code from '^H[0-9]{3}') WHERE r.product_id = p.id) AS symbols
          FROM articles a
          LEFT JOIN LATERAL (SELECT id, name, state, stopped_on, reentry_delay_hours FROM phyto_products WHERE amm = btrim(a.amm)
                             ORDER BY (state = 'authorized') DESC LIMIT 1) p ON true
          WHERE a.kind = 'phyto' ORDER BY a.name`,
    );
    return list.map(
      (a): FarmPhytoArticle => ({
        id: a.id,
        name: a.name,
        unit: a.unit,
        amm: a.amm,
        product: a.product_name ? { name: a.product_name, state: a.state!, stoppedOn: a.stopped_on } : null,
        hazards: hazardPictograms((a.risks ?? []).map((r) => r.code), a.symbols ?? []),
        risks: a.risks ?? [],
        reentryDelayHours: a.reentry,
      }),
    );
  });
}

/**
 * Délais en cours sur une parcelle à une date (exigence PHY-4) : ré-entrée
 * interdite jusqu'à…, récolte possible à partir du…, d'après les traitements
 * réalisés des 120 jours précédents (contrôle enregistré, sinon recalculé).
 */
export async function parcelDelays(db: Database, farmId: string, parcelId: string, at: string) {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<{ id: string; procedure: string; compliance: { checks?: { articleName: string; harvestAllowedFrom: string | null; reentryAllowedFrom: string | null }[] } | null }>(
      tx,
      sql`SELECT i.id, i.procedure, i.compliance FROM interventions i
          JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_id = ${parcelId}
          WHERE i.status = 'done' AND i.stopped_at <= ${at}::timestamptz AND i.stopped_at > ${at}::timestamptz - interval '120 days'
            AND EXISTS (SELECT 1 FROM intervention_parameters p JOIN articles a ON a.id = p.ref_id
                        WHERE p.intervention_id = i.id AND p.role = 'input' AND a.kind = 'phyto')
          ORDER BY i.stopped_at DESC`,
    );
    let reentry: { until: string; product: string; interventionId: string } | null = null;
    let harvest: { from: string; product: string; interventionId: string } | null = null;
    for (const i of list) {
      let checks = i.compliance?.checks;
      if (!checks) {
        const { readIntervention } = await import("./interventions.js");
        const full = await readIntervention(tx, i.id);
        checks = (await checkCompliance(tx, { procedure: full.procedure, periods: full.periods, targets: full.targets.filter((t) => t.id === parcelId), inputs: full.inputs }, i.id)).checks;
      }
      for (const c of checks ?? []) {
        if (c.reentryAllowedFrom && c.reentryAllowedFrom > at && (!reentry || c.reentryAllowedFrom > reentry.until)) {
          reentry = { until: c.reentryAllowedFrom, product: c.articleName, interventionId: i.id };
        }
        if (c.harvestAllowedFrom && c.harvestAllowedFrom > at && (!harvest || c.harvestAllowedFrom > harvest.from)) {
          harvest = { from: c.harvestAllowedFrom, product: c.articleName, interventionId: i.id };
        }
      }
    }
    return { reentry, harvest };
  });
}
