import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  planInterventionCompletion,
  planCorrection,
  toStockQuantity,
  pickLot,
  buildEvent,
  validateIntervention,
  periodBounds,
  storedUnit,
  splitUnit,
  DomainError,
  type DomainCtx,
  type ResolvedStockLine,
} from "@fourmy/domain";
import {
  getProcedure,
  type ArticleKind,
  type Intervention,
  type InterventionCompleteWrite,
  type InterventionPlanWrite,
  type StockMovement,
  type TargetKind,
  type TreatmentPurpose,
} from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Interventions (docs/interventions.md). L'API parle la forme structurée
 * (périodes, cibles, intrants, sorties, matériels, personnes, motifs) ; la
 * base garde une ligne par rôle. Les règles de forme viennent du domaine,
 * identiques sur le web et le mobile.
 */

const FALLBACK_PLACE = "Stock non localisé";
const TARGET_KINDS: TargetKind[] = ["land_parcel", "equipment", "place", "container"];

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

type Body = Omit<InterventionCompleteWrite, "periods"> & { periods: InterventionCompleteWrite["periods"] };

// ---------------------------------------------------------------------------
// Lecture : lignes par rôle → forme structurée
// ---------------------------------------------------------------------------

type ParamRow = {
  role: string;
  ref_type: string;
  ref_id: string | null;
  quantity: string | null;
  unit: string | null;
  working_zone: unknown;
  attrs: Record<string, unknown> | null;
};

