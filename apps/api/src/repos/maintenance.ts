import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { compareDues, computeDue, partsForecast, usageAt, usageSeries, type Completion, type DomainCtx, type ForecastOperation, type UsageDay, type UsagePoint } from "@fourmy/domain";
import { usageDaysOf } from "./usage.js";
import type {
  EquipmentMaintenance,
  FarmDueItem,
  MaintenanceSettings,
  PartsToOrder,
  PlanOperation,
  PlanOperationWrite,
} from "@fourmy/contracts";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { normName } from "./equipments.js";
import { optionCode, optionLabel, optionLabelByCode, parseEquipmentBundle, type EquipmentBundle } from "./equipment-bundle.js";

/**
 * Plan d'entretien, lot J (docs/materiels-entretien-design.md) : catalogue
 * des modèles, plan de la ferme, échéances calculées (domaine), tableau de
 * bord, import de la base matériel.
 */
const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function audit(tx: Tx, farmId: string, ctx: DomainCtx, entity: string, entityId: string, action: string, diff: object) {
  await tx.execute(sql`
    INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff)
    VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, ${entity}, ${entityId}, ${action}, ${JSON.stringify(diff)}::jsonb)`);
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: MaintenanceSettings = { soonHours: 50, soonMonths: 1, notify: [] };

async function settingsTx(tx: Tx): Promise<MaintenanceSettings> {
  const [s] = await rows<{ maintenance: MaintenanceSettings }>(tx, sql`SELECT maintenance FROM farm_settings`);
  return { ...DEFAULT_SETTINGS, ...(s?.maintenance ?? {}) };
}

export async function getSettings(db: Database, farmId: string): Promise<MaintenanceSettings> {
  return withFarm(db, farmId, settingsTx);
}

export async function putSettings(db: Database, farmId: string, body: MaintenanceSettings): Promise<MaintenanceSettings> {
  return withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, maintenance) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET maintenance = excluded.maintenance, updated_at = now()`);
    return settingsTx(tx);
  });
}

// ---------------------------------------------------------------------------
// Lecture du plan et des échéances
// ---------------------------------------------------------------------------

type OpRow = Record<string, unknown>;
const toOp = (r: OpRow): Omit<PlanOperation, "parts"> => ({
  id: r.id as string,
  code: (r.code as string) ?? null,
  label: r.label as string,
  kind: r.kind as PlanOperation["kind"],
  everyHours: num(r.every_hours),
  everyMonths: num(r.every_months),
  firstHours: num(r.first_hours),
  performer: r.performer as PlanOperation["performer"],
  requiresOption: (r.requires_option as string) ?? null,
  condition: (r.condition as string) ?? null,
  source: (r.source as PlanOperation["source"]) ?? null,
  baselineAt: iso(r.baseline_at),
  baselineHours: num(r.baseline_hours),
  archivedAt: iso(r.archived_at),
  archivedReason: (r.archived_reason as string) ?? null,
  fromModel: r.model_operation_id !== null && r.model_operation_id !== undefined,
});

/** Données de calcul des échéances d'un ensemble de matériels. */
async function dueInputs(tx: Tx, equipmentIds: string[]) {
  if (!equipmentIds.length) {
    return {
      readings: new Map<string, UsagePoint[]>(),
      options: new Map<string, { code: string; from: string; to: string | null }[]>(),
      completions: [] as Completion[],
      usageDays: new Map<string, UsageDay[]>(),
    };
  }
  const ids = sql.join(
    equipmentIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const readings = await rows<{ id: string; equipment_id: string; read_at: string; value: string; correction: string | null }>(
    tx,
    sql`SELECT id, equipment_id, read_at, value, correction FROM meter_readings WHERE equipment_id IN (${ids})`,
  );
  const options = await rows<{ equipment_id: string; code: string; from: string; to: string | null }>(
    tx,
    sql`SELECT equipment_id, code, lower(valid) AS "from", upper(valid) AS "to" FROM equipment_options WHERE equipment_id IN (${ids})`,
  );
  const byEq = <T extends { equipment_id: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.equipment_id, [...(m.get(r.equipment_id) ?? []), r]);
    return m;
  };
  const rm = byEq(readings);
  const series = new Map(
    equipmentIds.map((id) => [
      id,
      usageSeries((rm.get(id) ?? []).map((r) => ({ id: r.id, readAt: iso(r.read_at)!, value: Number(r.value), correction: (r.correction as "fix" | "replacement" | null) ?? null }))),
    ]),
  );
  const om = byEq(options);
  const opts = new Map(equipmentIds.map((id) => [id, (om.get(id) ?? []).map((o) => ({ code: o.code, from: iso(o.from)!, to: iso(o.to) }))]));
  // Réalisations : opérations cochées dans une intervention réalisée ; heures = relevé de cette intervention.
  const done = await rows<{ operation_id: string; equipment_id: string; stopped_at: string; reading_id: string | null }>(
    tx,
    sql`SELECT io.operation_id, io.equipment_id, i.stopped_at,
               (SELECT r.id FROM meter_readings r WHERE r.intervention_id = i.id AND r.equipment_id = io.equipment_id LIMIT 1) AS reading_id
        FROM intervention_operations io JOIN interventions i ON i.id = io.intervention_id
        WHERE i.status = 'done' AND i.stopped_at IS NOT NULL AND io.equipment_id IN (${ids})`,
  );
  const completions: Completion[] = done.map((d) => {
    const point = d.reading_id ? series.get(d.equipment_id)?.find((p) => p.reading.id === d.reading_id) : undefined;
    return { operationId: d.operation_id, at: iso(d.stopped_at)!, usage: point && point.status === "valid" ? point.usage : null };
  });
  return { readings: series, options: opts, completions, usageDays: await usageDaysOf(tx, equipmentIds) };
}

export async function maintenanceView(db: Database, farmId: string, equipmentId: string, at: string): Promise<EquipmentMaintenance> {
  return withFarm(db, farmId, async (tx) => {
    const [e] = await rows<{ commissioned_at: string | null; model_id: string | null; meter_unit: string | null }>(
      tx,
      sql`SELECT commissioned_at, model_id, meter_unit FROM equipments WHERE id = ${equipmentId}`,
    );
    if (!e) throw new NotFound("Matériel introuvable");
    const settings = await settingsTx(tx);
    const ops = await rows<OpRow>(tx, sql`SELECT * FROM equipment_operations WHERE equipment_id = ${equipmentId} ORDER BY position, label`);
    const parts = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT op.operation_id, op.quantity, a.id AS article_id, a.name, a.unit, a.custom->>'reference' AS reference
          FROM equipment_operation_parts op JOIN articles a ON a.id = op.article_id
          JOIN equipment_operations o ON o.id = op.operation_id WHERE o.equipment_id = ${equipmentId}`,
    );
    const inputs = await dueInputs(tx, [equipmentId]);
    const ctx = {
      completions: inputs.completions,
      series: inputs.readings.get(equipmentId) ?? [],
      usageDays: inputs.usageDays.get(equipmentId) ?? [],
      options: inputs.options.get(equipmentId) ?? [],
      commissionedAt: iso(e.commissioned_at),
      at,
      soonHours: settings.soonHours,
      soonMonths: settings.soonMonths,
    };
    const plan = ops.map((r) => {
      const op = toOp(r);
      return {
        ...op,
        parts: parts
          .filter((p) => p.operation_id === op.id)
          .map((p) => ({ articleId: p.article_id as string, name: p.name as string, reference: (p.reference as string) ?? null, quantity: Number(p.quantity), unit: p.unit as string })),
        due: computeDue(op, ctx),
      };
    });
    plan.sort((a, b) => compareDues({ due: a.due, op: a }, { due: b.due, op: b }));
    const fluids = await rows<Record<string, unknown>>(tx, sql`SELECT * FROM equipment_fluids WHERE equipment_id = ${equipmentId} ORDER BY organ`);
    const catalog = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT p.id, p.family, p.quantity, p.catalog, p.note, a.id AS article_id, a.name, a.custom->>'reference' AS reference,
                 coalesce((SELECT array_agg(DISTINCT o.label) FROM equipment_operation_parts op JOIN equipment_operations o ON o.id = op.operation_id
                            WHERE op.article_id = a.id AND o.equipment_id = ${equipmentId} AND o.archived_at IS NULL), '{}') AS operations
          FROM equipment_parts p JOIN articles a ON a.id = p.article_id
          WHERE p.equipment_id = ${equipmentId} ORDER BY p.family NULLS LAST, a.name`,
    );
    const [model] = e.model_id
      ? await rows<{ id: string; brand: string; model: string; warning: string | null; sources: unknown[] }>(
          tx,
          sql`SELECT id, brand, model, warning, sources FROM equipment_models WHERE id = ${e.model_id}`,
        )
      : [];
    return {
      equipmentId,
      at,
      settings,
      usageNow: plan[0]?.due.usageNow ?? usageAt(ctx.series, at, ctx.usageDays).usage,
      usageEstimated: usageAt(ctx.series, at, ctx.usageDays).kind === "estimated",
      model: model ? { id: model.id, label: `${model.brand} ${model.model}`, warning: model.warning, sources: model.sources ?? [] } : null,
      operations: plan,
      fluids: fluids.map((f) => ({
        id: f.id as string,
        organ: f.organ as string,
        fluid: f.fluid as string,
        standard: (f.standard as string) ?? null,
        viscosity: (f.viscosity as string) ?? null,
        capacity: (f.capacity as string) ?? null,
        capacityMaxL: num(f.capacity_max_l),
        note: (f.note as string) ?? null,
        source: (f.source as PlanOperation["source"]) ?? null,
      })),
      parts: catalog.map((p) => ({
        id: p.id as string,
        articleId: p.article_id as string,
        name: p.name as string,
        reference: (p.reference as string) ?? null,
        family: (p.family as string) ?? null,
        quantity: num(p.quantity),
        catalog: (p.catalog as Record<string, string | null>) ?? null,
        note: (p.note as string) ?? null,
        operations: (p.operations as string[]) ?? [],
      })),
    };
  });
}

/**
 * Échéances de toute la ferme à une date (FR-MAT-24), triées par urgence :
 * en retard et bientôt ; « à renseigner » compté par matériel.
 */
export async function farmDues(db: Database, farmId: string, at: string): Promise<{ items: FarmDueItem[]; byEquipment: Record<string, { overdue: number; soon: number; unknown: number }> }> {
  return withFarm(db, farmId, async (tx) => {
    const settings = await settingsTx(tx);
    const eqs = await rows<{ id: string; name: string; kind: string; commissioned_at: string | null }>(
      tx,
      sql`SELECT e.id, e.name, e.kind, e.commissioned_at FROM equipments e
          WHERE coalesce(e.state, 'active') = 'active' AND EXISTS (SELECT 1 FROM equipment_operations o WHERE o.equipment_id = e.id)`,
    );
    const ops = await rows<OpRow>(tx, sql`SELECT * FROM equipment_operations WHERE archived_at IS NULL OR archived_at > ${at}::timestamptz`);
    const inputs = await dueInputs(
      tx,
      eqs.map((e) => e.id),
    );
    const items: (FarmDueItem & { op: ReturnType<typeof toOp> })[] = [];
    const byEquipment: Record<string, { overdue: number; soon: number; unknown: number }> = {};
    for (const e of eqs) {
      const ctx = {
        completions: inputs.completions,
        series: inputs.readings.get(e.id) ?? [],
        usageDays: inputs.usageDays.get(e.id) ?? [],
        options: inputs.options.get(e.id) ?? [],
        commissionedAt: iso(e.commissioned_at),
        at,
        soonHours: settings.soonHours,
        soonMonths: settings.soonMonths,
      };
      const count = { overdue: 0, soon: 0, unknown: 0 };
      for (const r of ops.filter((o) => o.equipment_id === e.id)) {
        const op = toOp(r);
        const due = computeDue(op, ctx);
        if (due.status === "overdue" || due.status === "soon" || due.status === "unknown") count[due.status]++;
        if (due.status === "overdue" || due.status === "soon") {
          items.push({ equipmentId: e.id, equipmentName: e.name, equipmentKind: e.kind, operationId: op.id, label: op.label, kind: op.kind, performer: op.performer, due, op });
        }
      }
      byEquipment[e.id] = count;
    }
    items.sort((a, b) => compareDues({ due: a.due, op: a.op }, { due: b.due, op: b.op }));
    return { items: items.map(({ op: _op, ...rest }) => rest), byEquipment };
  });
}

// ---------------------------------------------------------------------------
// Plan de la ferme (responsable ; « dernière fois connue » : tout membre)
// ---------------------------------------------------------------------------

export async function createOperation(db: Database, farmId: string, ctx: DomainCtx, equipmentId: string, body: PlanOperationWrite): Promise<{ id: string }> {
  return withFarm(db, farmId, async (tx) => {
    const [e] = await rows<{ id: string }>(tx, sql`SELECT id FROM equipments WHERE id = ${equipmentId}`);
    if (!e) throw new NotFound("Matériel introuvable");
    const id = ctx.newId();
    const [{ pos }] = (await rows<{ pos: number }>(tx, sql`SELECT coalesce(max(position), -1) + 1 AS pos FROM equipment_operations WHERE equipment_id = ${equipmentId}`)) as [{ pos: number }];
    await tx.execute(sql`
      INSERT INTO equipment_operations (id, farm_id, equipment_id, code, label, kind, every_hours, every_months, first_hours, performer, condition, position)
      VALUES (${id}, ${farmId}, ${equipmentId}, ${null}, ${body.label}, ${body.kind}, ${body.everyHours ?? null}, ${body.everyMonths ?? null},
              ${body.firstHours ?? null}, ${body.performer}, ${body.condition || null}, ${pos})`);
    await audit(tx, farmId, ctx, "equipment_operation", id, "create", body);
    return { id };
  });
}

export async function updateOperation(db: Database, farmId: string, ctx: DomainCtx, id: string, body: PlanOperationWrite): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE equipment_operations SET label = ${body.label}, kind = ${body.kind}, every_hours = ${body.everyHours ?? null},
            every_months = ${body.everyMonths ?? null}, first_hours = ${body.firstHours ?? null}, performer = ${body.performer},
            condition = ${body.condition || null},
            archived_at = ${body.archived ? sql`coalesce(archived_at, now())` : null},
            archived_reason = ${body.archived ? sql`coalesce(archived_reason, 'Retirée du plan.')` : null},
            updated_at = now()
          WHERE id = ${id} RETURNING id`,
    );
    if (!done.length) throw new NotFound("Opération introuvable");
    await audit(tx, farmId, ctx, "equipment_operation", id, "update", body);
  });
}

