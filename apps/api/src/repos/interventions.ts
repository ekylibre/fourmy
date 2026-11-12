import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  planInterventionCompletion,
  planCorrection,
  toStockQuantity,
  convertQuantity,
  unitScale,
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
  crewRules,
  flattenCrews,
  crewDurations,
  mergePeriods,
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
  type IrrigationMethod,
  interventionUpdateWrite,
  type StockMovement,
  type TargetKind,
  type TreatmentPurpose,
} from "@fourmy/contracts";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";
import { checkCompliance, type CheckableBody } from "./phyto.js";
import { checkApplicationTx } from "./fertilization-record.js";
import { addReadingInTx } from "./equipments.js";
import { buildTrackDraft, linkTrackSessions } from "./track-sessions.js";

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

/**
 * Attelages (lot N3) : toutes les règles et écritures existantes (formes,
 * doses, compteurs, contrôle phyto, stocks, bornes) travaillent sur la forme
 * aplatie ; seul `writeBody` écrit les attelages eux-mêmes.
 */
function flat<B extends Pick<Body, "staffing" | "crews" | "tools" | "doers" | "periods">>(body: B): B {
  return body.staffing === "crews" ? { ...body, ...flattenCrews(body.crews) } : body;
}

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
  const staffing = (r.staffing as Intervention["staffing"] | undefined) ?? "free";
  const a = (p: ParamRow) => p.attrs ?? {};
  const meters = new Map(
    ((r.meters as { equipment_id: string; value: string; correction: string | null; correction_reason: string | null }[]) ?? []).map((m) => [
      m.equipment_id,
      { value: Number(m.value), ...(m.correction ? { correction: m.correction as "fix" | "replacement", correctionReason: m.correction_reason } : {}) },
    ]),
  );
  const maint = r.maintenance as { nature?: string; problem?: string | null; workshop?: { name: string; reference?: string | null } | null } | null;
  const ops = (r.operations as { equipment_id: string; operation_id: string; label: string; kind: string; result: string; note: string | null }[]) ?? [];
  const out: Intervention = {
    id: r.id as string,
    farmId: r.farm_id as string,
    procedure: r.procedure as string,
    status: r.status as Intervention["status"],
    startedAt: iso(r.started_at),
    stoppedAt: iso(r.stopped_at),
    periods,
    staffing,
    crews: [],
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
    bbch: r.bbch ? { code: r.bbch as string, label: (r.bbch_label as string | null) ?? (r.bbch as string) } : null,
    origin: r.origin as Intervention["origin"],
    clientId: (r.client_id as string | null) ?? null,
    compliance: (r.compliance as Intervention["compliance"]) ?? null,
    nitrateCheck: (r.nitrate_check as Intervention["nitrateCheck"]) ?? null,
    ift: (r.ift as Intervention["ift"]) ?? null,
    weather: (r.weather as Intervention["weather"]) ?? null,
    irrigation: r.irrigation ? { depthMm: Number((r.irrigation as { depthMm: number }).depthMm), method: (r.irrigation as { method?: IrrigationMethod | null }).method ?? null } : null,
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
  return withCrews(out, r.crews as CrewRow[] | undefined, meters);
}

type CrewRow = { id: string; rank: number; label: string | null; template_id: string | null; tools: string[]; doers: string[]; periods: { startedAt: string; stoppedAt: string }[] };

/**
 * Attelages lus ; en mode `crews`, matériels, intervenants et périodes de
 * premier niveau = leur réunion (périodes fusionnées), pour les anciens
 * clients. Le relevé de compteur d'un matériel est porté dans chaque attelage
 * où il figure.
 */
function withCrews(out: Intervention, rows: CrewRow[] | undefined, meters: Map<string, NonNullable<Intervention["tools"][number]["meter"]>>): Intervention {
  const crews = (rows ?? []).map((c) => ({
    id: c.id,
    rank: c.rank,
    label: c.label,
    templateId: c.template_id,
    tools: c.tools.map((id) => ({ equipmentId: id, ...(meters.has(id) ? { meter: meters.get(id)! } : {}) })),
    doers: c.doers.map((id) => ({ personId: id })),
    periods: c.periods.map((p) => ({ startedAt: iso(p.startedAt)!, stoppedAt: iso(p.stoppedAt)! })),
  }));
  const read = out.staffing === "crews" ? { ...out, crews, ...flattenCrews(crews) } : out;
  return { ...read, ...crewDurations(read) };
}

