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
  diffIntervention,
  effectiveMovements,
  assertEditable,
  type DomainCtx,
  type ResolvedStockLine,
  dangerMessages,
  deriveNature,
} from "@fourmy/domain";
import {
  getProcedure,
  type ArticleKind,
  type Intervention,
  type InterventionCompleteWrite,
  type InterventionDetail,
  type InterventionHistoryEntry,
  type InterventionUpdateWrite,
  type InterventionPlanWrite,
  type StockMovement,
  type TargetKind,
  type TreatmentPurpose,
} from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";
import { checkCompliance, type CheckableBody } from "./phyto.js";
import { addReadingInTx } from "./equipments.js";

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
  const meters = new Map(
    ((r.meters as { equipment_id: string; value: string; correction: string | null; correction_reason: string | null }[]) ?? []).map((m) => [
      m.equipment_id,
      { value: Number(m.value), ...(m.correction ? { correction: m.correction as "fix" | "replacement", correctionReason: m.correction_reason } : {}) },
    ]),
  );
  const maint = r.maintenance as { nature?: string; problem?: string | null; workshop?: { name: string; reference?: string | null } | null } | null;
  const ops = (r.operations as { equipment_id: string; operation_id: string; label: string; kind: string; result: string; note: string | null }[]) ?? [];
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
        ...(p.ref_type === "equipment" && meters.has(p.ref_id!) ? { meter: meters.get(p.ref_id!)! } : {}),
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
          ...(a(p).equipmentId ? { equipmentId: a(p).equipmentId as string } : {}),
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
    tools: of("tool")
      .filter((p) => p.ref_type === "equipment")
      .map((p) => ({ equipmentId: p.ref_id!, ...(meters.has(p.ref_id!) ? { meter: meters.get(p.ref_id!)! } : {}) })),
    doers: of("doer").filter((p) => p.ref_type === "person").map((p) => ({ personId: p.ref_id! })),
    purposes: (r.purposes as TreatmentPurpose[]) ?? [],
    notes: (r.notes as string | null) ?? null,
    origin: r.origin as Intervention["origin"],
    clientId: (r.client_id as string | null) ?? null,
    compliance: (r.compliance as Intervention["compliance"]) ?? null,
    ift: (r.ift as Intervention["ift"]) ?? null,
    weather: (r.weather as Intervention["weather"]) ?? null,
    maintenance:
      maint || ops.length
        ? {
            nature: (maint?.nature as "preventive" | "corrective") ?? (ops.length ? "preventive" : "corrective"),
            problem: maint?.problem ?? null,
            workshop: maint?.workshop ?? null,
            operations: ops.map((o) => ({ equipmentId: o.equipment_id, operationId: o.operation_id, label: o.label, kind: o.kind, result: o.result as "done", note: o.note })),
          }
        : null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

