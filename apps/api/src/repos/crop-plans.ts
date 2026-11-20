import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { cycleFromLexicon, REFS_VERSION, type CropCycle } from "@fourmy/certification-refs";
import {
  cropPlanSettings,
  type ActivityFamily,
  type ControlSection,
  type CropPlanChange,
  type CropPlanContext,
  type CropPlanDraft,
  type CropPlanDraftWrite,
  type CropPlanListItem,
  type CropPlanSettings,
  type CropPlanValidateWrite,
  type CropPlanValidation,
  type CropPlanVersionView,
  type CropPlanView,
  type CropPlanYearCrop,
} from "@fourmy/contracts";
import { checkCropPlan, cropPlanCheckInput, diffCropPlan, emptyDraft, parcelKeyOf, resolveParcels, type ExistingProduction } from "@fourmy/domain";
import { Conflict, NotFound } from "../routes/helpers.js";
import { natureOf } from "./activities.js";
import { getCertificationSettings } from "./certification-controls.js";

/**
 * Assolement prévisionnel, lot AS2a (claudedocs/conception_assolement.md §3,
 * §5, §6) : brouillon d'une campagne, contexte des contrôles, validation
 * (productions), réouverture, versions. Découpes et fusions : lot AS3 ;
 * couverts : lot AS4.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const uuids = (ids: string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;
const HISTORY_YEARS = 5;

/** Rôle d'une production : celui fixé par l'assolement, sinon « dérobée » des imports. */
const ROLE = sql`coalesce(p.attrs->'cropPlan'->>'role', CASE WHEN p.attrs->>'secondary' = 'true' THEN 'secondary' ELSE 'main' END)`;

/** Code culture PAC d'une activité : saisi, sinon celui de sa production de référence (Lexicon). */
const activityCapCode = (year: SQL | number) => sql`coalesce(a.cap_code, (
  SELECT c.cap_code FROM lexicon_cap_codes c WHERE c.production = a.reference AND c.year <= ${year}
  ORDER BY c.year DESC, c.is_seed, c.cap_code LIMIT 1))`;

/** L'espèce descend-elle des Fabacées (taxonomie Lexicon) ? */
const legumeOf = (species: SQL) => sql`EXISTS (WITH RECURSIVE l AS (
  SELECT reference_name, parent, 0 AS depth FROM taxonomy WHERE reference_name = ${species}
  UNION ALL SELECT x.reference_name, x.parent, l.depth + 1 FROM taxonomy x JOIN l ON x.reference_name = l.parent WHERE l.depth < 30)
  SELECT 1 FROM l WHERE reference_name = 'fabaceae')`;

// --- Réglages -------------------------------------------------------------

async function settingsOf(tx: Tx): Promise<CropPlanSettings> {
  const [r] = await rows<{ crop_plan: unknown }>(tx, sql`SELECT crop_plan FROM farm_settings`);
  return cropPlanSettings.parse(r?.crop_plan ?? undefined);
}

export async function getCropPlanSettings(db: Database, farmId: string): Promise<CropPlanSettings> {
  return withFarm(db, farmId, settingsOf);
}