function toIntervention(r: Record<string, unknown>): Intervention {
  const params = (r.parameters as ParamRow[]) ?? [];
  const periods = ((r.periods as { startedAt: string; stoppedAt: string }[]) ?? []).map((p) => ({
    startedAt: iso(p.startedAt)!,
    stoppedAt: iso(p.stoppedAt)!,
  }));
  const of = (role: string) => params.filter((p) => p.role === role && p.ref_id);
  const a = (p: ParamRow) => p.attrs ?? {};
  return {
    id: r.id as string,
    farmId: r.farm_id as string,
    procedure: r.procedure as string,
    status: r.status as Intervention["status"],
    startedAt: iso(r.started_at),
    stoppedAt: iso(r.stopped_at),
    periods,
    targets: of("target")
      .filter((p) => TARGET_KINDS.includes(p.ref_type as TargetKind))
      .map((p) => ({
        kind: p.ref_type as TargetKind,
        id: p.ref_id!,
        ...(typeof a(p).workedAreaM2 === "number" ? { workedAreaM2: a(p).workedAreaM2 as number } : {}),
        ...(p.working_zone ? { workingZone: p.working_zone as never } : {}),
      })),
    inputs: of("input")
      .filter((p) => p.ref_type === "article" && p.quantity !== null)
      .map((p) => {
        const { unit, per } = splitUnit(p.unit);
        return {
          articleId: p.ref_id!,
          quantity: Number(p.quantity),
          per,
          unit,
          ...(a(p).lotId ? { lotId: a(p).lotId as string } : {}),
          ...(a(p).from ? { from: a(p).from as never } : {}),
        };
      }),
    outputs: of("output")
      .filter((p) => p.ref_type === "article" && p.quantity !== null)
      .map((p) => {
        const { unit, per } = splitUnit(p.unit);
        return {
          articleId: p.ref_id!,
          quantity: Number(p.quantity),
          per,
          unit,
          ...(a(p).lotId ? { lotId: a(p).lotId as string } : {}),
          ...(a(p).to ? { to: a(p).to as never } : {}),
        };
      }),
    tools: of("tool").filter((p) => p.ref_type === "equipment").map((p) => ({ equipmentId: p.ref_id! })),
    doers: of("doer").filter((p) => p.ref_type === "person").map((p) => ({ personId: p.ref_id! })),
    purposes: (r.purposes as TreatmentPurpose[]) ?? [],
    notes: (r.notes as string | null) ?? null,
    origin: r.origin as Intervention["origin"],
    clientId: (r.client_id as string | null) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

async function readInterventions(tx: Tx, where: SQL, limit = 1000): Promise<Intervention[]> {
  const list = await rows<Record<string, unknown>>(
    tx,
    sql`
      SELECT i.id, i.farm_id, i.procedure, i.status, i.started_at, i.stopped_at, i.origin, i.client_id,
             i.purposes, i.notes, i.created_at, i.updated_at,
             (SELECT coalesce(json_agg(json_build_object('startedAt', w.started_at, 'stoppedAt', w.stopped_at)
                        ORDER BY w.started_at), '[]') FROM intervention_periods w WHERE w.intervention_id = i.id) AS periods,
             (SELECT coalesce(json_agg(json_build_object(
                 'role', p.role, 'ref_type', p.ref_type, 'ref_id', p.ref_id, 'quantity', p.quantity, 'unit', p.unit,
                 'attrs', p.attrs,
                 'working_zone', CASE WHEN p.working_zone IS NULL THEN NULL ELSE ST_AsGeoJSON(p.working_zone)::json END
               ) ORDER BY p.role, p.id), '[]') FROM intervention_parameters p WHERE p.intervention_id = i.id) AS parameters
      FROM interventions i
      WHERE ${where}
      ORDER BY coalesce(i.started_at, i.stopped_at, i.created_at), i.id
      LIMIT ${limit}`,
  );
  return list.map(toIntervention);
}

/** Lecture structurée selon un filtre SQL (synchro mobile). */
export const readInterventionsWhere = readInterventions;

export async function listInterventions(
  db: Database,
  farmId: string,
  q: { from: string; to: string; status?: Intervention["status"] },
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

export async function readIntervention(tx: Tx, id: string): Promise<Intervention> {
  const [one] = await readInterventions(tx, sql`i.id = ${id}`, 1);
  if (!one) throw new NotFound(`Intervention ${id} introuvable.`);
  return one;
}

// ---------------------------------------------------------------------------
// Validation : existence des références + règles de forme du domaine
// ---------------------------------------------------------------------------

type Article = { id: string; name: string; unit: string; kind: ArticleKind };

async function loadArticles(tx: Tx, ids: string[]): Promise<Map<string, Article>> {
  if (ids.length === 0) return new Map();
  const list = await rows<Article>(
    tx,
    sql`SELECT id, name, unit, kind FROM articles WHERE id IN (${sql.join([...new Set(ids)].map((i) => sql`${i}`), sql`, `)})`,
  );
  return new Map(list.map((a) => [a.id, a]));
}

async function assertExist(tx: Tx, table: "land_parcels" | "equipments" | "places" | "containers" | "people", ids: string[], label: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await rows<{ id: string }>(
    tx,
    sql`SELECT id FROM ${sql.raw(table)} WHERE id IN (${sql.join(unique.map((i) => sql`${i}`), sql`, `)})`,
  );
  const missing = unique.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw new BadRequest(`${label} introuvable dans cette ferme : ${missing.join(", ")}`);
}

const TABLE_OF: Record<TargetKind, "land_parcels" | "equipments" | "places" | "containers"> = {
  land_parcel: "land_parcels",
  equipment: "equipments",
  place: "places",
  container: "containers",
};

async function validate(tx: Tx, procedureCode: string, body: Body, mode: "plan" | "complete") {
  const articles = await loadArticles(tx, [...body.inputs.map((i) => i.articleId), ...body.outputs.map((o) => o.articleId)]);
  const errors = validateIntervention(getProcedure(procedureCode), body, mode, {
    articleKind: (id) => articles.get(id)?.kind,
  });
  if (errors.length) throw new DomainError(errors.join(" "));
  for (const kind of TARGET_KINDS) {
    await assertExist(tx, TABLE_OF[kind], body.targets.filter((t) => t.kind === kind).map((t) => t.id), "Cible");
  }
  await assertExist(tx, "equipments", body.tools.map((t) => t.equipmentId), "Matériel");
  await assertExist(tx, "people", body.doers.map((d) => d.personId), "Personne");
  return articles;
}

// ---------------------------------------------------------------------------
// Écriture : forme structurée → lignes par rôle
// ---------------------------------------------------------------------------

async function writeBody(tx: Tx, interventionId: string, body: Body, articles: Map<string, Article>) {
  await tx.execute(sql`DELETE FROM intervention_parameters WHERE intervention_id = ${interventionId}`);
  await tx.execute(sql`DELETE FROM intervention_periods WHERE intervention_id = ${interventionId}`);
  const insert = (role: string, refType: string, refId: string, quantity: number | null, unit: string | null, attrs: object | null, zone?: unknown) =>
    tx.execute(sql`
      INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit, attrs, working_zone)
      VALUES (${crypto.randomUUID()}, ${interventionId}, ${role}, ${refType}, ${refId}, ${quantity}, ${unit},
              ${attrs && Object.keys(attrs).length ? JSON.stringify(attrs) : null}::jsonb,
              ${zone ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(zone)}), 4326)` : null})`);
  for (const t of body.targets) {
    await insert("target", t.kind, t.id, null, null, t.workedAreaM2 ? { workedAreaM2: t.workedAreaM2 } : null, t.workingZone);
  }
  for (const i of body.inputs) {
    const a = articles.get(i.articleId)!;
    await insert("input", "article", i.articleId, i.quantity, storedUnit(a.unit, i.per), { ...(i.lotId ? { lotId: i.lotId } : {}), ...(i.from ? { from: i.from } : {}) });
  }
  for (const o of body.outputs) {
    const a = articles.get(o.articleId)!;
    await insert("output", "article", o.articleId, o.quantity, storedUnit(a.unit, o.per), { ...(o.lotId ? { lotId: o.lotId } : {}), ...(o.to ? { to: o.to } : {}) });
  }
  for (const t of body.tools) await insert("tool", "equipment", t.equipmentId, null, null, null);
  for (const d of body.doers) await insert("doer", "person", d.personId, null, null, null);
  for (const p of body.periods) {
    await tx.execute(sql`
      INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at)
      VALUES (${crypto.randomUUID()}, ${interventionId}, ${p.startedAt}::timestamptz, ${p.stoppedAt}::timestamptz)`);
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

export async function planInTx(
  tx: Tx,
  farmId: string,
  ctx: DomainCtx,
  input: InterventionPlanWrite,
  clientId: string | null = null,
): Promise<{ intervention: Intervention; created: boolean }> {
  const id = input.id ?? ctx.newId();
  const existing = await rows(tx, sql`SELECT 1 FROM interventions WHERE id = ${id}`);
  if (existing.length > 0) return { intervention: await readIntervention(tx, id), created: false };
  const articles = await validate(tx, input.procedure, input, "plan");
  const bounds = periodBounds(input.periods);
  await tx.execute(sql`
    INSERT INTO interventions (id, farm_id, procedure, status, started_at, stopped_at, origin, client_id, purposes, notes)
    VALUES (${id}, ${farmId}, ${input.procedure}, 'planned', ${bounds.startedAt ?? input.plannedAt ?? null}, ${bounds.stoppedAt},
            ${ctx.origin}, ${clientId}, ${sql`ARRAY[${sql.join(input.purposes.map((p) => sql`${p}`), sql`, `)}]::text[]`}, ${input.notes ?? null})`);
  await writeBody(tx, id, input, articles);
  await audit(tx, farmId, ctx, id, "planned", { procedure: input.procedure });
  await outbox(tx, farmId, buildEvent(ctx, farmId, "intervention.planned", { interventionId: id }));
  return { intervention: await readIntervention(tx, id), created: true };
}

/** Planifie une intervention. Idempotent sur `id` (UUID client). */
export async function planIntervention(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  input: InterventionPlanWrite,
  clientId: string | null = null,
): Promise<{ intervention: Intervention; created: boolean }> {
  return withFarm(db, farmId, (tx) => planInTx(tx, farmId, ctx, input, clientId));
}

// ---------------------------------------------------------------------------
// Réalisation
// ---------------------------------------------------------------------------

/**
 * Surface traitée (ha), cible par cible : surface saisie, sinon zone de
 * travail, sinon surface de la parcelle à la date.
 */
async function treatedAreaHa(tx: Tx, body: Body, at: string): Promise<number | null> {
  let total = 0;
  let any = false;
  for (const t of body.targets.filter((x) => x.kind === "land_parcel")) {
    if (t.workedAreaM2) {
      total += t.workedAreaM2;
      any = true;
      continue;
    }
    const [r] = await rows<{ zone: number | null; parcel: number | null }>(
      tx,
      sql`SELECT
            ${t.workingZone ? sql`ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(t.workingZone)}), 4326)::geography)` : sql`NULL`}::float8 AS zone,
            (SELECT area_m2::float8 FROM land_parcel_versions WHERE land_parcel_id = ${t.id} AND valid @> ${at}::timestamptz) AS parcel`,
    );
    const area = r?.zone ?? r?.parcel ?? null;
    if (area !== null) {
      total += area;
      any = true;
    }
  }
  return any ? total / 10_000 : null;
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
  return withFarm(db, farmId, (tx) => completeInTx(tx, farmId, ctx, interventionId, input));
}

export async function completeInTx(
  tx: Tx,
  farmId: string,
  ctx: DomainCtx,
  interventionId: string,
  input: InterventionCompleteWrite,
): Promise<CompletionResult> {
  const [current] = await rows<{ status: string; procedure: string }>(
    tx,
    sql`SELECT status, procedure FROM interventions WHERE id = ${interventionId} FOR UPDATE`,
  );
  if (!current) throw new NotFound(`Intervention ${interventionId} introuvable.`);
  if (current.status === "done") throw new Conflict("Intervention déjà réalisée : l'annuler puis la ressaisir, plutôt que la réaliser à nouveau.");
  if (current.status === "cancelled") throw new Conflict("Intervention annulée.");

  const articles = await validate(tx, current.procedure, input, "complete");
  const { startedAt, stoppedAt } = periodBounds(input.periods);
  await writeBody(tx, interventionId, input, articles);
  const areaHa = await treatedAreaHa(tx, input, stoppedAt!);

  const warnings: string[] = [];
  const lines: ResolvedStockLine[] = [];
  for (const i of input.inputs) {
    const article = articles.get(i.articleId)!;
    const quantity = toStockQuantity({ quantity: i.quantity, unit: storedUnit(article.unit, i.per), articleUnit: article.unit, areaHa });
    const lots = await availableLots(tx, article.id, stoppedAt!);
    const byLot = new Map<string, number>();
    for (const l of lots) byLot.set(l.lot_id, (byLot.get(l.lot_id) ?? 0) + l.available);
    const lotId = i.lotId ?? pickLot([...byLot].map(([id, available]) => ({ lotId: id, available }))) ?? (await defaultLot(tx, farmId, ctx, article));
    const best = lots.filter((l) => l.lot_id === lotId && l.available > 0).sort((a, b) => b.available - a.available)[0];
    const containerId = i.from?.containerId ?? (i.from?.placeId ? null : best?.container_id ?? null);
    const placeId = i.from?.placeId ?? (containerId ? null : best?.place_id ?? (await fallbackPlace(tx, farmId, ctx)));
    const available = byLot.get(lotId) ?? 0;
    if (available < quantity) {
      warnings.push(
        `${article.name} : ${Math.round(quantity * 1000) / 1000} ${article.unit} consommés pour ${Math.max(Math.round(available * 1000) / 1000, 0)} en stock — stock négatif (achats non encore synchronisés ?).`,
      );
    }
    lines.push({ role: "input", lotId, placeId, containerId, quantity, unit: article.unit });
  }
  for (const o of input.outputs) {
    const article = articles.get(o.articleId)!;
    const quantity = toStockQuantity({ quantity: o.quantity, unit: storedUnit(article.unit, o.per), articleUnit: article.unit, areaHa });
    let lotId = o.lotId ?? null;
    if (!lotId) {
      lotId = ctx.newId();
      await tx.execute(sql`
        INSERT INTO lots (id, farm_id, article_id, code)
        VALUES (${lotId}, ${farmId}, ${article.id}, ${`${article.name} ${stoppedAt!.slice(0, 10)}`})`);
    }
    lines.push({ role: "output", lotId, placeId: o.to?.placeId ?? null, containerId: o.to?.containerId ?? null, quantity, unit: article.unit });
  }

  const plan = planInterventionCompletion(ctx, { farmId, interventionId, startedAt: startedAt!, stoppedAt: stoppedAt!, lines });
  for (const m of plan.movements) {
    await tx.execute(sql`
      INSERT INTO stock_movements (id, farm_id, lot_id, place_id, container_id, quantity, unit, occurred_at, cause, intervention_id)
      VALUES (${m.id}, ${farmId}, ${m.lotId}, ${m.placeId}, ${m.containerId}, ${m.quantity}, ${m.unit},
              ${m.occurredAt}::timestamptz, ${m.cause}, ${interventionId})`);
  }
  await tx.execute(sql`
    UPDATE interventions SET status = 'done', started_at = ${startedAt}::timestamptz, stopped_at = ${stoppedAt}::timestamptz,
      purposes = ${sql`ARRAY[${sql.join(input.purposes.map((p) => sql`${p}`), sql`, `)}]::text[]`},
      notes = ${input.notes ?? null}, updated_at = now()
    WHERE id = ${interventionId}`);
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
    VALUES (${plan.audit.id}, ${farmId}, ${plan.audit.actor}, ${plan.audit.origin}, ${plan.audit.entity},
            ${plan.audit.entityId}, ${plan.audit.action},
            ${JSON.stringify({ ...plan.audit.diff, areaHa, warnings })}::jsonb, ${plan.audit.at}::timestamptz)`);
  await outbox(tx, farmId, plan.event);
  for (const m of plan.movements) {
    await outbox(tx, farmId, buildEvent(ctx, farmId, "stock.moved", { movementId: m.id, lotId: m.lotId, quantity: m.quantity, unit: m.unit }));
  }
  return { intervention: await readIntervention(tx, interventionId), movements: plan.movements, warnings };
}

