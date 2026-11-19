import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import {
  certificationSettings,
  DEFAULT_CERTIFICATION_SETTINGS,
  type CertificationCheck,
  type CertificationSettings,
  type ControlAvailability,
  type ControlKind,
  type ControlReport,
} from "@fourmy/contracts";
import { REFS_VERSION } from "@fourmy/certification-refs";
import {
  DomainError,
  evaluateCampaign,
  evaluateIntervention,
  type CertificationContext,
  type DomainCtx,
  type ParcelCertificationRef,
} from "@fourmy/domain";
import type { CheckableBody } from "./phyto.js";

/**
 * Contrôles HVE et Agriculture biologique, lot CT1
 * (claudedocs/conception_controle_hve_ab.md §5, §6) : disponibilité (menu),
 * rapport d'une campagne (calcul gardé tant que les données ne changent pas),
 * constats de saisie d'une intervention, réglages.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Certification de parcelle (parcel_certifications.kind) → contrôle. */
const KIND_OF: Record<string, ControlKind> = { hve: "hve", organic: "ab" };
const CERT_KINDS: Record<ControlKind, string> = { hve: "hve", ab: "organic" };

// --- Réglages et période ------------------------------------------------------------

async function settingsOf(tx: Tx): Promise<CertificationSettings> {
  const [r] = await rows<{ certification: unknown }>(tx, sql`SELECT certification FROM farm_settings`);
  const parsed = certificationSettings.safeParse(r?.certification ?? {});
  return parsed.success ? parsed.data : DEFAULT_CERTIFICATION_SETTINGS;
}

export async function getCertificationSettings(db: Database, farmId: string): Promise<CertificationSettings> {
  return withFarm(db, farmId, settingsOf);
}

export async function putCertificationSettings(db: Database, farmId: string, body: CertificationSettings): Promise<CertificationSettings> {
  return withFarm(db, farmId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO farm_settings (farm_id, certification) VALUES (${farmId}, ${JSON.stringify(body)}::jsonb)
      ON CONFLICT (farm_id) DO UPDATE SET certification = excluded.certification, updated_at = now()`);
    return body;
  });
}

/**
 * Période contrôlée : AB, l'année civile de la campagne ; HVE, 12 mois qui
 * finissent dans l'année de la campagne, à partir du début réglé (exercice
 * comptable ; le 1er janvier par défaut).
 */
export function controlPeriod(kind: ControlKind, campaign: number, settings: CertificationSettings): { from: string; to: string } {
  if (kind === "ab" || settings.hveCampaignStartMd === "01-01") return { from: `${campaign}-01-01`, to: `${campaign}-12-31` };
  const from = `${campaign - 1}-${settings.hveCampaignStartMd}`;
  const end = new Date(`${campaign}-${settings.hveCampaignStartMd}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, to: end.toISOString().slice(0, 10) };
}

// --- Disponibilité (menu Réglementaire, D2) -----------------------------------------

async function certificationsBetween(tx: Tx, from: string, to: string): Promise<ParcelCertificationRef[]> {
  const list = await rows<{ land_parcel_id: string; kind: string; level: string | null; started_on: string; stopped_on: string | null }>(
    tx,
    sql`SELECT land_parcel_id, kind, level, started_on::text, stopped_on::text FROM parcel_certifications
        WHERE kind IN ('hve', 'organic') AND started_on <= ${to}::date AND (stopped_on IS NULL OR stopped_on >= ${from}::date)`,
  );
  return list.map((c) => ({ parcelId: c.land_parcel_id, kind: KIND_OF[c.kind]!, level: c.level, startedOn: c.started_on, stoppedOn: c.stopped_on }));
}

export async function controlAvailability(db: Database, farmId: string, campaign: number): Promise<ControlAvailability> {
  return withFarm(db, farmId, async (tx) => {
    const certs = await certificationsBetween(tx, `${campaign}-01-01`, `${campaign}-12-31`);
    return { hve: certs.some((c) => c.kind === "hve"), ab: certs.some((c) => c.kind === "ab") };
  });
}

// --- Contexte et rapport d'une campagne -----------------------------------------------

/** Données d'une campagne pour les règles (complété par les lots CT2 à CT5). */
export async function loadCertificationContext(tx: Tx, kind: ControlKind, campaign: number): Promise<CertificationContext> {
  const settings = await settingsOf(tx);
  const period = controlPeriod(kind, campaign, settings);
  const parcels = await rows<{ id: string; name: string; area_m2: number }>(
    tx,
    sql`SELECT DISTINCT ON (lp.id) lp.id, lp.name, v.area_m2::float8 AS area_m2
        FROM land_parcels lp JOIN land_parcel_versions v ON v.land_parcel_id = lp.id
        WHERE v.valid && tstzrange(${period.from}::date, (${period.to}::date + 1))
        ORDER BY lp.id, upper(v.valid) DESC NULLS FIRST`,
  );
  return {
    kind,
    campaign,
    period,
    parcels: parcels.map((p) => ({ id: p.id, name: p.name, areaM2: p.area_m2 })),
    certifications: await certificationsBetween(tx, period.from, period.to),
    settings,
  };
}

/**
 * Empreinte des données lues par les contrôles : nombre de lignes et dernière
 * modification de chaque table. Le calcul enregistré est réutilisé tant
 * qu'elle ne change pas ; un export est « dépassé » quand elle change.
 */