async function readInterventions(tx: Tx, where: SQL, limit = 1000): Promise<Intervention[]> {
  const list = await rows<Record<string, unknown>>(
    tx,
    sql`
      SELECT i.id, i.farm_id, i.procedure, i.status, i.started_at, i.stopped_at, i.origin, i.client_id,
             i.purposes, i.notes, i.compliance, i.ift, i.weather, i.maintenance, i.created_at, i.updated_at,
             (SELECT coalesce(json_agg(json_build_object('equipment_id', m.equipment_id, 'value', m.value, 'correction', m.correction,
                                                         'correction_reason', m.correction_reason)), '[]')
                FROM meter_readings m WHERE m.intervention_id = i.id) AS meters,
             (SELECT coalesce(json_agg(json_build_object('equipment_id', io.equipment_id, 'operation_id', io.operation_id, 'label', eo.label,
                                                         'kind', eo.kind, 'result', io.result, 'note', io.note) ORDER BY eo.position), '[]')
                FROM intervention_operations io JOIN equipment_operations eo ON eo.id = io.operation_id
               WHERE io.intervention_id = i.id) AS operations,
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

/**
 * Bornes d'une campagne de la ferme (année) : celles de la table `campaigns`,
 * sinon l'année civile.
 */
export async function campaignWindow(db: Database, farmId: string, year: number): Promise<{ from: string; to: string }> {
  return withFarm(db, farmId, async (tx) => {
    const [c] = await rows<{ from: string; to: string }>(
      tx,
      sql`SELECT starts_on::text AS from, (stops_on + 1)::text AS to FROM campaigns WHERE year = ${year} ORDER BY starts_on LIMIT 1`,
    );
    const from = c?.from ?? `${year}-01-01`;
    const to = c?.to ?? `${year + 1}-01-01`;
    return { from: new Date(`${from}T00:00:00Z`).toISOString(), to: new Date(`${to}T00:00:00Z`).toISOString() };
  });
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
    await insert("input", "article", i.articleId, i.quantity, storedUnit(a.unit, i.per), {
      ...(i.lotId ? { lotId: i.lotId } : {}),
      ...(i.from ? { from: i.from } : {}),
      ...(i.equipmentId ? { equipmentId: i.equipmentId } : {}),
    });
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

/**
 * Entretien (lot K) : bloc (nature, problème, atelier), opérations du plan
 * réalisées, relevés de compteur. Les relevés n'existent que pour une
 * intervention réalisée ; ils sont recréés à chaque correction et contrôlés
 * comme un relevé saisi (FR-MAT-12, 409 si incohérent).
 */
async function writeMaintenance(tx: Tx, farmId: string, ctx: DomainCtx, interventionId: string, body: Body, done: boolean, at: string | null) {
  const m = body.maintenance;
  await tx.execute(sql`DELETE FROM intervention_operations WHERE intervention_id = ${interventionId}`);
  await tx.execute(sql`DELETE FROM meter_readings WHERE intervention_id = ${interventionId}`);
  await tx.execute(sql`
    UPDATE interventions SET maintenance = ${
      m ? JSON.stringify({ nature: m.nature ?? deriveNature(m.operations), problem: m.problem?.trim() || null, workshop: m.workshop ?? null }) : null
    }::jsonb WHERE id = ${interventionId}`);
  for (const o of m?.operations ?? []) {
    const [op] = await rows<{ id: string }>(tx, sql`SELECT id FROM equipment_operations WHERE id = ${o.operationId} AND equipment_id = ${o.equipmentId}`);
    if (!op) throw new BadRequest("Opération du plan inconnue pour ce matériel.");
    await tx.execute(sql`
      INSERT INTO intervention_operations (id, farm_id, intervention_id, equipment_id, operation_id, result, note)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${interventionId}, ${o.equipmentId}, ${o.operationId}, ${o.result}, ${o.note || null})
      ON CONFLICT (intervention_id, operation_id) DO UPDATE SET result = excluded.result, note = excluded.note`);
  }
  if (!done || !at) return;
  const meters = [
    ...body.targets.filter((t) => t.kind === "equipment" && t.meter).map((t) => ({ equipmentId: t.id, meter: t.meter! })),
    ...(body.tools ?? []).filter((t) => t.meter).map((t) => ({ equipmentId: t.equipmentId, meter: t.meter! })),
  ];
  for (const { equipmentId, meter } of meters) {
    await addReadingInTx(
      tx,
      farmId,
      ctx,
      equipmentId,
      { readAt: at, value: meter.value, correction: meter.correction ?? null, correctionReason: meter.correctionReason ?? null, origin: "manual" },
      { origin: "intervention", interventionId },
    );
  }
}

async function outbox(tx: Tx, farmId: string, event: ReturnType<typeof buildEvent>) {
  await tx.execute(sql`
    INSERT INTO outbox_events (id, farm_id, type, payload)
    VALUES (${event.id}, ${farmId}, ${event.type}, ${JSON.stringify(event)}::jsonb)`);
}

async function audit(tx: Tx, farmId: string, ctx: DomainCtx, entityId: string, action: string, diff: object) {
  await auditAs(tx, farmId, ctx, ctx.newId(), entityId, action, diff);
}

// ---------------------------------------------------------------------------
// Contrôle réglementaire (lot 2)
// ---------------------------------------------------------------------------

/**
 * Contrôle phyto de la saisie, enregistré avec l'intervention. Réalisation
 * saisie sur le web avec un feu rouge : refusée sans motif (« alerte +
 * motif »). Depuis le mobile (qui ne connaît pas encore les feux), la
 * réalisation est enregistrée et le feu rouge reste visible, sans motif.
 */
async function recordCompliance(tx: Tx, ctx: DomainCtx, interventionId: string, body: CheckableBody & { weather?: unknown }, mode: "plan" | "done") {
  // Météo saisie ou pré-remplie : enregistrée avec la saisie (sinon le worker la complète).
  if (body.weather) await tx.execute(sql`UPDATE interventions SET weather = ${JSON.stringify(body.weather)}::jsonb WHERE id = ${interventionId}`);
  const result = await checkCompliance(tx, body, interventionId);
  if (mode === "done" && result.level === "danger" && ctx.origin === "web" && !body.compliance?.reason?.trim()) {
    const dangers = dangerMessages(result);
    throw new DomainError(`Feu rouge réglementaire : ${dangers.join(" ")} Pour enregistrer quand même, indiquez un motif.`);
  }
  await tx.execute(sql`UPDATE interventions SET compliance = ${JSON.stringify(result)}::jsonb WHERE id = ${interventionId}`);
  return result;
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
  await writeMaintenance(tx, farmId, ctx, id, input, false, null);
  await recordCompliance(tx, ctx, id, input, "plan");
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
  if (current.status === "done") throw new Conflict("Intervention déjà réalisée : la modifier (correction tracée) plutôt que la réaliser à nouveau.");
  if (current.status === "cancelled") throw new Conflict("Intervention annulée.");

  const { plan, areaHa, warnings } = await applyCompletion(tx, farmId, ctx, interventionId, current.procedure, input);
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
    VALUES (${plan.audit.id}, ${farmId}, ${plan.audit.actor}, ${plan.audit.origin}, ${plan.audit.entity},
            ${plan.audit.entityId}, ${plan.audit.action},
            ${JSON.stringify({ ...plan.audit.diff, areaHa, warnings })}::jsonb, ${plan.audit.at}::timestamptz)`);
  await outbox(tx, farmId, plan.event);
  await stockEvents(tx, farmId, ctx, plan.movements);
  return { intervention: await readIntervention(tx, interventionId), movements: plan.movements, warnings };
}