export async function setBaseline(db: Database, farmId: string, ctx: DomainCtx, id: string, body: { at: string | null; hours: number | null }): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    if (body.at && body.at > new Date(Date.now() + 86_400_000).toISOString()) throw new BadRequest("La dernière réalisation ne peut pas être dans le futur.");
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE equipment_operations SET baseline_at = ${body.at}, baseline_hours = ${body.at ? body.hours : null}, updated_at = now()
          WHERE id = ${id} RETURNING id`,
    );
    if (!done.length) throw new NotFound("Opération introuvable");
    await audit(tx, farmId, ctx, "equipment_operation", id, "baseline", body);
  });
}

/**
 * Amorce en une fois les échéances « à renseigner » d'un matériel : même
 * dernière réalisation connue (date, heures) pour toutes les opérations
 * périodiques sans réalisation ni amorce (ex. révision complète à l'achat).
 */
export async function baselineAll(db: Database, farmId: string, ctx: DomainCtx, equipmentId: string, body: { at: string; hours: number | null }): Promise<{ updated: number }> {
  return withFarm(db, farmId, async (tx) => {
    if (body.at > new Date(Date.now() + 86_400_000).toISOString()) throw new BadRequest("La dernière réalisation ne peut pas être dans le futur.");
    const done = await rows<{ id: string }>(
      tx,
      sql`UPDATE equipment_operations SET baseline_at = ${body.at}, baseline_hours = ${body.hours}, updated_at = now()
          WHERE equipment_id = ${equipmentId} AND archived_at IS NULL AND baseline_at IS NULL
            AND (every_hours IS NOT NULL OR every_months IS NOT NULL)
          RETURNING id`,
    );
    await audit(tx, farmId, ctx, "equipment", equipmentId, "baseline_all", { ...body, updated: done.length });
    return { updated: done.length };
  });
}

// ---------------------------------------------------------------------------
// Modèles et import de la base matériel (FR-MAT-8, FR-MAT-22)
// ---------------------------------------------------------------------------

export async function listModels(db: Database, farmId: string) {
  return withFarm(db, farmId, (tx) =>
    rows<{ id: string; brand: string; model: string; manufacturerType: string | null; operations: number; own: boolean }>(
      tx,
      sql`SELECT m.id, m.brand, m.model, m.manufacturer_type AS "manufacturerType", m.farm_id IS NOT NULL AS own,
                 (SELECT count(*)::int FROM model_operations o WHERE o.model_id = m.id) AS operations
          FROM equipment_models m ORDER BY m.brand, m.model`,
    ),
  );
}

async function upsertModel(tx: Tx, farmId: string, b: EquipmentBundle): Promise<string> {
  const [m] = await rows<{ id: string }>(
    tx,
    sql`INSERT INTO equipment_models (id, farm_id, slug, brand, model, manufacturer_type, sources, warning)
        VALUES (${crypto.randomUUID()}, ${farmId}, ${b.model.slug}, ${b.model.brand}, ${b.model.model}, ${b.model.manufacturerType},
                ${JSON.stringify(b.model.sources)}::jsonb, ${b.model.warning})
        ON CONFLICT (coalesce(farm_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
        DO UPDATE SET brand = excluded.brand, model = excluded.model, manufacturer_type = excluded.manufacturer_type,
                      sources = excluded.sources, warning = excluded.warning, imported_at = now()
        RETURNING id`,
  );
  const modelId = m!.id;
  for (const o of b.operations) {
    await tx.execute(sql`
      INSERT INTO model_operations (id, model_id, code, manual_number, label, kind, every_hours, every_months, first_hours, performer,
                                    requires_option, condition, source, parts, position)
      VALUES (${crypto.randomUUID()}, ${modelId}, ${o.code}, ${o.manualNumber}, ${o.label}, ${o.kind}, ${o.everyHours}, ${o.everyMonths},
              ${o.firstHours}, ${o.performer}, ${o.requiresOption}, ${o.condition}, ${o.source ? JSON.stringify(o.source) : null}::jsonb,
              ${JSON.stringify(o.parts)}::jsonb, ${o.position})
      ON CONFLICT (model_id, code) DO UPDATE SET manual_number = excluded.manual_number, label = excluded.label, kind = excluded.kind,
        every_hours = excluded.every_hours, every_months = excluded.every_months, first_hours = excluded.first_hours,
        performer = excluded.performer, requires_option = excluded.requires_option, condition = excluded.condition,
        source = excluded.source, parts = excluded.parts, position = excluded.position`);
  }
  const codes = b.operations.map((o) => o.code);
  await tx.execute(sql`DELETE FROM model_operations WHERE model_id = ${modelId} AND NOT (code IN (SELECT jsonb_array_elements_text(${JSON.stringify(codes)}::jsonb)))`);
  await tx.execute(sql`DELETE FROM model_fluids WHERE model_id = ${modelId}`);
  for (const f of b.fluids) {
    await tx.execute(sql`
      INSERT INTO model_fluids (id, model_id, organ, fluid, standard, viscosity, capacity, capacity_max_l, note, source)
      VALUES (${crypto.randomUUID()}, ${modelId}, ${f.organ}, ${f.fluid}, ${f.standard}, ${f.viscosity}, ${f.capacity}, ${f.capacityMaxL},
              ${f.note}, ${f.source ? JSON.stringify(f.source) : null}::jsonb)
      ON CONFLICT (model_id, organ) DO NOTHING`);
  }
  await tx.execute(sql`DELETE FROM model_parts WHERE model_id = ${modelId}`);
  for (const p of b.parts) {
    await tx.execute(sql`
      INSERT INTO model_parts (id, model_id, reference, reference_norm, designation, family, quantity, catalog, operations, note)
      VALUES (${crypto.randomUUID()}, ${modelId}, ${p.reference}, ${p.referenceNorm}, ${p.designation}, ${p.family}, ${p.quantity},
              ${JSON.stringify(p.catalog)}::jsonb, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(p.operations)}::jsonb)), ${p.note})
      ON CONFLICT (model_id, reference_norm, family) DO NOTHING`);
  }
  return modelId;
}

/** Article « pièce » de la ferme pour une référence constructeur (créé au besoin). */
async function partArticle(tx: Tx, farmId: string, brand: string, p: { reference: string; referenceNorm: string; designation: string; family: string | null }): Promise<string> {
  const [found] = await rows<{ id: string }>(
    tx,
    sql`SELECT id FROM articles WHERE kind = 'part' AND custom->>'referenceNorm' = ${p.referenceNorm} AND coalesce(custom->>'brand', '') = ${brand} LIMIT 1`,
  );
  if (found) return found.id;
  const id = crypto.randomUUID();
  const name = `${p.designation.charAt(0)}${p.designation.slice(1).toLowerCase()} ${brand} ${p.reference}`;
  await tx.execute(sql`
    INSERT INTO articles (id, farm_id, name, kind, unit, custom)
    VALUES (${id}, ${farmId}, ${name}, 'part', 'Unité',
            ${JSON.stringify({ reference: p.reference, referenceNorm: p.referenceNorm, family: p.family, brand })}::jsonb)`);
  return id;
}

export interface ApplyReport {
  operationsAdded: number;
  operationsKept: number;
  notApplicable: string[];
  fluids: number;
  parts: number;
  articlesCreated: number;
}

/**
 * Copie le plan d'un modèle sur un matériel (FR-MAT-22). Les opérations déjà
 * présentes (même code) sont **conservées** telles que la ferme les a
 * ajustées ; seules les nouvelles sont ajoutées. Une opération liée à une
 * option absente d'usine arrive retirée, « non applicable ».
 */
async function applyModelTx(tx: Tx, farmId: string, ctx: DomainCtx, equipmentId: string, modelId: string, absentOptions: string[] = []): Promise<ApplyReport> {
  const [m] = await rows<{ brand: string }>(tx, sql`SELECT brand FROM equipment_models WHERE id = ${modelId}`);
  if (!m) throw new NotFound("Modèle introuvable");
  await tx.execute(sql`UPDATE equipments SET model_id = ${modelId}, updated_at = now() WHERE id = ${equipmentId}`);
  const absent = new Set(absentOptions.map(optionCode));
  const ops = await rows<Record<string, unknown>>(tx, sql`SELECT * FROM model_operations WHERE model_id = ${modelId} ORDER BY position`);
  const before = await rows<{ count: number }>(tx, sql`SELECT count(*)::int AS count FROM articles WHERE kind = 'part'`);
  const report: ApplyReport = { operationsAdded: 0, operationsKept: 0, notApplicable: [], fluids: 0, parts: 0, articlesCreated: 0 };
  for (const o of ops) {
    const off = o.requires_option && absent.has(o.requires_option as string);
    const inserted = await rows<{ id: string }>(
      tx,
      sql`INSERT INTO equipment_operations (id, farm_id, equipment_id, model_operation_id, code, label, kind, every_hours, every_months,
                                            first_hours, performer, requires_option, condition, source, archived_at, archived_reason, position)
          VALUES (${crypto.randomUUID()}, ${farmId}, ${equipmentId}, ${o.id as string}, ${o.code as string}, ${o.label as string}, ${o.kind as string},
                  ${o.every_hours as string | null}, ${o.every_months as number | null}, ${o.first_hours as string | null}, ${o.performer as string},
                  ${(o.requires_option as string) ?? null}, ${(o.condition as string) ?? null}, ${o.source ? JSON.stringify(o.source) : null}::jsonb,
                  ${off ? sql`now()` : null}, ${off ? `Option absente d'usine : ${optionLabelByCode(o.requires_option as string).toLowerCase()}.` : null},
                  ${o.position as number})
          ON CONFLICT (equipment_id, code) DO NOTHING RETURNING id`,
    );
    const opId = inserted[0]?.id;
    if (!opId) {
      report.operationsKept++;
      continue;
    }
    report.operationsAdded++;
    if (off) report.notApplicable.push(o.label as string);
    for (const p of (o.parts as { reference: string; referenceNorm: string; designation: string; quantity: number; family: string | null }[]) ?? []) {
      const articleId = await partArticle(tx, farmId, m.brand, p);
      await tx.execute(sql`
        INSERT INTO equipment_operation_parts (id, farm_id, operation_id, article_id, quantity)
        VALUES (${crypto.randomUUID()}, ${farmId}, ${opId}, ${articleId}, ${p.quantity || 1})
        ON CONFLICT (operation_id, article_id) DO UPDATE SET quantity = equipment_operation_parts.quantity + excluded.quantity`);
    }
  }
  for (const f of await rows<Record<string, unknown>>(tx, sql`SELECT * FROM model_fluids WHERE model_id = ${modelId}`)) {
    await tx.execute(sql`
      INSERT INTO equipment_fluids (id, farm_id, equipment_id, organ, fluid, standard, viscosity, capacity, capacity_max_l, note, source)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${equipmentId}, ${f.organ as string}, ${f.fluid as string}, ${(f.standard as string) ?? null},
              ${(f.viscosity as string) ?? null}, ${(f.capacity as string) ?? null}, ${f.capacity_max_l as string | null}, ${(f.note as string) ?? null},
              ${f.source ? JSON.stringify(f.source) : null}::jsonb)
      ON CONFLICT (equipment_id, organ) DO NOTHING`);
    report.fluids++;
  }
  for (const p of await rows<Record<string, unknown>>(tx, sql`SELECT * FROM model_parts WHERE model_id = ${modelId}`)) {
    const articleId = await partArticle(tx, farmId, m.brand, {
      reference: p.reference as string,
      referenceNorm: p.reference_norm as string,
      designation: p.designation as string,
      family: (p.family as string) ?? null,
    });
    await tx.execute(sql`
      INSERT INTO equipment_parts (id, farm_id, equipment_id, article_id, family, quantity, catalog, note)
      VALUES (${crypto.randomUUID()}, ${farmId}, ${equipmentId}, ${articleId}, ${(p.family as string) ?? null}, ${p.quantity as string | null},
              ${JSON.stringify(p.catalog)}::jsonb, ${(p.note as string) ?? null})
      ON CONFLICT (equipment_id, article_id) DO NOTHING`);
    report.parts++;
  }
  const after = await rows<{ count: number }>(tx, sql`SELECT count(*)::int AS count FROM articles WHERE kind = 'part'`);
  report.articlesCreated = after[0]!.count - before[0]!.count;
  await audit(tx, farmId, ctx, "equipment", equipmentId, "apply_model", { modelId, ...report });
  return report;
}

export async function applyModel(db: Database, farmId: string, ctx: DomainCtx, equipmentId: string, modelId: string): Promise<ApplyReport> {
  return withFarm(db, farmId, async (tx) => {
    const [e] = await rows<{ id: string }>(tx, sql`SELECT id FROM equipments WHERE id = ${equipmentId}`);
    if (!e) throw new NotFound("Matériel introuvable");
    return applyModelTx(tx, farmId, ctx, equipmentId, modelId);
  });
}

export interface BundleImportResult {
  runId: string;
  equipmentId: string;
  modelId: string;
  created: boolean;
  report: ApplyReport & { warnings: string[]; model: string };
}

/**
 * Import d'un dossier de la base matériel : modèle (propre à la ferme),
 * fiche du matériel (rattachée à `equipmentId`, sinon créée), options
 * montées, plan, fluides, pièces. Rejouable sans doublon.
 */
export async function importBundle(db: Database, farmId: string, ctx: DomainCtx, files: Record<string, string>, equipmentId: string | null): Promise<BundleImportResult> {
  let bundle: EquipmentBundle;
  try {
    bundle = parseEquipmentBundle(files);
  } catch (e) {
    throw new BadRequest(e instanceof Error ? e.message : String(e));
  }
  return withFarm(db, farmId, async (tx) => {
    const runId = ctx.newId();
    await tx.execute(sql`INSERT INTO import_runs (id, farm_id, source, status) VALUES (${runId}, ${farmId}, ${`equipment:${bundle.model.slug}`}, 'running')`);
    const modelId = await upsertModel(tx, farmId, bundle);
    let id = equipmentId;
    if (id) {
      const [e] = await rows<{ id: string }>(tx, sql`SELECT id FROM equipments WHERE id = ${id}`);
      if (!e) throw new NotFound("Matériel introuvable");
    } else if (bundle.machine.serialNumber) {
      const [e] = await rows<{ id: string }>(tx, sql`SELECT id FROM equipments WHERE serial_number = ${bundle.machine.serialNumber} LIMIT 1`);
      id = e?.id ?? null;
    }
    const created = !id;
    if (!id) {
      id = ctx.newId();
      await tx.execute(sql`
        INSERT INTO equipments (id, farm_id, name, kind, state, meter_unit)
        VALUES (${id}, ${farmId}, ${`${bundle.model.brand} ${bundle.model.model}`}, 'tractor', 'active', 'hours')`);
    }
    // Marque de la ferme.
    const norm = normName(bundle.model.brand);
    const [brand] = await rows<{ id: string }>(
      tx,
      sql`INSERT INTO farm_brands (id, farm_id, name, name_norm) VALUES (${crypto.randomUUID()}, ${farmId}, ${bundle.model.brand}, ${norm})
          ON CONFLICT (farm_id, name_norm) DO UPDATE SET name_norm = excluded.name_norm RETURNING id`,
    );
    await tx.execute(sql`
      UPDATE equipments SET brand = ${bundle.model.brand}, brand_id = ${brand!.id}, model = ${bundle.model.model},
        manufacturer_type = coalesce(${bundle.model.manufacturerType}, manufacturer_type),
        serial_number = coalesce(${bundle.machine.serialNumber}, serial_number), year = coalesce(${bundle.machine.year}, year),
        aggregates = CASE WHEN ${bundle.machine.aggregates.length} > 0 THEN ${JSON.stringify(bundle.machine.aggregates)}::jsonb ELSE aggregates END,
        technical = coalesce(${bundle.technical ? JSON.stringify(bundle.technical) : null}::jsonb, technical),
        meter_unit = coalesce(meter_unit, 'hours'), updated_at = now()
      WHERE id = ${id}`);
    // Options montées d'usine : depuis la mise en service (ou l'année), sinon depuis toujours.
    for (const raw of bundle.machine.options) {
      const code = optionCode(raw);
      await tx.execute(sql`
        INSERT INTO equipment_options (id, farm_id, equipment_id, code, label, valid, source)
        SELECT ${crypto.randomUUID()}, ${farmId}, ${id}, ${code}, ${optionLabel(raw)},
               tstzrange(coalesce(e.commissioned_at, make_timestamptz(coalesce(e.year, 1900), 1, 1, 0, 0, 0, 'UTC')), NULL),
               '{"id": "machine.json"}'::jsonb
        FROM equipments e WHERE e.id = ${id}
          AND NOT EXISTS (SELECT 1 FROM equipment_options o WHERE o.equipment_id = ${id} AND o.code = ${code})`);
    }
    const report = await applyModelTx(tx, farmId, ctx, id, modelId, bundle.machine.absentOptions);
    const full = { ...report, warnings: [...(bundle.model.warning ? [bundle.model.warning] : []), ...bundle.warnings], model: `${bundle.model.brand} ${bundle.model.model}` };
    await tx.execute(sql`UPDATE import_runs SET status = 'completed', finished_at = now(), report = ${JSON.stringify({ equipmentId: id, ...full })}::jsonb WHERE id = ${runId}`);
    return { runId, equipmentId: id, modelId, created, report: full };
  });
}

// ---------------------------------------------------------------------------
// Pièces à commander (FR-MAT-42)
// ---------------------------------------------------------------------------

export async function partsToOrder(db: Database, farmId: string, at: string, horizon: { hours: number | null; months: number | null }): Promise<PartsToOrder> {
  return withFarm(db, farmId, async (tx) => {
    const settings = await settingsTx(tx);
    const eqs = await rows<{ id: string; name: string; commissioned_at: string | null }>(
      tx,
      sql`SELECT e.id, e.name, e.commissioned_at FROM equipments e
          WHERE coalesce(e.state, 'active') = 'active'
            AND EXISTS (SELECT 1 FROM equipment_operations o JOIN equipment_operation_parts p ON p.operation_id = o.id WHERE o.equipment_id = e.id)`,
    );
    const ops = await rows<OpRow>(tx, sql`SELECT * FROM equipment_operations WHERE archived_at IS NULL`);
    const parts = await rows<{ operation_id: string; article_id: string; quantity: string }>(tx, sql`SELECT operation_id, article_id, quantity FROM equipment_operation_parts`);
    const inputs = await dueInputs(
      tx,
      eqs.map((e) => e.id),
    );
    const need = new Map<string, { needed: number; operations: Set<string>; equipments: Set<string> }>();
    for (const e of eqs) {
      const series = inputs.readings.get(e.id) ?? [];
      const usageDays = inputs.usageDays.get(e.id) ?? [];
      const ctx = { completions: inputs.completions, series, usageDays, options: inputs.options.get(e.id) ?? [], commissionedAt: iso(e.commissioned_at), at, soonHours: settings.soonHours, soonMonths: settings.soonMonths };
      // Rythme d'usage : heures de la dernière année (relevés et estimations), sinon 0 (horizon en mois seul).
      const yearAgo = new Date(Date.parse(at) - 365 * 86_400_000).toISOString();
      const now = usageAt(series, at, usageDays).usage;
      const then = usageAt(series, yearAgo, usageDays).usage ?? series.find((p) => p.status === "valid")?.usage ?? null;
      const firstAt = series.find((p) => p.status === "valid")?.reading.readAt;
      const spanDays = firstAt ? Math.max(1, Math.min(365, (Date.parse(at) - Date.parse(firstAt > yearAgo ? firstAt : yearAgo)) / 86_400_000)) : 365;
      const hoursPerDay = now !== null && then !== null ? Math.max(0, (now - then) / spanDays) : 0;
      const list: ForecastOperation[] = ops
        .filter((o) => o.equipment_id === e.id)
        .map((r) => {
          const op = toOp(r);
          return { op, due: computeDue(op, ctx), parts: parts.filter((p) => p.operation_id === op.id).map((p) => ({ articleId: p.article_id, quantity: Number(p.quantity) })) };
        });
      for (const line of partsForecast(list, horizon, hoursPerDay)) {
        const n = need.get(line.articleId) ?? { needed: 0, operations: new Set(), equipments: new Set() };
        n.needed += line.needed;
        line.operations.forEach((o) => n.operations.add(o));
        n.equipments.add(e.name);
        need.set(line.articleId, n);
      }
    }
    if (!need.size) return { at, horizon, items: [] };
    const ids = sql.join(
      [...need.keys()].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const arts = await rows<{ id: string; name: string; unit: string; reference: string | null; family: string | null; stock: string | null }>(
      tx,
      sql`SELECT a.id, a.name, a.unit, a.custom->>'reference' AS reference, a.custom->>'family' AS family,
                 (SELECT sum(m.quantity) FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE l.article_id = a.id AND m.occurred_at <= ${at}::timestamptz) AS stock
          FROM articles a WHERE a.id IN (${ids})`,
    );
    const items = arts
      .map((a) => {
        const n = need.get(a.id)!;
        const inStock = Math.max(0, Number(a.stock ?? 0));
        return {
          articleId: a.id,
          name: a.name,
          reference: a.reference,
          family: a.family,
          unit: a.unit,
          needed: n.needed,
          inStock,
          toOrder: Math.max(0, n.needed - inStock),
          operations: [...n.operations],
          equipments: [...n.equipments],
        };
      })
      .sort((x, y) => (x.family ?? "").localeCompare(y.family ?? "") || x.name.localeCompare(y.name));
    return { at, horizon, items };
  });
}

// ---------------------------------------------------------------------------
// Alertes (FR-MAT-25) : nouvelles échéances « bientôt » ou « en retard »
// ---------------------------------------------------------------------------

/**
 * Échéances passées à « bientôt » ou « en retard » et pas encore signalées,
 * avec les adresses des membres à prévenir. `markSent` les enregistre une
 * fois le message parti : une échéance n'est signalée qu'une fois par état.
 */
export async function pendingAlerts(db: Database, farmId: string, at: string) {
  const { items } = await farmDues(db, farmId, at);
  return withFarm(db, farmId, async (tx) => {
    const settings = await settingsTx(tx);
    const [farm] = await rows<{ name: string }>(tx, sql`SELECT name FROM farms WHERE id = ${farmId}`);
    const notify = settings.notify ?? [];
    const recipients = notify.length
      ? await rows<{ email: string; name: string | null }>(
          tx,
          sql`SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE u.id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(notify)}::jsonb))`,
        )
      : [];
    const sent = await rows<{ operation_id: string; status: string; due_key: string }>(tx, sql`SELECT operation_id, status, due_key FROM maintenance_alerts`);
    const key = (i: FarmDueItem) => (i.due.nextUsage !== null ? `h:${i.due.nextUsage}` : `d:${i.due.nextDate?.slice(0, 10)}`);
    const fresh = items.filter((i) => !sent.some((s) => s.operation_id === i.operationId && s.status === i.due.status && s.due_key === key(i)));
    return { farmName: farm?.name ?? "", recipients, items: fresh.map((i) => ({ ...i, dueKey: key(i) })) };
  });
}

export async function markAlertsSent(db: Database, farmId: string, items: { operationId: string; due: { status: string }; dueKey: string }[]) {
  await withFarm(db, farmId, async (tx) => {
    for (const i of items) {
      await tx.execute(sql`
        INSERT INTO maintenance_alerts (farm_id, operation_id, status, due_key) VALUES (${farmId}, ${i.operationId}, ${i.due.status}, ${i.dueKey})
        ON CONFLICT DO NOTHING`);
    }
  });
}

/** Fermes qui ont des membres à prévenir. */
export async function farmsWithAlerts(db: Database): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE fourmy_app`);
    return (await rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM fourmy_alert_farms()`)).map((r) => r.farm_id);
  });
}