// ---------------------------------------------------------------------------
// Annulation
// ---------------------------------------------------------------------------

/**
 * Annule une intervention : planifiée → simplement annulée ; réalisée → ses
 * mouvements de stock sont contre-passés (jamais modifiés), motif obligatoire.
 */
export async function cancelIntervention(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  interventionId: string,
  reason: string,
): Promise<Intervention> {
  return withFarm(db, farmId, async (tx) => {
    const [current] = await rows<{ status: string }>(tx, sql`SELECT status FROM interventions WHERE id = ${interventionId} FOR UPDATE`);
    if (!current) throw new NotFound(`Intervention ${interventionId} introuvable.`);
    if (current.status === "cancelled") throw new Conflict("Intervention déjà annulée.");
    if (current.status === "done") {
      const original = (
        await rows<StockMovement & { occurredAt: string; createdAt: string }>(
          tx,
          sql`SELECT id, farm_id AS "farmId", lot_id AS "lotId", place_id AS "placeId", container_id AS "containerId",
                     quantity::float8 AS quantity, unit, occurred_at AS "occurredAt", cause,
                     intervention_id AS "interventionId", created_at AS "createdAt"
              FROM stock_movements WHERE intervention_id = ${interventionId} AND cause = 'intervention'`,
        )
      ).map((m) => ({ ...m, occurredAt: iso(m.occurredAt)!, createdAt: iso(m.createdAt)! }));
      const plan = planCorrection(ctx, farmId, interventionId, original);
      for (const m of plan.movements) {
        await tx.execute(sql`
          INSERT INTO stock_movements (id, farm_id, lot_id, place_id, container_id, quantity, unit, occurred_at, cause, intervention_id)
          VALUES (${m.id}, ${farmId}, ${m.lotId}, ${m.placeId}, ${m.containerId}, ${m.quantity}, ${m.unit},
                  ${m.occurredAt}::timestamptz, ${m.cause}, ${interventionId})`);
      }
      await outbox(tx, farmId, plan.event);
    }
    await tx.execute(sql`UPDATE interventions SET status = 'cancelled', updated_at = now() WHERE id = ${interventionId}`);
    await audit(tx, farmId, ctx, interventionId, "cancelled", { reason, previousStatus: current.status });
    return readIntervention(tx, interventionId);
  });
}