/**
 * Écrit le corps d'une intervention réalisée et passe ses mouvements de stock
 * (réalisation, ou nouvelle version d'une correction). L'appelant écrit
 * l'audit et l'événement propres à son action.
 */
async function applyCompletion(
  tx: Tx,
  farmId: string,
  ctx: DomainCtx,
  interventionId: string,
  procedure: string,
  input: InterventionCompleteWrite,
) {
  const articles = await validate(tx, procedure, input, "complete");
  const { startedAt, stoppedAt } = periodBounds(input.periods);
  await writeBody(tx, interventionId, input, articles);
  await writeMaintenance(tx, farmId, ctx, interventionId, input, true, stoppedAt);
  await recordCompliance(tx, ctx, interventionId, { ...input, procedure }, "done");
  // Contenu (re)écrit : l'IFT sera recalculé (worker, ou à la demande depuis la fiche).
  await tx.execute(sql`UPDATE interventions SET ift = NULL WHERE id = ${interventionId}`);
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
  await insertMovements(tx, farmId, interventionId, plan.movements);
  await tx.execute(sql`
    UPDATE interventions SET status = 'done', procedure = ${procedure},
      started_at = ${startedAt}::timestamptz, stopped_at = ${stoppedAt}::timestamptz,
      purposes = ${sql`ARRAY[${sql.join(input.purposes.map((p) => sql`${p}`), sql`, `)}]::text[]`},
      notes = ${input.notes ?? null}, updated_at = now()
    WHERE id = ${interventionId}`);
  return { plan, areaHa, warnings };
}

async function insertMovements(tx: Tx, farmId: string, interventionId: string, movements: StockMovement[]) {
  for (const m of movements) {
    await tx.execute(sql`
      INSERT INTO stock_movements (id, farm_id, lot_id, place_id, container_id, quantity, unit, occurred_at, cause, intervention_id)
      VALUES (${m.id}, ${farmId}, ${m.lotId}, ${m.placeId}, ${m.containerId}, ${m.quantity}, ${m.unit},
              ${m.occurredAt}::timestamptz, ${m.cause}, ${interventionId})`);
  }
}