export async function putCropPlanSettings(db: Database, farmId: string, body: CropPlanSettings): Promise<CropPlanSettings> {
  return withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, crop_plan) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET crop_plan = excluded.crop_plan, updated_at = now()`);
    return body;
  });
}

// --- Contexte des contrôles (§4.1) ------------------------------------------------

/** Parcellaire de la campagne : chaque parcelle dans sa dernière version qui recouvre l'année. */
async function baseParcels(tx: Tx, year: number) {
  return rows<{ id: string; name: string; area_m2: number; shape: string }>(
    tx,
    sql`SELECT lp.id, lp.name, v.area_m2::float8 AS area_m2, ST_AsGeoJSON(v.shape) AS shape
        FROM land_parcels lp
        JOIN LATERAL (
          SELECT v.area_m2, v.shape FROM land_parcel_versions v
          WHERE v.land_parcel_id = lp.id AND v.valid && tstzrange(make_date(${year}, 1, 1)::timestamptz, make_date(${year + 1}, 1, 1)::timestamptz)
          ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
        ORDER BY lp.name`,
  );
}

async function contextActivities(tx: Tx, year: number): Promise<CropPlanContext["activities"]> {
  const list = await rows<{
    id: string;
    name: string;
    family: ActivityFamily;
    color: string | null;
    cap_code: string | null;
    species: string | null;
    life_years: number | null;
    usage: string | null;
    legume: boolean;
  }>(
    tx,
    sql`SELECT a.id, a.name, a.family, a.color, ${activityCapCode(year)} AS cap_code,
               coalesce(a.cultivation, lx.specie) AS species, lx.life_years::float8 AS life_years, lx.usage,
               ${legumeOf(sql`coalesce(a.cultivation, lx.specie)`)} AS legume
        FROM activities a LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        ORDER BY a.suspended, a.family, a.name`,
  );
  return list
    .filter((a) => natureOf(a.family))
    .map((a) => ({
      id: a.id,
      name: a.name,
      family: a.family,
      color: a.color,
      capCode: a.cap_code,
      species: a.species,
      cycle: cycleFromLexicon(a.life_years, a.usage) as CropCycle,
      legume: a.legume,
      vegetable: a.usage === "vegetable",
    }));
}

/** Historique des parcelles (Y-5 à Y-1) : culture principale (en place au 1er juin), culture secondaire. */
async function history(tx: Tx, parcelIds: string[], year: number): Promise<CropPlanContext["history"]> {
  const out: CropPlanContext["history"] = {};
  if (!parcelIds.length) return out;
  const list = await rows<{
    land_parcel_id: string;
    year: number;
    cap_code: string | null;
    species: string | null;
    label: string | null;
    life_years: number | null;
    usage: string | null;
    cycle: CropCycle | null;
    legume: boolean;
    cover_legume: boolean;
    secondary: boolean;
  }>(
    tx,
    sql`SELECT DISTINCT ON (p.land_parcel_id, c.year) p.land_parcel_id, c.year,
               coalesce(p.attrs->>'capCode', ${activityCapCode(sql`c.year`)}) AS cap_code,
               coalesce(a.cultivation, lx.specie, p.cultivation) AS species, coalesce(a.name, lx.label, p.nature) AS label,
               lx.life_years::float8 AS life_years, lx.usage, p.cycle,
               ${legumeOf(sql`coalesce(a.cultivation, lx.specie, p.cultivation)`)} AS legume,
               EXISTS (SELECT 1 FROM cover_crops cc WHERE cc.land_parcel_id = p.land_parcel_id AND cc.campaign = c.year AND cc.family LIKE '%legumineuses%') AS cover_legume,
               -- Culture secondaire après la principale : dérobée de la campagne, ou couvert de la campagne suivante
               -- semé au plus tard le 15 novembre et en place jusqu'au 15 février (BCAE 7, §3 A).
               (EXISTS (SELECT 1 FROM productions p2 JOIN activities a2 ON a2.id = p2.activity_id
                        WHERE p2.land_parcel_id = p.land_parcel_id AND p2.campaign_id = p.campaign_id
                          AND coalesce(p2.attrs->'cropPlan'->>'role', CASE WHEN p2.attrs->>'secondary' = 'true' THEN 'secondary' ELSE 'main' END) = 'secondary')
                OR EXISTS (SELECT 1 FROM cover_crops cc WHERE cc.land_parcel_id = p.land_parcel_id AND cc.campaign = c.year + 1
                           AND cc.sown_on <= make_date(c.year, 11, 15) AND (cc.destroyed_on IS NULL OR cc.destroyed_on >= make_date(c.year + 1, 2, 15)))) AS secondary
        FROM productions p
        JOIN campaigns c ON c.id = p.campaign_id
        LEFT JOIN activities a ON a.id = p.activity_id
        LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference
        WHERE p.land_parcel_id = ANY(${uuids(parcelIds)}) AND c.year >= ${year - HISTORY_YEARS} AND c.year < ${year}
        ORDER BY p.land_parcel_id, c.year,
                 (${ROLE} = 'secondary'),
                 NOT (coalesce(p.started_on, '-infinity') <= make_date(c.year, 6, 1) AND coalesce(p.stopped_on, 'infinity') >= make_date(c.year, 6, 1)),
                 p.created_at`,
  );
  for (const r of list) {
    const cycle = r.cycle ?? cycleFromLexicon(r.life_years, r.usage);
    const crop: CropPlanYearCrop = {
      main: r.cap_code,
      secondary: r.secondary,
      species: r.species,
      label: r.label,
      legume: r.legume,
      coverLegume: r.cover_legume,
      vegetable: r.usage === "vegetable",
      perennial: cycle !== "annual",
    };
    (out[r.land_parcel_id] ??= {})[String(r.year)] = crop;
  }
  return out;
}

async function loadContext(tx: Tx, year: number, abRotation: CropPlanContext["certification"]["abRotation"]): Promise<CropPlanContext> {
  const parcels = await baseParcels(tx, year);
  const ids = parcels.map((p) => p.id);
  const activities = await contextActivities(tx, year);
  const hist = await history(tx, ids, year);
  const previous = await rows<{ activity_id: string; m2: number }>(
      tx,
      sql`SELECT p.activity_id, sum(v.area_m2)::float8 AS m2
          FROM productions p JOIN campaigns c ON c.id = p.campaign_id
          JOIN LATERAL (SELECT v.area_m2 FROM land_parcel_versions v WHERE v.land_parcel_id = p.land_parcel_id
                        AND v.valid && tstzrange(make_date(c.year, 1, 1)::timestamptz, make_date(c.year + 1, 1, 1)::timestamptz)
                        ORDER BY upper(v.valid) DESC NULLS FIRST LIMIT 1) v ON true
          WHERE c.year = ${year - 1} AND p.activity_id IS NOT NULL AND ${ROLE} = 'main'
          GROUP BY p.activity_id`,
  );
  const certs = await rows<{ land_parcel_id: string; kind: string; started_on: string }>(
      tx,
      sql`SELECT land_parcel_id, kind, min(started_on)::text AS started_on FROM parcel_certifications
          WHERE kind IN ('organic', 'hve') AND started_on <= make_date(${year}, 12, 31) AND (stopped_on IS NULL OR stopped_on >= make_date(${year}, 1, 1))
          GROUP BY land_parcel_id, kind`,
  );
  const settings = await settingsOf(tx);
  return {
    year,
    parcels: parcels.map((p) => ({ id: p.id, name: p.name, areaM2: p.area_m2, shape: JSON.parse(p.shape) as unknown })),
    activities,
    history: hist,
    previousByActivity: Object.fromEntries(previous.map((r) => [r.activity_id, r.m2])),
    certification: {
      abParcels: Object.fromEntries(certs.filter((c) => c.kind === "organic").map((c) => [c.land_parcel_id, { conversionStart: c.started_on }])),
      hve: certs.some((c) => c.kind === "hve"),
      abRotation,
    },
    settings,
    refsVersion: REFS_VERSION,
  };
}

/** Réglages de la rotation AB (contrôle AB), lus hors de la transaction de l'assolement. */
async function abRotationOf(db: Database, farmId: string) {
  const s = await getCertificationSettings(db, farmId);
  return { years: s.rotationYears, sameSpeciesMax: s.rotationSameSpeciesMax };
}

export async function getCropPlanContext(db: Database, farmId: string, year: number): Promise<CropPlanContext> {
  const abRotation = await abRotationOf(db, farmId);
  return withFarm(db, farmId, (tx) => loadContext(tx, year, abRotation));
}

// --- Productions de la campagne -------------------------------------------------

async function campaignOf(tx: Tx, year: number) {
  const [c] = await rows<{ id: string }>(tx, sql`SELECT id FROM campaigns WHERE year = ${year} LIMIT 1`);
  return c ?? null;
}

/** Productions de la campagne rattachées à une activité (celles sans activité ne sont pas touchées). */
async function existingProductions(tx: Tx, year: number): Promise<ExistingProduction[]> {
  const list = await rows<{
    id: string;
    land_parcel_id: string;
    activity_id: string;
    role: "main" | "secondary";
    started_on: string | null;
    stopped_on: string | null;
    done: boolean;
  }>(
    tx,
    sql`SELECT p.id, p.land_parcel_id, p.activity_id, ${ROLE} AS role, p.started_on::text, p.stopped_on::text,
               EXISTS (SELECT 1 FROM interventions i
                       JOIN intervention_parameters t ON t.intervention_id = i.id AND t.role = 'target' AND t.ref_type = 'land_parcel'
                       WHERE i.status = 'done' AND t.ref_id = p.land_parcel_id
                         AND fourmy_production_at(p.land_parcel_id, (i.started_at AT TIME ZONE 'Europe/Paris')::date) = p.id) AS done
        FROM productions p JOIN campaigns c ON c.id = p.campaign_id
        WHERE c.year = ${year} AND p.activity_id IS NOT NULL
        ORDER BY p.created_at`,
  );
  return list.map((r) => ({
    id: r.id,
    landParcelId: r.land_parcel_id,
    activityId: r.activity_id,
    role: r.role,
    startedOn: r.started_on,
    stoppedOn: r.stopped_on,
    hasDoneInterventions: r.done,
  }));
}

/** État actuel de la campagne sous forme de brouillon (création, réouverture, assolement validé). */
async function liveDraft(tx: Tx, year: number): Promise<CropPlanDraft> {
  const prods = await existingProductions(tx, year);
  return {
    ...emptyDraft(year),
    assignments: prods.map((p) => ({
      id: p.id,
      key: parcelKeyOf(p.landParcelId),
      role: p.role,
      activityId: p.activityId,
      startedOn: p.startedOn,
      stoppedOn: p.stoppedOn,
      productionId: p.id,
    })),
  };
}

// --- Assolement --------------------------------------------------------------

type PlanRow = {
  id: string;
  year: number;
  status: "draft" | "validated";
  draft: CropPlanDraft | null;
  revision: number;
  current_version: number | null;
  updated_at: string;
};

async function planRow(tx: Tx, year: number, lock = false) {
  const [p] = await rows<PlanRow>(
    tx,
    sql`SELECT id, year, status, draft, revision, current_version, updated_at::text FROM crop_plans WHERE year = ${year} ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  return p ?? null;
}

