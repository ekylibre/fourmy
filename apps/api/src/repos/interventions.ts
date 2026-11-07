import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  planInterventionCompletion,
  toStockQuantity,
  pickLot,
  buildEvent,
  DomainError,
  type DomainCtx,
  type ResolvedStockLine,
} from "@fourmy/domain";
import type {
  Intervention,
  InterventionParameterWrite,
  InterventionPlanWrite,
  InterventionCompleteWrite,
  StockMovement,
} from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Interventions (FR-INT-1/3, US-2) : planification, réalisation (mouvements
 * de stock), lecture. Les règles (signe, quantités, choix du lot) viennent du
 * domaine ; ce dépôt résout les références et exécute en une transaction.
 */

const FALLBACK_PLACE = "Stock non localisé";

type Row = Record<string, unknown>;
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

async function readInterventions(tx: Tx, where: SQL, limit = 1000): Promise<Intervention[]> {
  const list = await rows<Row>(
    tx,
    sql`
      SELECT i.id, i.farm_id, i.procedure, i.status, i.started_at, i.stopped_at, i.origin, i.client_id,
             i.created_at, i.updated_at,
             coalesce(json_agg(json_build_object(
               'id', p.id, 'interventionId', p.intervention_id, 'role', p.role, 'refType', p.ref_type,
               'refId', p.ref_id, 'quantity', p.quantity, 'unit', p.unit,
               'workingZone', CASE WHEN p.working_zone IS NULL THEN NULL ELSE ST_AsGeoJSON(p.working_zone)::json END
             ) ORDER BY p.role, p.id) FILTER (WHERE p.id IS NOT NULL), '[]') AS parameters
      FROM interventions i
      LEFT JOIN intervention_parameters p ON p.intervention_id = i.id
      WHERE ${where}
      GROUP BY i.id
      ORDER BY coalesce(i.started_at, i.stopped_at, i.created_at), i.id
      LIMIT ${limit}`,
  );
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return list.map((r) => ({
    id: r.id as string,
    farmId: r.farm_id as string,
    procedure: r.procedure as string,
    status: r.status as Intervention["status"],
    startedAt: iso(r.started_at),
    stoppedAt: iso(r.stopped_at),
    origin: r.origin as Intervention["origin"],
    clientId: (r.client_id as string | null) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    parameters: (r.parameters as Intervention["parameters"]).map((p) => ({
      ...p,
      quantity: p.quantity === null ? null : Number(p.quantity),
      workingZone: p.workingZone ?? undefined,
    })),
  }));
}

export async function listInterventions(
  db: Database,
  farmId: string,
  q: { from: string; to: string; status?: "planned" | "done" },
): Promise<Intervention[]> {
  return withFarm(db, farmId, (tx) =>
    readInterventions(
      tx,
      sql`coalesce(i.started_at, i.stopped_at, i.created_at) >= ${q.from}::timestamptz
          AND coalesce(i.started_at, i.stopped_at, i.created_at) < ${q.to}::timestamptz
          ${q.status ? sql`AND i.status = ${q.status}` : sql``}`,
    ),
  );
}

async function readOne(tx: Tx, id: string): Promise<Intervention> {
  const [one] = await readInterventions(tx, sql`i.id = ${id}`, 1);
  if (!one) throw new NotFound(`Intervention ${id} introuvable.`);
  return one;
}

// ---------------------------------------------------------------------------
// Écriture des paramètres
// ---------------------------------------------------------------------------

