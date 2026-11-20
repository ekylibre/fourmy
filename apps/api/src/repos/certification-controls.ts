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
  type ArticleCopperWrite,
  type ProductionCertificationWrite,
  type HveIaeItem,
  type LandscapeFeatureHveWrite,
} from "@fourmy/contracts";
import { BadRequest, NotFound } from "../routes/helpers.js";
import { IAE_BY_CODE, iaeEquivalentM2 } from "@fourmy/certification-refs";
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
import { abApplications, abDraftApplications, abParcelInputs, abProductions } from "./certification-ab.js";
import { loadHveBiodiversity, loadHveFertilization, loadHveIrrigation, loadHvePhyto } from "./certification-hve.js";
import { untreatedIaeM2 } from "@fourmy/domain";
import { abStatuses, type AbParcelStatus } from "@fourmy/domain";

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
  const certifications = await certificationsBetween(tx, period.from, period.to);
  const list = parcels.map((p) => ({ id: p.id, name: p.name, areaM2: p.area_m2 }));
  const ctx: CertificationContext = { kind, campaign, period, parcels: list, certifications, settings };
  if (kind === "ab") {
    const abParcels = abParcelInputs(list, certifications);
    const ids = abParcels.map((p) => p.id);
    // Cuivre : 7 ans glissants ; conversion : depuis le début de la certification la plus ancienne.
    const since = [`${campaign - 7}-01-01`, ...abParcels.map((p) => p.startedOn)].sort()[0]!;
    ctx.ab = { parcels: abParcels, productions: await abProductions(tx, ids, period.from, period.to), applications: await abApplications(tx, ids, since, period.to) };
  }
  if (kind === "hve") {
    const phyto = await loadHvePhyto(tx, campaign, period, settings);
    const fertilization = await loadHveFertilization(tx, campaign, period, settings, phyto.years[0]?.parcels ?? []);
    const biodiversity = await loadHveBiodiversity(tx, campaign, period, fertilization.parcels);
    // 5.2 : les IAE validées comptent comme surfaces non traitées.
    phyto.untreatedIaeM2 = untreatedIaeM2(biodiversity);
    ctx.hve = { phyto, fertilization, irrigation: await loadHveIrrigation(tx, campaign, period), biodiversity };
  }
  return ctx;
}

/** IAE de la campagne HVE (onglet IAE) : type proposé ou validé, surface équivalente, adjacence. */
export async function hveIaeList(db: Database, farmId: string, campaign: number): Promise<{ campaign: number; items: HveIaeItem[] }> {
  return withFarm(db, farmId, async (tx) => {
    const ctx = await loadCertificationContext(tx, "hve", campaign);
    const b = ctx.hve!.biodiversity!;
    const caps = await rows<{ id: string; cap_type: string | null; hve_type: string | null }>(tx, sql`SELECT id, cap_type, hve_type FROM farm_landscape_features`);
    const capOf = new Map(caps.map((c) => [c.id, c]));
    return {
      campaign,
      items: b.iae.map((f) => {
        const t = f.type ? IAE_BY_CODE[f.type] : undefined;
        return {
          id: f.id,
          label: f.label,
          capType: capOf.get(f.id)?.cap_type ?? null,
          type: f.type,
          proposed: !capOf.get(f.id)?.hve_type && !!f.type,
          validated: f.validated,
          shared: f.shared,
          quantity: Math.round(f.quantity * 10) / 10,
          unit: t?.unit ?? null,
          equivalentM2: t ? Math.round(iaeEquivalentM2(t, f.quantity)) : null,
          onArable: f.onArable,
        };
      }),
    };
  });
}