async function view(tx: Tx, p: PlanRow): Promise<CropPlanView> {
  const versions = await rows<{ version: number; validated_at: string; validated_by: string | null; reason: string | null }>(
    tx,
    sql`SELECT version, validated_at::text, validated_by, reason FROM crop_plan_versions WHERE plan_id = ${p.id} ORDER BY version DESC`,
  );
  return {
    year: p.year,
    status: p.status,
    revision: p.revision,
    draft: p.status === "draft" && p.draft ? p.draft : await liveDraft(tx, p.year),
    currentVersion: p.current_version,
    versions: versions.map((v) => ({ version: v.version, validatedAt: v.validated_at, validatedBy: v.validated_by, reason: v.reason })),
    updatedAt: p.updated_at,
  };
}

export async function listCropPlans(db: Database, farmId: string): Promise<CropPlanListItem[]> {
  return withFarm(db, farmId, async (tx) => {
    const list = await rows<PlanRow>(tx, sql`SELECT year, status, current_version, updated_at::text FROM crop_plans ORDER BY year DESC`);
    return list.map((p) => ({ year: p.year, status: p.status, currentVersion: p.current_version, updatedAt: p.updated_at }));
  });
}

export async function getCropPlan(db: Database, farmId: string, year: number): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    return view(tx, p);
  });
}