async function insertParameters(tx: Tx, interventionId: string, params: InterventionParameterWrite[]) {
  for (const p of params) {
    if (p.refType === "land_parcel" && p.refId) {
      const ok = await rows(tx, sql`SELECT 1 FROM land_parcels WHERE id = ${p.refId}`);
      if (ok.length === 0) throw new BadRequest(`Parcelle cible ${p.refId} introuvable dans cette ferme.`);
    }
    await tx.execute(sql`
      INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit, working_zone)
      VALUES (${crypto.randomUUID()}, ${interventionId}, ${p.role}, ${p.refType}, ${p.refId ?? null},
              ${p.quantity ?? null}, ${p.unit ?? null},
              ${p.workingZone ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(p.workingZone)}), 4326)` : null})`);
  }
}

async function outbox(tx: Tx, farmId: string, event: ReturnType<typeof buildEvent>) {
  await tx.execute(sql`
    INSERT INTO outbox_events (id, farm_id, type, payload)
    VALUES (${event.id}, ${farmId}, ${event.type}, ${JSON.stringify(event)}::jsonb)`);
}

async function audit(tx: Tx, farmId: string, ctx: DomainCtx, entityId: string, action: string, diff: object) {
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
    VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'intervention', ${entityId}, ${action},
            ${JSON.stringify(diff)}::jsonb, ${ctx.now}::timestamptz)`);
}

// ---------------------------------------------------------------------------
// Planification
// ---------------------------------------------------------------------------

/**
 * Planifie une intervention. Idempotent sur `id` (fourni par le client,
 * UUID v7) : une seconde requête identique renvoie l'intervention existante.
 */
export async function planIntervention(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  input: InterventionPlanWrite,
  clientId: string | null = null,
): Promise<{ intervention: Intervention; created: boolean }> {
  return withFarm(db, farmId, async (tx) => {
    const id = input.id ?? ctx.newId();
    const existing = await rows(tx, sql`SELECT 1 FROM interventions WHERE id = ${id}`);
    if (existing.length > 0) return { intervention: await readOne(tx, id), created: false };
    await tx.execute(sql`
      INSERT INTO interventions (id, farm_id, procedure, status, started_at, origin, client_id)
      VALUES (${id}, ${farmId}, ${input.procedure}, 'planned', ${input.startedAt ?? null}, ${ctx.origin}, ${clientId})`);
    await insertParameters(tx, id, input.parameters);
    await audit(tx, farmId, ctx, id, "planned", { procedure: input.procedure, parameters: input.parameters.length });
    await outbox(tx, farmId, buildEvent(ctx, farmId, "intervention.planned", { interventionId: id }));
    return { intervention: await readOne(tx, id), created: true };
  });
}

// ---------------------------------------------------------------------------
// Réalisation
// ---------------------------------------------------------------------------

/** Surface traitée (ha) : zones de travail si présentes, sinon parcelles cibles à la date. */
async function treatedAreaHa(tx: Tx, interventionId: string, at: string): Promise<number | null> {
  const [r] = await rows<{ zones: number | null; parcels: number | null }>(
    tx,
    sql`
      SELECT
        (SELECT ST_Area(ST_Union(working_zone)::geography) / 10000 FROM intervention_parameters
          WHERE intervention_id = ${interventionId} AND working_zone IS NOT NULL) AS zones,
        (SELECT sum(v.area_m2) / 10000 FROM intervention_parameters p
           JOIN land_parcel_versions v ON v.land_parcel_id = p.ref_id AND v.valid @> ${at}::timestamptz
          WHERE p.intervention_id = ${interventionId} AND p.role = 'target' AND p.ref_type = 'land_parcel') AS parcels`,
  );
  const zones = r?.zones === null || r?.zones === undefined ? null : Number(r.zones);
  const parcels = r?.parcels === null || r?.parcels === undefined ? null : Number(r.parcels);
  return zones && zones > 0 ? zones : parcels;
}

async function fallbackPlace(tx: Tx, farmId: string, ctx: DomainCtx): Promise<string> {
  const [found] = await rows<{ id: string }>(tx, sql`SELECT id FROM places WHERE name = ${FALLBACK_PLACE} LIMIT 1`);
  if (found) return found.id;
  const id = ctx.newId();
  await tx.execute(sql`INSERT INTO places (id, farm_id, name) VALUES (${id}, ${farmId}, ${FALLBACK_PLACE})`);
  await tx.execute(sql`
    INSERT INTO place_versions (id, place_id, kind, source, valid)
    VALUES (${ctx.newId()}, ${id}, 'storage', 'manual', tstzrange('1900-01-01'::timestamptz, NULL))`);
  return id;
}