async function readInterventions(tx: Tx, where: SQL, limit = 1000): Promise<Intervention[]> {
  const list = await rows<Record<string, unknown>>(
    tx,
    sql`
      SELECT i.id, i.farm_id, i.procedure, i.status, i.started_at, i.stopped_at, i.origin, i.client_id, i.staffing,
             i.purposes, i.notes, i.bbch, (SELECT st.label FROM ref_bbch_stages st WHERE st.code = i.bbch) AS bbch_label, i.compliance, i.nitrate_check, i.ift, i.weather, i.maintenance, i.irrigation, i.created_at, i.updated_at,
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
               ) ORDER BY p.role, p.id), '[]') FROM intervention_parameters p WHERE p.intervention_id = i.id) AS parameters,
             (SELECT coalesce(json_agg(json_build_object(
                 'id', c.id, 'rank', c.rank, 'label', c.label, 'template_id', c.template_id,
                 'tools', (SELECT coalesce(json_agg(p.ref_id ORDER BY p.id), '[]') FROM intervention_parameters p
                            WHERE p.crew_id = c.id AND p.role = 'tool' AND p.ref_type = 'equipment'),
                 'doers', (SELECT coalesce(json_agg(p.ref_id ORDER BY p.id), '[]') FROM intervention_parameters p
                            WHERE p.crew_id = c.id AND p.role = 'doer' AND p.ref_type = 'person'),
                 'periods', (SELECT coalesce(json_agg(json_build_object('startedAt', w.started_at, 'stoppedAt', w.stopped_at)
                               ORDER BY w.started_at), '[]') FROM intervention_periods w WHERE w.crew_id = c.id)
               ) ORDER BY c.rank), '[]') FROM intervention_crews c WHERE c.intervention_id = i.id) AS crews
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

type Article = { id: string; name: string; unit: string; kind: ArticleKind; density: number | null };

async function loadArticles(tx: Tx, ids: string[]): Promise<Map<string, Article>> {
  if (ids.length === 0) return new Map();
  const list = await rows<Article>(
    tx,
    // Densité du fertilisant (kg/L) : conversion d'une saisie en litres d'un produit stocké en tonnes.
    sql`SELECT a.id, a.name, a.unit, a.kind, f.density::float8 AS density
        FROM articles a LEFT JOIN article_fertilizers f ON f.article_id = a.id
        WHERE a.id IN (${sql.join([...new Set(ids)].map((i) => sql`${i}`), sql`, `)})`,
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

async function validate(tx: Tx, procedureCode: string, raw: Body, mode: "plan" | "complete") {
  const crewErrors = crewRules(raw, await crewNames(tx, raw));
  if (crewErrors.length) throw new DomainError(crewErrors.join(" "));
  if (raw.bbch) {
    const [st] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM ref_bbch_stages WHERE code = ${raw.bbch}`);
    if (!st!.n) throw new DomainError("Stade BBCH inconnu du référentiel.");
  }
  const body = flat(raw);
  const articles = await loadArticles(tx, [...body.inputs.map((i) => i.articleId), ...body.outputs.map((o) => o.articleId)]);
  const errors = validateIntervention(getProcedure(procedureCode), body, mode, {
    articleKind: (id) => articles.get(id)?.kind,
  });
  if (errors.length) throw new DomainError(errors.join(" "));
  // Unité de saisie d'un intrant (fertilisants seulement) : convertible dans celle de l'article.
  for (const i of body.inputs) {
    const a = articles.get(i.articleId);
    if (!a || !i.unit || i.unit === a.unit) continue;
    if (a.kind !== "fertilizer") throw new DomainError(`${a.name} : se saisit dans son unité (${a.unit}).`);
    if (convertQuantity(1, i.unit, a.unit, a.density) === null) {
      throw new DomainError(
        `${a.name} : ${i.unit} ne se convertit pas en ${a.unit}${unitScale(i.unit) && unitScale(a.unit) ? " sans la densité du produit (fiche du fertilisant)" : ""}.`,
      );
    }
  }
  for (const kind of TARGET_KINDS) {
    await assertExist(tx, TABLE_OF[kind], body.targets.filter((t) => t.kind === kind).map((t) => t.id), "Cible");
  }
  await assertExist(tx, "equipments", body.tools.map((t) => t.equipmentId), "Matériel");
  await assertExist(tx, "people", body.doers.map((d) => d.personId), "Personne");
  return articles;
}