async function stockEvents(tx: Tx, farmId: string, ctx: DomainCtx, movements: StockMovement[]) {
  for (const m of movements) {
    await outbox(tx, farmId, buildEvent(ctx, farmId, "stock.moved", { movementId: m.id, lotId: m.lotId, quantity: m.quantity, unit: m.unit }));
  }
}

/**
 * Contre-passe les mouvements encore en vigueur d'une intervention (solde net :
 * une intervention déjà corrigée n'est pas contre-passée deux fois).
 */
async function reverseMovements(tx: Tx, farmId: string, ctx: DomainCtx, interventionId: string) {
  const all = (
    await rows<StockMovement & { occurredAt: string; createdAt: string }>(
      tx,
      sql`SELECT id, farm_id AS "farmId", lot_id AS "lotId", place_id AS "placeId", container_id AS "containerId",
                 quantity::float8 AS quantity, unit, occurred_at AS "occurredAt", cause,
                 intervention_id AS "interventionId", created_at AS "createdAt"
          FROM stock_movements WHERE intervention_id = ${interventionId}`,
    )
  ).map((m) => ({ ...m, occurredAt: iso(m.occurredAt)!, createdAt: iso(m.createdAt)! }));
  const plan = planCorrection(ctx, farmId, interventionId, effectiveMovements(all));
  await insertMovements(tx, farmId, interventionId, plan.movements);
  return plan;
}

// ---------------------------------------------------------------------------
// Modification et correction tracée
// ---------------------------------------------------------------------------

/** Alerte si l'intervention tombe dans une campagne close (non bloquant). */
async function closedCampaignWarning(tx: Tx, ctx: DomainCtx, dates: (string | null)[]): Promise<string[]> {
  const days = [...new Set(dates.filter((d): d is string => !!d).map((d) => d.slice(0, 10)))];
  if (days.length === 0) return [];
  const closed = await rows<{ year: number }>(
    tx,
    sql`SELECT DISTINCT year FROM campaigns
        WHERE stops_on < ${ctx.now.slice(0, 10)}::date
          AND (${sql.join(days.map((d) => sql`${d}::date BETWEEN starts_on AND stops_on`), sql` OR `)})
        ORDER BY year`,
  );
  return closed.map((c) => `Campagne ${c.year} close : la modification change un historique déjà clos.`);
}

/**
 * Modifie une intervention. Planifiée : mise à jour directe. Réalisée :
 * correction tracée — le solde de ses mouvements est contre-passé, la
 * nouvelle version est passée, l'historique garde l'avant et l'après.
 * Annulée : refusée. Idempotent sur `correctionId`.
 */