type Article = { id: string; name: string; unit: string };

async function articleOf(tx: Tx, p: InterventionParameterWrite): Promise<{ article: Article; lotId: string | null }> {
  if (!p.refId) throw new BadRequest(`Paramètre ${p.role} sans référence d'article ou de lot.`);
  if (p.refType === "lot") {
    const [r] = await rows<Article & { lot_id: string }>(
      tx,
      sql`SELECT a.id, a.name, a.unit, l.id AS lot_id FROM lots l JOIN articles a ON a.id = l.article_id WHERE l.id = ${p.refId}`,
    );
    if (!r) throw new BadRequest(`Lot ${p.refId} introuvable dans cette ferme.`);
    return { article: { id: r.id, name: r.name, unit: r.unit }, lotId: r.lot_id };
  }
  const [a] = await rows<Article>(tx, sql`SELECT id, name, unit FROM articles WHERE id = ${p.refId}`);
  if (!a) throw new BadRequest(`Article ${p.refId} introuvable dans cette ferme.`);
  return { article: a, lotId: null };
}

/** Stock disponible par lot (et meilleur emplacement) pour un article, à la date. */
async function availableLots(tx: Tx, articleId: string, at: string) {
  return rows<{ lot_id: string; place_id: string | null; container_id: string | null; available: number }>(
    tx,
    sql`
      SELECT m.lot_id, m.place_id, m.container_id, sum(m.quantity)::float8 AS available
      FROM stock_movements m JOIN lots l ON l.id = m.lot_id
      WHERE l.article_id = ${articleId} AND m.occurred_at <= ${at}::timestamptz
      GROUP BY m.lot_id, m.place_id, m.container_id`,
  );
}

async function defaultLot(tx: Tx, farmId: string, ctx: DomainCtx, article: Article): Promise<string> {
  const [found] = await rows<{ id: string }>(
    tx,
    sql`SELECT id FROM lots WHERE article_id = ${article.id} AND attrs->>'default' = 'true' LIMIT 1`,
  );
  if (found) return found.id;
  const id = ctx.newId();
  await tx.execute(sql`
    INSERT INTO lots (id, farm_id, article_id, code, attrs)
    VALUES (${id}, ${farmId}, ${article.id}, ${`${article.name} — sans lot`}, '{"default": true}'::jsonb)`);
  return id;
}

export interface CompletionResult {
  intervention: Intervention;
  movements: StockMovement[];
  warnings: string[];
}