/** Noms des matériels et personnes des attelages, pour des messages lisibles. */
async function crewNames(tx: Tx, body: Body) {
  if (body.staffing !== "crews") return {};
  const ids = [...new Set(body.crews.flatMap((c) => [...c.tools.map((t) => t.equipmentId), ...c.doers.map((d) => d.personId)]))];
  if (!ids.length) return {};
  const list = await rows<{ id: string; name: string }>(
    tx,
    sql`SELECT id, name FROM equipments WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
        UNION ALL SELECT id, name FROM people WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`,
  );
  const names = new Map(list.map((r) => [r.id, r.name]));
  return { equipment: (id: string) => names.get(id), person: (id: string) => names.get(id) };
}

// ---------------------------------------------------------------------------
// Écriture : forme structurée → lignes par rôle
// ---------------------------------------------------------------------------

async function writeBody(tx: Tx, interventionId: string, body: Body, articles: Map<string, Article>) {
  // Parcours GPS rattachés à un attelage : `crew_id` est remis à NULL par la
  // suppression des attelages ; on le repose après réécriture (même id
  // d'attelage, sinon l'attelage qui contient le matériel suivi).
  const linked = await rows<{ id: string; crew_id: string }>(
    tx,
    sql`SELECT id, crew_id FROM track_sessions WHERE intervention_id = ${interventionId} AND crew_id IS NOT NULL`,
  );
  await tx.execute(sql`UPDATE interventions SET staffing = ${body.staffing ?? "free"} WHERE id = ${interventionId}`);
  await tx.execute(sql`DELETE FROM intervention_crews WHERE intervention_id = ${interventionId}`);
  await tx.execute(sql`DELETE FROM intervention_parameters WHERE intervention_id = ${interventionId}`);
  await tx.execute(sql`DELETE FROM intervention_periods WHERE intervention_id = ${interventionId}`);
  const insert = (
    role: string,
    refType: string,
    refId: string,
    quantity: number | null,
    unit: string | null,
    attrs: object | null,
    zone?: unknown,
    crewId: string | null = null,
  ) =>
    tx.execute(sql`
      INSERT INTO intervention_parameters (id, intervention_id, role, ref_type, ref_id, quantity, unit, attrs, working_zone, crew_id)
      VALUES (${crypto.randomUUID()}, ${interventionId}, ${role}, ${refType}, ${refId}, ${quantity}, ${unit},
              ${attrs && Object.keys(attrs).length ? JSON.stringify(attrs) : null}::jsonb,
              ${zone ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(zone)}), 4326)` : null}, ${crewId})`);
  const period = (p: { startedAt: string; stoppedAt: string }, crewId: string | null = null) =>
    tx.execute(sql`
      INSERT INTO intervention_periods (id, intervention_id, started_at, stopped_at, crew_id)
      VALUES (${crypto.randomUUID()}, ${interventionId}, ${p.startedAt}::timestamptz, ${p.stoppedAt}::timestamptz, ${crewId})`);
  for (const t of body.targets) {
    await insert("target", t.kind, t.id, null, null, t.workedAreaM2 ? { workedAreaM2: t.workedAreaM2 } : null, t.workingZone);
  }
  for (const i of body.inputs) {
    const a = articles.get(i.articleId)!;
    await insert("input", "article", i.articleId, i.quantity, storedUnit(i.unit ?? a.unit, i.per), {
      ...(i.lotId ? { lotId: i.lotId } : {}),
      ...(i.from ? { from: i.from } : {}),
      ...(i.equipmentId ? { equipmentId: i.equipmentId } : {}),
    });
  }
  for (const o of body.outputs) {
    const a = articles.get(o.articleId)!;
    await insert("output", "article", o.articleId, o.quantity, storedUnit(a.unit, o.per), { ...(o.lotId ? { lotId: o.lotId } : {}), ...(o.to ? { to: o.to } : {}) });
  }
  if (body.staffing !== "crews") {
    for (const t of body.tools) await insert("tool", "equipment", t.equipmentId, null, null, null);
    for (const d of body.doers) await insert("doer", "person", d.personId, null, null, null);
    for (const p of body.periods) await period(p);
    await linkTrackSessions(tx, interventionId, body.trackSessionIds ?? []);
    return;
  }
  // Attelages : id client conservé (stable entre deux modifications).
  const clientIds = body.crews.map((c) => c.id).filter((id): id is string => !!id);
  if (new Set(clientIds).size !== clientIds.length) throw new BadRequest("Deux attelages portent le même identifiant.");
  if (clientIds.length) {
    const taken = await rows<{ id: string }>(
      tx,
      sql`SELECT id FROM intervention_crews WHERE id IN (${sql.join(clientIds.map((i) => sql`${i}::uuid`), sql`, `)})`,
    );
    if (taken.length) throw new BadRequest("Identifiant d'attelage déjà utilisé par une autre intervention.");
  }
  for (const [rank, crew] of body.crews.entries()) {
    const crewId = crew.id ?? crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO intervention_crews (id, intervention_id, rank, label, template_id)
      VALUES (${crewId}, ${interventionId}, ${rank}, ${crew.label?.trim() || null},
              -- origine inconnue de la ferme (supprimée, autre ferme) : simplement oubliée
              (SELECT id FROM crew_templates WHERE id = ${crew.templateId ?? null}::uuid))`);
    for (const id of new Set(crew.tools.map((t) => t.equipmentId))) await insert("tool", "equipment", id, null, null, null, undefined, crewId);
    for (const id of new Set(crew.doers.map((d) => d.personId))) await insert("doer", "person", id, null, null, null, undefined, crewId);
    for (const p of crew.periods) await period(p, crewId);
  }
  for (const l of linked) {
    await tx.execute(sql`
      UPDATE track_sessions s SET crew_id = (
        SELECT c.id FROM intervention_crews c
        WHERE c.intervention_id = ${interventionId}
          AND (c.id = ${l.crew_id} OR EXISTS (SELECT 1 FROM intervention_parameters p
                 WHERE p.crew_id = c.id AND p.role = 'tool' AND p.ref_id = s.equipment_id))
        ORDER BY (c.id = ${l.crew_id}) DESC, c.rank LIMIT 1)
      WHERE s.id = ${l.id}`);
  }
  await linkTrackSessions(tx, interventionId, body.trackSessionIds ?? []);
}

