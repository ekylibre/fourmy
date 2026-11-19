import { sql } from "drizzle-orm";
import type { Tx } from "@fourmy/db";
import { interventionCompleteWrite } from "@fourmy/contracts";
import type { DomainCtx } from "@fourmy/domain";
import type { BundleParcel, ImportBundle } from "@fourmy/importers";
import { completeInTx, planInTx } from "./interventions.js";
import type { ReconcilePlan } from "./import-reconcile.js";

/**
 * Écriture d'un import (lot IM2, claudedocs/conception_import_onboarding.md
 * §8), dans la transaction de l'appelant (tout ou rien par fichier). Chaque
 * entité créée ou reliée laisse un lien de provenance (`import_links`).
 * Une intervention refusée au dernier moment (règle métier) est laissée de
 * côté et rapportée, sans annuler l'import.
 */

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

export interface ImportReport {
  format: string;
  counts: Record<"parcels" | "productions" | "covers" | "activities" | "articles" | "people", { created: number; linked: number; skipped: number }> & {
    campaigns: { created: number };
    interventions: { created: number; failed: number; skipped: number; alreadyImported: number };
  };
  failures: { label: string; on: string; reason: string }[];
  skipped: { label: string; on: string; reason: string }[];
  /** Interventions créées en feu rouge (contrôle phyto ou nitrates) : à revoir. */
  compliance: { phytoDanger: number; nitrateDanger: number };
  warnings: { level: string; message: string }[];
}

async function link(tx: Tx, farmId: string, runId: string, namespace: string, key: string, entity: string, entityId: string, created: boolean) {
  await tx.execute(sql`
    INSERT INTO import_links (farm_id, namespace, key, entity, entity_id, run_id, created)
    VALUES (${farmId}, ${namespace}, ${key.slice(0, 255)}, ${entity}, ${entityId}, ${runId}, ${created})
    ON CONFLICT (farm_id, namespace, key, entity) DO NOTHING`);
}

/** Attributs de la culture venus de la source (productions.attrs). */
function productionAttrs(format: string, p: BundleParcel): Record<string, unknown> {
  const out: Record<string, unknown> = {
    source: format,
    label: p.crop.label,
    secondary: p.secondary,
    aee: { species: p.crop.aeeCode, complement: p.crop.aeeComplement, sowingPeriod: p.crop.aeeSowingPeriod, usage: p.crop.aeeUsage },
  };
  if (p.areaM2) out.areaM2 = p.areaM2;
  if (p.crop.capCode) out.capCode = p.crop.capCode;
  if (p.crop.variety) out.variety = p.crop.variety;
  if (p.crop.sownOn) out.sownOn = p.crop.sownOn;
  if (p.crop.harvestedOn) out.harvestedOn = p.crop.harvestedOn;
  if (p.crop.destination) out.destination = p.crop.destination;
  if (p.yield) out.yield = p.yield;
  if (p.soil) out.soil = p.soil;
  if (p.advice) out.advice = p.advice;
  if (p.spreadable) out.spreadable = p.spreadable;
  return out;
}