/** Crée l'assolement : brouillon de départ = productions déjà saisies pour la campagne (imports, saisie). */
export async function createCropPlan(db: Database, farmId: string, year: number, userId: string): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    if (await planRow(tx, year)) throw new Conflict(`L'assolement ${year} existe déjà.`);
    const draft = await liveDraft(tx, year);
    await tx.execute(sql`INSERT INTO crop_plans (id, farm_id, year, status, draft, updated_by)
                         VALUES (${crypto.randomUUID()}, ${farmId}, ${year}, 'draft', ${JSON.stringify(draft)}::jsonb, ${userId})`);
    return view(tx, (await planRow(tx, year))!);
  });
}

/** Erreur 409 qui rend l'assolement du serveur (deux onglets, deux responsables). */
export class StaleCropPlan extends Error {
  constructor(readonly current: CropPlanView) {
    super("L'assolement a été modifié entre-temps.");
  }
}

export async function saveCropPlanDraft(db: Database, farmId: string, year: number, body: CropPlanDraftWrite, userId: string): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, true);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.revision !== body.revision) throw new StaleCropPlan(await view(tx, p));
    if (body.draft.year !== year) throw new Conflict("Le brouillon ne porte pas sur cette campagne.");
    await tx.execute(sql`UPDATE crop_plans SET status = 'draft', draft = ${JSON.stringify(body.draft)}::jsonb, revision = revision + 1,
                         updated_at = now(), updated_by = ${userId} WHERE id = ${p.id}`);
    return view(tx, (await planRow(tx, year))!);
  });
}