/** Validation d'une IAE : type HVE (null : pas une IAE), mitoyenneté. */
export async function putLandscapeFeatureHve(db: Database, farmId: string, id: string, w: LandscapeFeatureHveWrite): Promise<void> {
  if (w.type !== null && !IAE_BY_CODE[w.type]) throw new BadRequest(`Type d'IAE inconnu : ${w.type}.`);
  await withFarm(db, farmId, async (tx) => {
    const [f] = await rows<{ id: string }>(
      tx,
      sql`UPDATE farm_landscape_features SET hve_type = ${w.type}, hve_shared = ${w.shared},
            hve_validated_at = ${w.validated && w.type !== null ? sql`now()` : sql`NULL`}
          WHERE id = ${id} RETURNING id`,
    );
    if (!f) throw new NotFound("Élément du paysage introuvable.");
  });
}

/** Parcelles irriguées d'une campagne HVE et leurs données d'irrigation (onglet Irrigation). */
export async function hveIrrigatedParcels(db: Database, farmId: string, campaign: number) {
  return withFarm(db, farmId, async (tx) => {
    const settings = await settingsOf(tx);
    const period = controlPeriod("hve", campaign, settings);
    const ctx = await loadHveIrrigation(tx, campaign, period);
    return { campaign, period, items: ctx.parcels, irrigations: ctx.irrigations.length };
  });
}

/** Statut de conversion des parcelles AB d'une campagne (onglet Parcelles). */
export async function abParcelStatuses(db: Database, farmId: string, campaign: number): Promise<{ campaign: number; period: { from: string; to: string }; items: AbParcelStatus[] }> {
  return withFarm(db, farmId, async (tx) => {
    const ctx = await loadCertificationContext(tx, "ab", campaign);
    return { campaign, period: ctx.period, items: abStatuses(ctx) };
  });
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
          (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') || ':' || coalesce(md5(string_agg(id::text || coalesce(hve_type, '') || hve_shared::text || coalesce(hve_validated_at::text, ''), ',' ORDER BY id)), '') FROM farm_landscape_features),
          (SELECT count(*) || ':' || coalesce(max(updated_at)::text, '') FROM hve_questionnaires),
          (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM seed_derogations),
          (SELECT coalesce(certification::text, '') FROM farm_settings),
          -- IFT calculés après coup (le worker n'avance pas updated_at) ; siège (références IFT).
          (SELECT count(*) || ':' || coalesce(max(ift->>'computedAt'), '') FROM interventions WHERE ift IS NOT NULL),
          (SELECT coalesce(max(updated_at)::text, '') FROM farm_sites))) AS h`,
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
export async function checkInterventionCertification(
  tx: Tx,
  body: CheckableBody & { justification?: string | null },
  interventionId: string | null = null,
): Promise<CertificationCheck | null> {
  const at = body.periods[0]?.startedAt ?? body.plannedAt;
  const parcelIds = body.targets.filter((t) => t.kind === "land_parcel").map((t) => t.id);
  if (!at || !parcelIds.length) return null;
  const day = new Date(at).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const certifications = (await certificationsBetween(tx, day, day)).filter((c) => parcelIds.includes(c.parcelId));
  if (!certifications.length) return null;
  const abParcelIds = [...new Set(certifications.filter((c) => c.kind === "ab").map((c) => c.parcelId))];
  let ab: Parameters<typeof evaluateIntervention>[0]["ab"];
  if (abParcelIds.length) {
    const areas = await rows<{ id: string; name: string; area_m2: number }>(
      tx,
      sql`SELECT lp.id, lp.name, v.area_m2::float8 AS area_m2 FROM land_parcels lp
          JOIN land_parcel_versions v ON v.land_parcel_id = lp.id AND v.valid @> ${day}::date::timestamptz
          WHERE lp.id IN (${sql.join(parcelIds.map((id) => sql`${id}`), sql`, `)})`,
    );
    const worked = new Map(body.targets.filter((t) => t.kind === "land_parcel").map((t) => [t.id, (t as { workedAreaM2?: number }).workedAreaM2]));
    const current = await abDraftApplications(tx, {
      day,
      interventionId: interventionId ?? "draft",
      parcels: areas.map((a) => ({ id: a.id, areaM2: worked.get(a.id) ?? a.area_m2 })),
      abParcelIds,
      inputs: body.inputs,
    });
    const history = await abApplications(tx, abParcelIds, `${Number(day.slice(0, 4)) - 7}-01-01`, `${day.slice(0, 4)}-12-31`, interventionId);
    ab = { parcels: areas.filter((a) => abParcelIds.includes(a.id)).map((a) => ({ id: a.id, name: a.name })), current, history };
  }
  // HVE (lot CT3) : produits phytopharmaceutiques saisis, pour le classement CMR à la date.
  let hve: Parameters<typeof evaluateIntervention>[0]["hve"];
  if (certifications.some((c) => c.kind === "hve") && body.inputs.length) {
    const ids = [...new Set(body.inputs.map((i) => i.articleId))];
    const products = await rows<{ id: string; name: string; amm: string | null }>(
      tx,
      sql`SELECT id, name, nullif(btrim(amm), '') AS amm FROM articles WHERE kind = 'phyto' AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
    );
    hve = { products: products.map((p) => ({ articleId: p.id, product: p.name, authorization: p.amm })) };
  }
  const result = evaluateIntervention({
    procedure: body.procedure,
    day,
    parcelIds,
    certifications,
    inputs: body.inputs.map(({ articleId, quantity, per, unit }) => ({ articleId, quantity, per, ...(unit ? { unit } : {}) })),
    equipmentIds: ((body as { tools?: { equipmentId: string }[] }).tools ?? []).map((t) => t.equipmentId),
    justification: body.justification ?? null,
    ...(ab ? { ab } : {}),
    ...(hve ? { hve } : {}),
  });
  return result ? { ...result, checkedAt: new Date().toISOString() } : null;
}