export async function updateIntervention(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  interventionId: string,
  input: InterventionUpdateWrite,
): Promise<{ intervention: Intervention; warnings: string[] }> {
  return withFarm(db, farmId, async (tx) => {
    const [current] = await rows<{ status: Intervention["status"] }>(
      tx,
      sql`SELECT status FROM interventions WHERE id = ${interventionId} FOR UPDATE`,
    );
    if (!current) throw new NotFound(`Intervention ${interventionId} introuvable.`);
    if (input.correctionId) {
      const replay = await rows(tx, sql`SELECT 1 FROM audit_log WHERE id = ${input.correctionId} AND entity_id = ${interventionId}`);
      if (replay.length) return { intervention: await readIntervention(tx, interventionId), warnings: [] };
    }
    if (current.status === "cancelled") throw new Conflict("Intervention annulée : elle ne se modifie plus.");
    assertEditable(current.status);

    const before = await readIntervention(tx, interventionId);
    const changes = diffIntervention(before, { ...input, notes: input.notes ?? null });
    const warnings = await closedCampaignWarning(tx, ctx, [before.startedAt, before.stoppedAt, ...input.periods.map((p) => p.stoppedAt)]);
    const auditId = input.correctionId ?? ctx.newId();
    const reason = input.reason || null;

    if (current.status === "planned") {
      const articles = await validate(tx, input.procedure, input, "plan");
      const bounds = periodBounds(input.periods);
      await writeBody(tx, interventionId, input, articles);
      await writeMaintenance(tx, farmId, ctx, interventionId, input, false, null);
      await recordCompliance(tx, ctx, interventionId, input, "plan");
      await tx.execute(sql`
        UPDATE interventions SET procedure = ${input.procedure},
          started_at = ${bounds.startedAt ?? input.plannedAt ?? before.startedAt}, stopped_at = ${bounds.stoppedAt},
          purposes = ${sql`ARRAY[${sql.join(input.purposes.map((p) => sql`${p}`), sql`, `)}]::text[]`},
          notes = ${input.notes ?? null}, updated_at = now()
        WHERE id = ${interventionId}`);
      await auditAs(tx, farmId, ctx, auditId, interventionId, "updated", { changes, reason, warnings });
      await outbox(tx, farmId, buildEvent(ctx, farmId, "intervention.updated", { interventionId }));
      return { intervention: await readIntervention(tx, interventionId), warnings };
    }

    // Réalisée : correction tracée.
    if (input.periods.length === 0) throw new DomainError("Au moins une période de travail.");
    const reversal = await reverseMovements(tx, farmId, ctx, interventionId);
    const { plan, areaHa, warnings: stockWarnings } = await applyCompletion(tx, farmId, ctx, interventionId, input.procedure, input);
    warnings.push(...stockWarnings);
    await auditAs(tx, farmId, ctx, auditId, interventionId, "corrected", {
      changes,
      reason,
      warnings,
      areaHa,
      reversed: reversal.movements.length,
      movements: plan.movements.length,
    });
    await outbox(tx, farmId, reversal.event);
    await stockEvents(tx, farmId, ctx, [...reversal.movements, ...plan.movements]);
    return { intervention: await readIntervention(tx, interventionId), warnings };
  });
}

async function auditAs(tx: Tx, farmId: string, ctx: DomainCtx, id: string, entityId: string, action: string, diff: object) {
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
    VALUES (${id}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'intervention', ${entityId}, ${action},
            ${JSON.stringify(diff)}::jsonb, ${ctx.now}::timestamptz)`);
}

// ---------------------------------------------------------------------------
// Fiche : intervention + historique
// ---------------------------------------------------------------------------

export async function readInterventionDetail(db: Database, farmId: string, id: string): Promise<InterventionDetail> {
  return withFarm(db, farmId, async (tx) => {
    const intervention = await readIntervention(tx, id);
    const log = await rows<{ id: string; at: string; action: string; actor: string; actor_name: string | null; origin: string; diff: Record<string, unknown> }>(
      tx,
      sql`SELECT a.id, a.at, a.action, a.actor, u.name AS actor_name, a.origin, a.diff
          FROM audit_log a LEFT JOIN users u ON u.id::text = a.actor
          WHERE a.entity = 'intervention' AND a.entity_id = ${id}
          ORDER BY a.at, a.id`,
    );
    const history: InterventionHistoryEntry[] = log.map((r) => ({
      id: r.id,
      at: iso(r.at)!,
      action: r.action,
      actor: r.actor,
      actorName: r.actor_name,
      origin: r.origin,
      reason: typeof r.diff?.reason === "string" ? r.diff.reason : null,
      changes: (r.diff?.changes as InterventionHistoryEntry["changes"]) ?? null,
    }));
    return { ...intervention, history };
  });
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
      const plan = await reverseMovements(tx, farmId, ctx, interventionId);
      await outbox(tx, farmId, plan.event);
      await stockEvents(tx, farmId, ctx, plan.movements);
    }
    await tx.execute(sql`UPDATE interventions SET status = 'cancelled', updated_at = now() WHERE id = ${interventionId}`);
    // Ses relevés de compteur disparaissent avec elle ; ses opérations ne comptent plus (annulée).
    await tx.execute(sql`DELETE FROM meter_readings WHERE intervention_id = ${interventionId}`);
    await audit(tx, farmId, ctx, interventionId, "cancelled", { reason, previousStatus: current.status });
    return readIntervention(tx, interventionId);
  });
}