/** Irrigation : dose d'eau et matériel, sur les seules procédures d'irrigation (la règle du domaine l'a vérifié). */
async function writeIrrigation(tx: Tx, interventionId: string, body: Pick<Body, "irrigation">) {
  const v = body.irrigation;
  await tx.execute(sql`
    UPDATE interventions SET irrigation = ${v ? JSON.stringify({ depthMm: v.depthMm, method: v.method ?? null }) : null}::jsonb WHERE id = ${interventionId}`);
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

/**
 * FR-ATT-3 : un matériel ou une personne d'un attelage qui travaille aussi,
 * au même moment, dans une autre intervention (non annulée) : avertissement,
 * sans blocage. Les périodes comparées sont celles de l'attelage de chaque
 * côté (toutes les périodes pour une intervention en mode libre).
 */
async function crewOverlapWarnings(tx: Tx, interventionId: string, body: Body): Promise<string[]> {
  if (body.staffing !== "crews") return [];
  const list = await rows<{ name: string; started_at: string; procedure: string }>(
    tx,
    sql`WITH mine AS (
          SELECT p.ref_id, w.started_at, w.stopped_at
          FROM intervention_parameters p
          JOIN intervention_periods w ON w.intervention_id = p.intervention_id AND (p.crew_id IS NULL OR w.crew_id = p.crew_id)
          WHERE p.intervention_id = ${interventionId} AND p.role IN ('tool', 'doer'))
        SELECT DISTINCT ON (m.ref_id, i.id) coalesce(e.name, pe.name) AS name, ow.started_at, i.procedure
        FROM mine m
        JOIN intervention_parameters op ON op.ref_id = m.ref_id AND op.role IN ('tool', 'doer') AND op.intervention_id <> ${interventionId}
        JOIN interventions i ON i.id = op.intervention_id AND i.status <> 'cancelled'
        JOIN intervention_periods ow ON ow.intervention_id = i.id AND (op.crew_id IS NULL OR ow.crew_id = op.crew_id)
        LEFT JOIN equipments e ON e.id = m.ref_id
        LEFT JOIN people pe ON pe.id = m.ref_id
        WHERE ow.started_at < m.stopped_at AND ow.stopped_at > m.started_at
        ORDER BY m.ref_id, i.id, ow.started_at
        LIMIT 20`,
  );
  return list.map(
    (r) =>
      `${r.name ?? "Un matériel"} travaille aussi dans une autre intervention (${getProcedure(r.procedure).label}) le ${new Date(r.started_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}, sur une période qui se chevauche.`,
  );
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
  await recordNitrateCheck(tx, ctx, interventionId, body, mode);
  return result;
}

/**
 * Contrôle nitrates (lot AI, FR-FERT-25) enregistré avec l'intervention :
 * calendrier d'épandage, plan de fumure, premier apport. Une réalisation
 * saisie sur le web pendant une période d'interdiction est refusée sans motif ;
 * le motif (le même que pour le phyto) reste attaché à l'intervention.
 */
/** Température la plus basse et pluie de la météo enregistrée avec l'intervention. */
function weatherOf(w: unknown): { minTemperatureC: number | null; precipitationMm: number | null } | null {
  if (!w || typeof w !== "object") return null;
  const x = w as { temperatureC?: number | null; precipitationMm?: number | null; hours?: { temperatureC: number | null }[] };
  const temps = [x.temperatureC, ...(x.hours ?? []).map((h) => h.temperatureC)].filter((t): t is number => typeof t === "number");
  return { minTemperatureC: temps.length ? Math.min(...temps) : null, precipitationMm: x.precipitationMm ?? null };
}

async function recordNitrateCheck(tx: Tx, ctx: DomainCtx, interventionId: string, body: CheckableBody & { weather?: unknown }, mode: "plan" | "done") {
  const startedAt = body.periods[0]?.startedAt ?? body.plannedAt;
  const parcels = body.targets.filter((t) => t.kind === "land_parcel");
  if (!startedAt || !parcels.length || !body.inputs.length) {
    await tx.execute(sql`UPDATE interventions SET nitrate_check = NULL WHERE id = ${interventionId}`);
    return;
  }
  const [{ farm_id: farmId } = { farm_id: "" }] = await rows<{ farm_id: string }>(tx, sql`SELECT farm_id FROM interventions WHERE id = ${interventionId}`);
  const areaM2 = parcels.every((t) => t.workedAreaM2) ? parcels.reduce((sum, t) => sum + (t.workedAreaM2 ?? 0), 0) : null;
  const check = await checkApplicationTx(tx, farmId, {
    startedAt: new Date(startedAt).toISOString(),
    parcelIds: parcels.map((t) => t.id),
    inputs: body.inputs.map(({ articleId, quantity, per, unit }) => ({ articleId, quantity, per, ...(unit ? { unit } : {}) })),
    areaM2,
    interventionId,
    weather: weatherOf(body.weather),
  });
  if (!check.indicators.length && !check.nitrogen) {
    await tx.execute(sql`UPDATE interventions SET nitrate_check = NULL WHERE id = ${interventionId}`);
    return;
  }
  const reason = body.compliance?.reason?.trim() || null;
  if (mode === "done" && check.level === "danger" && ctx.origin === "web" && !reason) {
    const dangers = check.indicators.filter((i) => i.level === "danger").map((i) => `${i.parcelName ? `${i.parcelName} : ` : ""}${i.message}`);
    throw new DomainError(`Épandage interdit : ${dangers.join(" ")} Pour enregistrer quand même, indiquez un motif.`);
  }
  await tx.execute(sql`UPDATE interventions SET nitrate_check = ${JSON.stringify({ ...check, reason: check.level === "danger" ? reason : null, checkedAt: new Date().toISOString() })}::jsonb WHERE id = ${interventionId}`);
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
  const body = flat(input);
  const bounds = periodBounds(body.periods);
  await tx.execute(sql`
    INSERT INTO interventions (id, farm_id, procedure, status, started_at, stopped_at, origin, client_id, purposes, notes, staffing, bbch)
    VALUES (${id}, ${farmId}, ${input.procedure}, 'planned', ${bounds.startedAt ?? input.plannedAt ?? null}, ${bounds.stoppedAt},
            ${ctx.origin}, ${clientId}, ${sql`ARRAY[${sql.join(input.purposes.map((p) => sql`${p}`), sql`, `)}]::text[]`}, ${input.notes ?? null},
            ${input.staffing ?? "free"}, ${input.bbch ?? null})`);
  await writeBody(tx, id, input, articles);
  await writeMaintenance(tx, farmId, ctx, id, body, false, null);
  await writeIrrigation(tx, id, body);
  await recordCompliance(tx, ctx, id, body, "plan");
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
  raw: InterventionCompleteWrite,
) {
  const articles = await validate(tx, procedure, raw, "complete");
  const input = flat(raw);
  const { startedAt, stoppedAt } = periodBounds(input.periods);
  await writeBody(tx, interventionId, raw, articles);
  await writeMaintenance(tx, farmId, ctx, interventionId, input, true, stoppedAt);
  await writeIrrigation(tx, interventionId, input);
  await recordCompliance(tx, ctx, interventionId, { ...input, procedure }, "done");
  // Contenu (re)écrit : l'IFT sera recalculé (worker, ou à la demande depuis la fiche).
  await tx.execute(sql`UPDATE interventions SET ift = NULL WHERE id = ${interventionId}`);
  const areaHa = await treatedAreaHa(tx, input, stoppedAt!);

  const warnings: string[] = await crewOverlapWarnings(tx, interventionId, input);
  const lines: ResolvedStockLine[] = [];
  for (const i of input.inputs) {
    const article = articles.get(i.articleId)!;
    const quantity = toStockQuantity({ quantity: i.quantity, unit: storedUnit(i.unit ?? article.unit, i.per), articleUnit: article.unit, areaHa, density: article.density });
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
      notes = ${input.notes ?? null}, bbch = ${input.bbch === undefined ? sql`bbch` : input.bbch}, updated_at = now()
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
  raw: InterventionUpdateWrite,
): Promise<{ intervention: Intervention; warnings: string[] }> {
  const input = flat(raw);
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
      const articles = await validate(tx, input.procedure, raw, "plan");
      const bounds = periodBounds(input.periods);
      await writeBody(tx, interventionId, raw, articles);
      await writeMaintenance(tx, farmId, ctx, interventionId, input, false, null);
      await writeIrrigation(tx, interventionId, input);
      await recordCompliance(tx, ctx, interventionId, input, "plan");
      await tx.execute(sql`
        UPDATE interventions SET procedure = ${input.procedure},
          started_at = ${bounds.startedAt ?? input.plannedAt ?? before.startedAt}, stopped_at = ${bounds.stoppedAt},
          purposes = ${sql`ARRAY[${sql.join(input.purposes.map((p) => sql`${p}`), sql`, `)}]::text[]`},
          notes = ${input.notes ?? null}, bbch = ${input.bbch === undefined ? sql`bbch` : input.bbch}, updated_at = now()
        WHERE id = ${interventionId}`);
      warnings.push(...(await crewOverlapWarnings(tx, interventionId, input)));
      await auditAs(tx, farmId, ctx, auditId, interventionId, "updated", { changes, reason, warnings });
      await outbox(tx, farmId, buildEvent(ctx, farmId, "intervention.updated", { interventionId }));
      return { intervention: await readIntervention(tx, interventionId), warnings };
    }

    // Réalisée : correction tracée.
    if (input.periods.length === 0) throw new DomainError("Au moins une période de travail.");
    const reversal = await reverseMovements(tx, farmId, ctx, interventionId);
    const { plan, areaHa, warnings: stockWarnings } = await applyCompletion(tx, farmId, ctx, interventionId, input.procedure, raw);
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
    // Ses parcours GPS redeviennent libres (le worker pourra les recalculer).
    await tx.execute(sql`
      UPDATE track_sessions SET intervention_id = NULL, crew_id = NULL, linked_extent = NULL, drift = NULL
      WHERE intervention_id = ${interventionId}`);
    await audit(tx, farmId, ctx, interventionId, "cancelled", { reason, previousStatus: current.status });
    return readIntervention(tx, interventionId);
  });
}