export async function completeIntervention(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  interventionId: string,
  input: InterventionCompleteWrite,
): Promise<CompletionResult> {
  return withFarm(db, farmId, async (tx) => {
    const [current] = await rows<{ status: string }>(
      tx,
      sql`SELECT status FROM interventions WHERE id = ${interventionId} FOR UPDATE`,
    );
    if (!current) throw new NotFound(`Intervention ${interventionId} introuvable.`);
    if (current.status === "done") {
      throw new Conflict("Intervention déjà réalisée : la corriger plutôt que la réaliser à nouveau.");
    }

    // Les paramètres réels remplacent les paramètres planifiés.
    await tx.execute(sql`DELETE FROM intervention_parameters WHERE intervention_id = ${interventionId}`);
    await insertParameters(tx, interventionId, input.parameters);
    const areaHa = await treatedAreaHa(tx, interventionId, input.stoppedAt);

    const warnings: string[] = [];
    const lines: ResolvedStockLine[] = [];
    for (const p of input.parameters) {
      if ((p.role !== "input" && p.role !== "output") || (p.refType !== "article" && p.refType !== "lot")) continue;
      const { article, lotId: refLot } = await articleOf(tx, p);
      const quantity = toStockQuantity({
        quantity: p.quantity ?? null,
        unit: p.unit ?? null,
        articleUnit: article.unit,
        areaHa,
        absolute: p.stock?.quantity,
      });

      if (p.role === "input") {
        const lots = await availableLots(tx, article.id, input.stoppedAt);
        const byLot = new Map<string, number>();
        for (const l of lots) byLot.set(l.lot_id, (byLot.get(l.lot_id) ?? 0) + l.available);
        const lotId =
          refLot ??
          p.stock?.lotId ??
          pickLot([...byLot].map(([id, available]) => ({ lotId: id, available }))) ??
          (await defaultLot(tx, farmId, ctx, article));
        const best = lots.filter((l) => l.lot_id === lotId && l.available > 0).sort((a, b) => b.available - a.available)[0];
        const containerId = p.stock?.containerId ?? (p.stock?.placeId ? null : best?.container_id ?? null);
        const placeId =
          p.stock?.placeId ?? (containerId ? null : best?.place_id ?? (await fallbackPlace(tx, farmId, ctx)));
        const available = (byLot.get(lotId) ?? 0);
        if (available < quantity) {
          warnings.push(
            `${article.name} : ${quantity} ${article.unit} consommés pour ${Math.max(available, 0)} en stock — stock négatif (achats non encore synchronisés ?).`,
          );
        }
        lines.push({ role: "input", lotId, placeId, containerId, quantity, unit: article.unit });
      } else {
        const containerId = p.stock?.containerId ?? null;
        const placeId = p.stock?.placeId ?? null;
        if (!containerId && !placeId) {
          throw new DomainError(`Sortie « ${article.name} » sans lieu : préciser stock.containerId ou stock.placeId.`);
        }
        let lotId = refLot ?? p.stock?.lotId ?? null;
        if (!lotId) {
          lotId = ctx.newId();
          await tx.execute(sql`
            INSERT INTO lots (id, farm_id, article_id, code)
            VALUES (${lotId}, ${farmId}, ${article.id}, ${`${article.name} ${input.stoppedAt.slice(0, 10)}`})`);
        }
        lines.push({ role: "output", lotId, placeId, containerId, quantity, unit: article.unit });
      }
    }

    const plan = planInterventionCompletion(ctx, {
      farmId,
      interventionId,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      lines,
    });
    for (const m of plan.movements) {
      await tx.execute(sql`
        INSERT INTO stock_movements (id, farm_id, lot_id, place_id, container_id, quantity, unit, occurred_at, cause, intervention_id)
        VALUES (${m.id}, ${farmId}, ${m.lotId}, ${m.placeId}, ${m.containerId}, ${m.quantity}, ${m.unit},
                ${m.occurredAt}::timestamptz, ${m.cause}, ${interventionId})`);
    }
    await tx.execute(sql`
      UPDATE interventions SET status = 'done', started_at = ${input.startedAt}::timestamptz,
        stopped_at = ${input.stoppedAt}::timestamptz, updated_at = now()
      WHERE id = ${interventionId}`);
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
      VALUES (${plan.audit.id}, ${farmId}, ${plan.audit.actor}, ${plan.audit.origin}, ${plan.audit.entity},
              ${plan.audit.entityId}, ${plan.audit.action},
              ${JSON.stringify({ ...plan.audit.diff, areaHa, warnings })}::jsonb, ${plan.audit.at}::timestamptz)`);
    await outbox(tx, farmId, plan.event);
    // Mouvements signalés aussi pour la synchro Lyvre (quantités, pas de prix).
    for (const m of plan.movements) {
      await outbox(tx, farmId, buildEvent(ctx, farmId, "stock.moved", { movementId: m.id, lotId: m.lotId, quantity: m.quantity, unit: m.unit }));
    }
    return { intervention: await readOne(tx, interventionId), movements: plan.movements, warnings };
  });
}