async function dataHash(tx: Tx): Promise<string> {
  const [r] = await rows<{ h: string }>(
    tx,
    sql`SELECT md5(concat_ws('|',
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM parcel_certifications),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM interventions),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM productions),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM articles),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM article_fertilizers),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM cover_crops),
          (SELECT count(*) || ':' || coalesce(max(lower(valid))::text, '') FROM land_parcel_versions),
          (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') || ':' || coalesce(max(hve_validated_at)::text, '') FROM farm_landscape_features),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM hve_questionnaires),
          (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM seed_derogations),
          (SELECT coalesce(certification::text, '') FROM farm_settings))) AS h`,
  );
  return r!.h;
}

type RunRow = { id: string; computed_at: string; data_hash: string; refs_version: string; result: Omit<ControlReport, "computedAt" | "exportedAt" | "changedSinceExport">; exported_at: string | null };

/**
 * Rapport d'une campagne : le dernier calcul si les données et les
 * référentiels n'ont pas changé, sinon un nouveau calcul, enregistré
 * (FR-CTL-6). `changedSinceExport` signale un export dépassé.
 */
export async function controlReport(db: Database, farmId: string, kind: ControlKind, campaign: number): Promise<ControlReport> {
  return withFarm(db, farmId, async (tx) => {
    const hash = await dataHash(tx);
    const [latest] = await rows<RunRow>(
      tx,
      sql`SELECT id, computed_at::text, data_hash, refs_version, result, exported_at::text FROM certification_runs
          WHERE kind = ${kind} AND campaign = ${campaign} ORDER BY computed_at DESC LIMIT 1`,
    );
    const [exported] = await rows<{ exported_at: string; data_hash: string }>(
      tx,
      sql`SELECT exported_at::text, data_hash FROM certification_runs
          WHERE kind = ${kind} AND campaign = ${campaign} AND exported_at IS NOT NULL ORDER BY exported_at DESC LIMIT 1`,
    );
    let run = latest && latest.data_hash === hash && latest.refs_version === REFS_VERSION ? latest : null;
    if (!run) {
      const result = { ...evaluateCampaign(await loadCertificationContext(tx, kind, campaign)), refsVersion: REFS_VERSION };
      const id = randomUUID();
      const [inserted] = await rows<{ computed_at: string }>(
        tx,
        sql`INSERT INTO certification_runs (id, farm_id, kind, campaign, refs_version, data_hash, result)
            VALUES (${id}, ${farmId}, ${kind}, ${campaign}, ${REFS_VERSION}, ${hash}, ${JSON.stringify(result)}::jsonb)
            RETURNING computed_at::text`,
      );
      run = { id, computed_at: inserted!.computed_at, data_hash: hash, refs_version: REFS_VERSION, result, exported_at: null };
    }
    return {
      ...run.result,
      computedAt: new Date(run.computed_at).toISOString(),
      exportedAt: exported ? new Date(exported.exported_at).toISOString() : null,
      changedSinceExport: !!exported && exported.data_hash !== hash,
    };
  });
}

// --- Saisie d'une intervention -----------------------------------------------------

/** Constats de certification d'un brouillon d'intervention, ou `null` (aucune certification, aucune règle). */
export async function checkInterventionCertification(tx: Tx, body: CheckableBody & { justification?: string | null }): Promise<CertificationCheck | null> {
  const at = body.periods[0]?.startedAt ?? body.plannedAt;
  const parcelIds = body.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id);
  if (!at || !parcelIds.length) return null;
  const day = new Date(at).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const certifications = (await certificationsBetween(tx, day, day)).filter((c) => parcelIds.includes(c.parcelId));
  if (!certifications.length) return null;
  const result = evaluateIntervention({
    procedure: body.procedure,
    day,
    parcelIds,
    certifications,
    inputs: body.inputs.map(({ articleId, quantity, per, unit }) => ({ articleId, quantity, per, ...(unit ? { unit } : {}) })),
    equipmentIds: ((body as { tools?: { equipmentId: string }[] }).tools ?? []).map((t) => t.equipmentId),
    justification: body.justification ?? null,
  });
  return result ? { ...result, checkedAt: new Date().toISOString() } : null;
}

export async function checkInterventionCertificationFor(db: Database, farmId: string, body: CheckableBody & { justification?: string | null }) {
  return withFarm(db, farmId, (tx) => checkInterventionCertification(tx, body));
}

/**
 * Enregistre les constats avec l'intervention (comme les contrôles phyto et
 * nitrates). Une réalisation saisie sur le web avec un feu rouge est refusée
 * sans motif ; le motif est celui du contrôle phyto (`compliance.reason`).
 */
export async function recordCertificationCheck(
  tx: Tx,
  ctx: DomainCtx,
  interventionId: string,
  body: CheckableBody & { justification?: string | null; compliance?: { reason?: string | null } },
  mode: "plan" | "done",
): Promise<void> {
  const check = await checkInterventionCertification(tx, body);
  if (!check) {
    await tx.execute(sql`UPDATE interventions SET certification_check = NULL WHERE id = ${interventionId}`);
    return;
  }
  const reason = body.compliance?.reason?.trim() || null;
  if (mode === "done" && check.level === "danger" && ctx.origin === "web" && !reason) {
    const dangers = check.findings.filter((f) => f.level === "danger").map((f) => f.message);
    throw new DomainError(`Certification : ${dangers.join(" ")} Pour enregistrer quand même, indiquez un motif.`);
  }
  await tx.execute(sql`UPDATE interventions SET certification_check = ${JSON.stringify({ ...check, reason: check.level === "danger" ? reason : null })}::jsonb WHERE id = ${interventionId}`);
}

export { CERT_KINDS };