// ---------------------------------------------------------------------------
// Parcours GPS ajoutés à une intervention existante (FR-GPS-24)
// ---------------------------------------------------------------------------

/** Corps de modification équivalent à une intervention lue (les champs de lecture sont retirés). */
function writeOf(i: Intervention): InterventionUpdateWrite {
  const crews = i.staffing === "crews";
  return interventionUpdateWrite.parse({
    procedure: i.procedure,
    staffing: i.staffing,
    crews: i.crews.map((c) => ({
      id: c.id,
      ...(c.label ? { label: c.label } : {}),
      ...(c.templateId ? { templateId: c.templateId } : {}),
      tools: c.tools,
      doers: c.doers,
      periods: c.periods,
    })),
    periods: crews ? [] : i.periods,
    tools: crews ? [] : i.tools,
    doers: crews ? [] : i.doers,
    targets: i.targets,
    inputs: i.inputs,
    outputs: i.outputs,
    purposes: i.purposes,
    ...(i.notes ? { notes: i.notes } : {}),
    ...(i.bbch ? { bbch: i.bbch.code } : {}),
    ...(i.compliance
      ? {
          compliance: {
            usages: Object.fromEntries(i.compliance.checks.filter((c) => c.usageId).map((c) => [c.articleId, c.usageId!])),
            ...(i.compliance.reason ? { reason: i.compliance.reason } : {}),
          },
        }
      : {}),
    ...(i.weather ? { weather: i.weather } : {}),
    ...(i.maintenance ? { maintenance: i.maintenance } : {}),
    ...(i.irrigation ? { irrigation: i.irrigation } : {}),
  });
}