export async function applyPlan(tx: Tx, farmId: string, ctx: DomainCtx, runId: string, bundle: ImportBundle, plan: ReconcilePlan): Promise<ImportReport> {
  const zero = () => ({ created: 0, linked: 0, skipped: 0 });
  const report: ImportReport = {
    format: bundle.format,
    counts: {
      parcels: zero(),
      productions: zero(),
      covers: zero(),
      activities: zero(),
      articles: zero(),
      people: zero(),
      campaigns: { created: 0 },
      interventions: { created: 0, failed: 0, skipped: 0, alreadyImported: plan.alreadyImported },
    },
    failures: [],
    skipped: [],
    compliance: { phytoDanger: 0, nitrateDanger: 0 },
    warnings: bundle.warnings.filter((w) => w.level !== "info").map(({ level, message }) => ({ level, message })),
  };
  const tally = (key: keyof Omit<ImportReport["counts"], "campaigns" | "interventions">, action: string) =>
    report.counts[key][action === "create" ? "created" : action === "link" ? "linked" : "skipped"]++;

  // Identité : seulement les champs vides (la valeur de Fourmy est gardée).
  if (bundle.farm.siret) await tx.execute(sql`UPDATE farms SET siret = ${bundle.farm.siret} WHERE id = ${farmId} AND siret IS NULL`);
  if (bundle.farm.pacage) await tx.execute(sql`UPDATE farms SET pacage = ${bundle.farm.pacage} WHERE id = ${farmId} AND pacage IS NULL`);

  for (const c of plan.campaigns.filter((x) => x.create)) {
    await tx.execute(sql`
      INSERT INTO campaigns (id, farm_id, year, starts_on, stops_on)
      VALUES (${c.id}, ${farmId}, ${c.year}, make_date(${c.year}, 1, 1), make_date(${c.year}, 12, 31))`);
    report.counts.campaigns.created++;
  }

  // Parcelles : une version ouverte au premier jour du fichier.
  for (const l of plan.lands) {
    tally("parcels", l.action);
    if (!l.landParcelId) continue;
    if (l.action === "create" && l.shape) {
      const geo = JSON.stringify(l.shape);
      await tx.execute(sql`INSERT INTO land_parcels (id, farm_id, name) VALUES (${l.landParcelId}, ${farmId}, ${l.name})`);
      await tx.execute(sql`
        INSERT INTO land_parcel_versions (id, land_parcel_id, shape, area_m2, pac_islet, valid)
        VALUES (${ctx.newId()}, ${l.landParcelId}, ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326))),
                ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326)::geography), ${l.islet}, tstzrange(${plan.validFrom}::timestamptz, NULL))`);
    }
    await link(tx, farmId, runId, "plot.work_number", l.landKey, "land_parcel", l.landParcelId, l.action === "create");
  }

  for (const a of plan.activities) {
    tally("activities", a.action);
    if (a.action === "create") {
      await tx.execute(sql`
        INSERT INTO activities (id, farm_id, name, family, reference, cultivation)
        VALUES (${a.activityId}, ${farmId}, ${a.name}, ${a.family}, ${a.reference}, ${a.cultivation})`);
    }
    await link(tx, farmId, runId, "crop.label", a.key, "activity", a.activityId, a.action === "create");
  }
  const activityOf = new Map(plan.activities.map((a) => [a.key, a]));

  for (const p of plan.productions) {
    tally("productions", p.action);
    if (p.action === "create") {
      const a = activityOf.get(p.activityKey)!;
      await tx.execute(sql`
        INSERT INTO productions (id, farm_id, campaign_id, land_parcel_id, nature, cultivation, activity_id, declared, attrs, started_on, stopped_on)
        VALUES (${p.productionId}, ${farmId}, ${p.campaignId}, ${p.landParcelId}, ${a.nature}, ${a.cultivation}, ${a.activityId}, false,
                ${JSON.stringify(productionAttrs(bundle.format, p.parcel))}::jsonb, ${p.startedOn}::date, ${p.stoppedOn}::date)`);
    }
    await link(tx, farmId, runId, "crop.parcel", `${p.parcel.campaign}:${p.parcel.key}`, "production", p.productionId, p.action === "create");
  }

  // Couverts d'interculture : couverts de la parcelle (contrôles nitrates), campagne de la culture qui suit.
  for (const c of plan.covers) {
    tally("covers", c.action);
    if (c.action === "skip") {
      report.skipped.push({ label: `Couvert ${c.parcel.crop.label}`, on: c.cover.sownOn, reason: c.reason ?? "" });
      continue;
    }
    if (c.action === "create") {
      await tx.execute(sql`
        INSERT INTO cover_crops (id, farm_id, land_parcel_id, campaign, kind, family, species, sown_on, destroyed_on, exported, notes)
        VALUES (${c.coverId}, ${farmId}, ${c.landParcelId}, ${c.campaign}, 'sown', ${c.cover.family}, ${c.cover.species},
                ${c.cover.sownOn}::date, ${c.cover.destroyedOn}::date, ${c.cover.exported}, ${`Importé (${bundle.format}) : ${c.parcel.name}`})`);
    }
    await link(tx, farmId, runId, "crop.parcel", `${c.parcel.campaign}:${c.parcel.key}`, "cover_crop", c.coverId, c.action === "create");
  }

  for (const a of plan.articles) {
    tally("articles", a.action);
    const src = a.article;
    if (a.action === "create") {
      const custom = { source: `import:${bundle.format}`, ...(src.gnis ? { gnis: src.gnis } : {}), ...(src.species ? { species: src.species } : {}) };
      await tx.execute(sql`
        INSERT INTO articles (id, farm_id, lexicon_ref, name, kind, unit, amm, custom)
        VALUES (${a.articleId}, ${farmId}, ${a.lexiconRef}, ${src.name}, ${a.kind}, ${a.unit}, ${src.amm}, ${JSON.stringify(custom)}::jsonb)`);
      const c = src.composition;
      if (a.kind === "fertilizer" && c && (c.n !== undefined || c.p2o5 !== undefined || c.k2o !== undefined)) {
        // Organiques : kg par t ou par m³ de produit brut ; minéraux : % de la masse.
        const basis = src.organic ? (["cubic_meter", "liter"].includes(a.unit) ? "kg_per_m3" : "kg_per_t") : "mass_percent";
        await tx.execute(sql`
          INSERT INTO article_fertilizers (article_id, farm_id, basis, n_total, p2o5, k2o, so3, origin, source)
          VALUES (${a.articleId}, ${farmId}, ${basis}, ${c.n ?? 0}, ${c.p2o5 ?? null}, ${c.k2o ?? null}, ${c.so3 ?? null},
                  'imported', ${`import:${bundle.format}`})
          ON CONFLICT (article_id) DO NOTHING`);
      }
    }
    const [ns, key] = Object.entries(src.sourceIds)[0] ?? ["article.name", src.name.toLowerCase()];
    await link(tx, farmId, runId, ns, key, "article", a.articleId, a.action === "create");
  }

  for (const p of plan.people) {
    tally("people", p.action);
    const [ns, key] = Object.entries(p.person.sourceIds)[0] ?? ["person.name", p.name.toLowerCase()];
    if (p.action === "create") {
      await tx.execute(sql`
        INSERT INTO people (id, farm_id, name, first_name, last_name, active, external_ids)
        VALUES (${p.personId}, ${farmId}, ${p.name}, ${p.person.firstName}, ${p.person.lastName}, true,
                ${JSON.stringify({ [ns]: key })}::jsonb)`);
    }
    await link(tx, farmId, runId, ns, key, "person", p.personId, p.action === "create");
  }

  // Interventions : mêmes fonctions que la saisie (contrôles phyto et nitrates compris).
  let n = 0;
  for (const i of plan.interventions) {
    if (i.action === "skip" || !i.body) {
      report.counts.interventions.skipped++;
      report.skipped.push({ label: i.draft.source.label, on: i.draft.on, reason: i.reason ?? "" });
      continue;
    }
    const savepoint = sql.raw(`import_intervention_${++n}`);
    await tx.execute(sql`SAVEPOINT ${savepoint}`);
    try {
      const { created } = await planInTx(tx, farmId, ctx, i.body, null, { periodPrecision: "day" });
      if (created && i.draft.status === "done") {
        const { procedure: _procedure, id: _id, plannedAt: _plannedAt, ...rest } = i.body;
        await completeInTx(tx, farmId, ctx, i.id, interventionCompleteWrite.parse(rest));
      }
      for (const guid of i.draft.guids) await link(tx, farmId, runId, "agri.crop_zone", guid, "intervention", i.id, created);
      await tx.execute(sql`RELEASE SAVEPOINT ${savepoint}`);
      report.counts.interventions.created += created ? 1 : 0;
    } catch (e) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT ${savepoint}`);
      report.counts.interventions.failed++;
      report.failures.push({ label: i.draft.source.label, on: i.draft.on, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  const [checks] = await rows<{ phyto: number; nitrate: number }>(
    tx,
    sql`SELECT count(*) FILTER (WHERE i.compliance->>'level' = 'danger')::int AS phyto,
               count(*) FILTER (WHERE i.nitrate_check->>'level' = 'danger')::int AS nitrate
        FROM interventions i
        WHERE i.id IN (SELECT entity_id FROM import_links WHERE run_id = ${runId} AND entity = 'intervention' AND created)`,
  );
  report.compliance = { phytoDanger: checks?.phyto ?? 0, nitrateDanger: checks?.nitrate ?? 0 };
  return report;
}