/** Rouvre un assolement validé : le brouillon repart de l'état actuel des productions. */
export async function reopenCropPlan(db: Database, farmId: string, year: number, userId: string): Promise<CropPlanView> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, true);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.status === "draft") return view(tx, p);
    const draft = await liveDraft(tx, year);
    await tx.execute(sql`UPDATE crop_plans SET status = 'draft', draft = ${JSON.stringify(draft)}::jsonb, revision = revision + 1,
                         updated_at = now(), updated_by = ${userId} WHERE id = ${p.id}`);
    return view(tx, (await planRow(tx, year))!);
  });
}

/** Abandonne le brouillon : retour à la dernière version, ou suppression d'un assolement jamais validé. */
export async function discardCropPlanDraft(db: Database, farmId: string, year: number, userId: string): Promise<CropPlanView | null> {
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, true);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.current_version === null) {
      await tx.execute(sql`DELETE FROM crop_plans WHERE id = ${p.id}`);
      return null;
    }
    await tx.execute(sql`UPDATE crop_plans SET status = 'validated', draft = NULL, revision = revision + 1,
                         updated_at = now(), updated_by = ${userId} WHERE id = ${p.id}`);
    return view(tx, (await planRow(tx, year))!);
  });
}

// --- Validation (§6) -----------------------------------------------------------

/**
 * Aperçu (dryRun) ou application du brouillon : productions créées,
 * modifiées, supprimées, puis version figée. Découpes et fusions ne sont
 * pas encore appliquées (lot AS3) : bloquant.
 */
export async function validateCropPlan(
  db: Database,
  farmId: string,
  year: number,
  body: CropPlanValidateWrite,
  opts: { dryRun: boolean; userId: string },
): Promise<CropPlanValidation> {
  const abRotation = await abRotationOf(db, farmId);
  return withFarm(db, farmId, async (tx) => {
    const p = await planRow(tx, year, !opts.dryRun);
    if (!p) throw new NotFound(`Pas d'assolement ${year}`);
    if (p.revision !== body.revision) throw new StaleCropPlan(await view(tx, p));
    if (p.status !== "draft" || !p.draft) throw new Conflict("L'assolement est déjà validé : rouvrez-le pour le modifier.");
    const draft = p.draft;

    const context = await loadContext(tx, year, abRotation);
    const { sections } = checkCropPlan(cropPlanCheckInput(context, draft));
    const resolved = resolveParcels(context.parcels, draft);
    const campaign = await campaignOf(tx, year);
    const existing = campaign ? await existingProductions(tx, year) : [];
    const { changes, blockers } = diffCropPlan(draft, resolved, existing, { campaignExists: !!campaign });
    const activityIds = new Set(context.activities.map((a) => a.id));
    const unknownActivities = draft.assignments.filter((a) => !activityIds.has(a.activityId));
    if (unknownActivities.length) {
      blockers.push({ code: "unknown-parcel", message: `${unknownActivities.length} culture(s) prévue(s) avec une activité inconnue ou sans parcelles.`, keys: unknownActivities.map((a) => a.key) });
    }
    if (draft.operations.length) {
      blockers.push({ code: "operation", message: "Les découpes et fusions de parcelles ne sont pas encore appliquées par la validation (prochaine version).", keys: [] });
    }

    if (opts.dryRun || blockers.length) return { dryRun: opts.dryRun, changes, blockers, sections, version: null };

    const applied = await applyChanges(tx, farmId, year, changes, draft);
    const version = (p.current_version ?? 0) + 1;
    await tx.execute(sql`INSERT INTO crop_plan_versions (plan_id, version, farm_id, validated_by, reason, snapshot, changes, findings, refs_version)
                         VALUES (${p.id}, ${version}, ${farmId}, ${opts.userId}, ${body.reason ?? null}, ${JSON.stringify(applied)}::jsonb,
                                 ${JSON.stringify(changes)}::jsonb, ${JSON.stringify(sections)}::jsonb, ${context.refsVersion})`);
    await tx.execute(sql`UPDATE crop_plans SET status = 'validated', draft = NULL, revision = revision + 1, current_version = ${version},
                         updated_at = now(), updated_by = ${opts.userId} WHERE id = ${p.id}`);
    return { dryRun: false, changes, blockers, sections, version };
  });
}