/**
 * Ajoute des parcours libres à une intervention (FR-GPS-24) : leurs périodes
 * vont à l'attelage du matériel suivi (`crewId`, sinon le premier attelage
 * qui le contient, sinon un nouvel attelage du brouillon), les parcelles
 * manquantes deviennent des cibles. Une intervention en mode libre passe en
 * attelages (un attelage reprend ses moyens). Passe par la modification
 * habituelle : correction tracée si elle est réalisée.
 */
export async function attachTrackSessions(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  interventionId: string,
  sessionIds: string[],
  crewId?: string,
): Promise<{ intervention: Intervention; warnings: string[] }> {
  const { write } = await withFarm(db, farmId, async (tx) => {
    const current = await readIntervention(tx, interventionId);
    if (current.status === "cancelled") throw new Conflict("Intervention annulée : elle ne se modifie plus.");
    const draft = await buildTrackDraft(tx, sessionIds);
    const write = writeOf(current);
    if (write.staffing !== "crews") {
      const crew = { tools: write.tools, doers: write.doers, periods: write.periods };
      write.staffing = "crews";
      write.crews = crew.tools.length && crew.periods.length ? [crew] : [];
      write.tools = [];
      write.doers = [];
      write.periods = [];
    }
    const proposed = draft.body.crews[0]!;
    const tracker = proposed.tools[0]!.equipmentId;
    const k = crewId ? write.crews.findIndex((c) => c.id === crewId) : write.crews.findIndex((c) => c.tools.some((t) => t.equipmentId === tracker));
    if (crewId && k < 0) throw new BadRequest("Attelage inconnu dans cette intervention.");
    if (k < 0) {
      write.crews.push({ tools: proposed.tools, doers: proposed.doers, periods: proposed.periods });
    } else {
      const crew = write.crews[k]!;
      if (!crew.tools.some((t) => t.equipmentId === tracker)) crew.tools.push({ equipmentId: tracker });
      crew.periods = mergePeriods([...crew.periods, ...proposed.periods]);
    }
    const known = new Set(write.targets.map((t) => t.id));
    for (const t of draft.body.targets) {
      if (!known.has(t.id)) write.targets.push(t as (typeof write.targets)[number]);
    }
    write.trackSessionIds = draft.body.trackSessionIds;
    write.reason = "Parcours GPS ajoutés";
    return { write };
  });
  return updateIntervention(db, farmId, ctx, interventionId, write);
}