export async function checkInterventionCertificationFor(db: Database, farmId: string, body: CheckableBody & { justification?: string | null }, interventionId: string | null = null) {
  return withFarm(db, farmId, (tx) => checkInterventionCertification(tx, body, interventionId));
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
  const check = await checkInterventionCertification(tx, body, interventionId);
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

// --- Saisies propres aux contrôles AB (lot CT2) ---------------------------------------

/** Teneur en cuivre métal d'un produit phytopharmaceutique (null : effacée, retour à E-Phy). */
export async function putArticleCopper(db: Database, farmId: string, articleId: string, w: ArticleCopperWrite): Promise<void> {
  await withFarm(db, farmId, async (tx) => {
    const [a] = await rows<{ id: string }>(
      tx,
      sql`UPDATE articles SET copper_metal_g = ${w.g}, copper_metal_per = ${w.g === null ? null : w.per}, updated_at = now()
          WHERE id = ${articleId} AND kind = 'phyto' RETURNING id`,
    );
    if (!a) throw new NotFound("Produit phytopharmaceutique introuvable.");
  });
}

/** Cycle, date de plantation et mode de culture d'une production. */
export async function putProductionCertification(db: Database, farmId: string, productionId: string, w: ProductionCertificationWrite) {
  return withFarm(db, farmId, async (tx) => {
    const [p] = await rows<{ id: string; cycle: string | null; planted_on: string | null; cultivation_mode: string; drought_tolerant: boolean | null; water_saving: string | null }>(
      tx,
      sql`UPDATE productions SET
            cycle = ${w.cycle === undefined ? sql`cycle` : w.cycle},
            planted_on = ${w.plantedOn === undefined ? sql`planted_on` : sql`${w.plantedOn}::date`},
            cultivation_mode = ${w.cultivationMode === undefined ? sql`cultivation_mode` : w.cultivationMode},
            drought_tolerant = ${w.droughtTolerant === undefined ? sql`drought_tolerant` : w.droughtTolerant},
            water_saving = ${w.waterSaving === undefined ? sql`water_saving` : w.waterSaving || null},
            updated_at = now()
          WHERE id = ${productionId} RETURNING id, cycle, planted_on::text, cultivation_mode, drought_tolerant, water_saving`,
    );
    if (!p) throw new NotFound("Production introuvable.");
    return { id: p.id, cycle: p.cycle, plantedOn: p.planted_on, cultivationMode: p.cultivation_mode, droughtTolerant: p.drought_tolerant, waterSaving: p.water_saving };
  });
}