/** Applique les changements ; rend le brouillon avec les productions créées (instantané de la version). */
async function applyChanges(tx: Tx, farmId: string, year: number, changes: CropPlanChange[], draft: CropPlanDraft): Promise<CropPlanDraft> {
  let campaign = await campaignOf(tx, year);
  if (!campaign) {
    campaign = { id: crypto.randomUUID() };
    await tx.execute(sql`INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on)
                         VALUES (${campaign.id}, ${farmId}, ${year}, make_date(${year}, 1, 1), make_date(${year}, 12, 31))`);
  }
  const created = new Map<string, string>();
  const parcelId = (key: string) => key.slice(2);
  const fields = (f: { activityId: string; role: string; startedOn: string | null; stoppedOn: string | null }) => sql`
    activity_id = ${f.activityId},
    nature = (SELECT CASE a.family WHEN 'vine_farming' THEN 'vine' WHEN 'animal_farming' THEN 'grassland' ELSE 'field_crop' END FROM activities a WHERE a.id = ${f.activityId}),
    cultivation = (SELECT coalesce(a.cultivation, lx.specie) FROM activities a LEFT JOIN lexicon_productions lx ON lx.reference_name = a.reference WHERE a.id = ${f.activityId}),
    started_on = ${f.startedOn}::date, stopped_on = ${f.stoppedOn}::date,
    attrs = coalesce(attrs, '{}'::jsonb) || jsonb_build_object('cropPlan', jsonb_build_object('role', ${f.role}::text)),
    updated_at = now()`;
  for (const c of changes) {
    if (c.kind === "production.delete") {
      await tx.execute(sql`DELETE FROM productions WHERE id = ${c.productionId}`);
    } else if (c.kind === "production.update") {
      await tx.execute(sql`UPDATE productions SET ${fields(c.after)} WHERE id = ${c.productionId}`);
    } else if (c.kind === "production.create") {
      const id = crypto.randomUUID();
      created.set(c.assignmentId, id);
      await tx.execute(sql`INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, activity_id)
                           VALUES (${id}, ${farmId}, ${campaign.id}, ${parcelId(c.key)}, 'field_crop', ${c.after.activityId})`);
      await tx.execute(sql`UPDATE productions SET ${fields(c.after)} WHERE id = ${id}`);
    }
  }
  return { ...draft, assignments: draft.assignments.map((a) => (created.has(a.id) ? { ...a, productionId: created.get(a.id)! } : a)) };
}

export async function getCropPlanVersion(db: Database, farmId: string, year: number, version: number): Promise<CropPlanVersionView> {
  return withFarm(db, farmId, async (tx) => {
    const [v] = await rows<{
      version: number;
      validated_at: string;
      validated_by: string | null;
      reason: string | null;
      snapshot: CropPlanDraft;
      changes: CropPlanChange[];
      findings: ControlSection[];
      refs_version: string;
    }>(
      tx,
      sql`SELECT v.version, v.validated_at::text, v.validated_by, v.reason, v.snapshot, v.changes, v.findings, v.refs_version
          FROM crop_plan_versions v JOIN crop_plans p ON p.id = v.plan_id WHERE p.year = ${year} AND v.version = ${version}`,
    );
    if (!v) throw new NotFound("Version introuvable");
    return {
      version: v.version,
      validatedAt: v.validated_at,
      validatedBy: v.validated_by,
      reason: v.reason,
      snapshot: v.snapshot,
      changes: v.changes,
      findings: v.findings,
      refsVersion: v.refs_version,
    };
  });
}
