import { sql } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { Conflict, NotFound } from "../routes/helpers.js";

/**
 * Annulation d'un import de fichier (claudedocs/conception_import_onboarding.md
 * §7.1, lot IM5) : ce que l'import a créé (liens `import_links` marqués
 * `created`) est supprimé, dans l'ordre inverse des dépendances, sauf ce qui a
 * été modifié depuis dans Fourmy (journal d'audit) ou que des données saisies
 * depuis utilisent : c'est gardé et signalé au rapport. Ce que l'import a
 * seulement relié n'est jamais touché, pas plus que l'identité de la ferme
 * (SIRET, PACAGE, raison sociale, adresse du siège : champs remplis seulement
 * s'ils étaient vides).
 */

export interface RevertReport {
  deleted: Record<string, number>;
  kept: { entity: string; count: number; reason: string }[];
}

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

/** Modifiée dans Fourmy après l'import : une ligne du journal d'audit qui ne vient pas d'un import. */
const touched = (id: ReturnType<typeof sql>) => sql`EXISTS (SELECT 1 FROM audit_log al WHERE al.entity_id = ${id} AND al.origin <> 'import')`;

interface Step {
  entity: string;
  table: string;
  /** Raisons de garder une ligne (alias `x`), en plus d'une modification depuis l'import. */
  keepIf: ReturnType<typeof sql>[];
  reason: string;
}

const STEPS: Step[] = [
  {
    entity: "intervention",
    table: "interventions",
    keepIf: [sql`EXISTS (SELECT 1 FROM stock_movements m WHERE m.intervention_id = x.id)`],
    reason: "intervention modifiée ou réalisée depuis l'import",
  },
  { entity: "landscape_feature", table: "farm_landscape_features", keepIf: [], reason: "élément modifié depuis l'import" },
  { entity: "cover_crop", table: "cover_crops", keepIf: [], reason: "couvert modifié depuis l'import" },
  {
    entity: "production",
    table: "productions",
    keepIf: [sql`EXISTS (SELECT 1 FROM fertilization_plans f WHERE f.production_id = x.id)`],
    reason: "culture modifiée ou portant un plan de fumure",
  },
  {
    entity: "land_parcel",
    table: "land_parcels",
    keepIf: [
      sql`EXISTS (SELECT 1 FROM productions p WHERE p.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM intervention_parameters t WHERE t.ref_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM cover_crops c WHERE c.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM fertilization_plans f WHERE f.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM parcel_soils s WHERE s.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM soil_analyses s WHERE s.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM prescriptions s WHERE s.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM parcel_certifications s WHERE s.land_parcel_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM parcel_rows s WHERE s.land_parcel_id = x.id)`,
      sql`(SELECT count(*) FROM land_parcel_versions v WHERE v.land_parcel_id = x.id) > 1`,
    ],
    reason: "parcelle modifiée ou utilisée depuis l'import (culture, intervention, sol, plan…)",
  },
  {
    entity: "activity",
    table: "activities",
    keepIf: [sql`EXISTS (SELECT 1 FROM productions p WHERE p.activity_id = x.id)`],
    reason: "activité modifiée ou portant d'autres cultures",
  },
  {
    entity: "article",
    table: "articles",
    keepIf: [
      sql`EXISTS (SELECT 1 FROM intervention_parameters t WHERE t.ref_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM lots l WHERE l.article_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM fertilization_plan_applications a WHERE a.article_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM product_analyses a WHERE a.article_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM equipment_parts a WHERE a.article_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM equipment_fluids a WHERE a.article_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM equipment_operation_parts a WHERE a.article_id = x.id)`,
    ],
    reason: "article modifié ou utilisé depuis l'import (intervention, stock, plan…)",
  },
  {
    entity: "person",
    table: "people",
    keepIf: [
      sql`x.user_id IS NOT NULL`,
      sql`EXISTS (SELECT 1 FROM intervention_parameters t WHERE t.ref_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM crew_template_members m WHERE m.person_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM person_invitations i WHERE i.person_id = x.id)`,
      sql`EXISTS (SELECT 1 FROM farms f WHERE f.legal_rep_person_id = x.id)`,
    ],
    reason: "personne modifiée ou utilisée depuis l'import",
  },
  {
    entity: "campaign",
    table: "campaigns",
    keepIf: [sql`EXISTS (SELECT 1 FROM productions p WHERE p.campaign_id = x.id)`],
    reason: "campagne portant d'autres cultures",
  },
];

export async function revertRun(db: Database, farmId: string, runId: string): Promise<RevertReport> {
  return withFarm(db, farmId, async (tx) => {
    const [run] = await rows<{ status: string; format: string | null }>(tx, sql`SELECT status, format FROM import_runs WHERE id = ${runId} FOR UPDATE`);
    if (!run) throw new NotFound("Import introuvable");
    if (run.status !== "completed" || !run.format) throw new Conflict("Seul un import de fichier terminé peut être annulé.");

    const report: RevertReport = { deleted: {}, kept: [] };
    const kept = new Set<string>();
    for (const step of STEPS) {
      const ids = (await rows<{ id: string }>(tx, sql`SELECT DISTINCT entity_id AS id FROM import_links WHERE run_id = ${runId} AND entity = ${step.entity} AND created`)).map((r) => r.id);
      if (!ids.length) continue;
      const list = sql`(SELECT unnest(${`{${ids.join(",")}}`}::uuid[]))`;
      const keep = [touched(sql`x.id`), ...step.keepIf];
      const deleted = await rows<{ id: string }>(
        tx,
        sql`DELETE FROM ${sql.raw(step.table)} x WHERE x.id IN ${list} AND NOT (${sql.join(keep, sql` OR `)}) RETURNING x.id`,
      );
      const gone = new Set(deleted.map((d) => d.id));
      const left = ids.filter((id) => !gone.has(id));
      report.deleted[step.entity] = gone.size;
      if (left.length) report.kept.push({ entity: step.entity, count: left.length, reason: step.reason });
      for (const id of left) kept.add(id);
    }
    // Références PAC posées par l'import (dossier TelePAC).
    const refs = await rows<{ id: string }>(tx, sql`DELETE FROM parcel_references WHERE attrs->>'runId' = ${runId} RETURNING id`);
    report.deleted.parcel_reference = refs.length;

    // Liens : seuls restent ceux des entités gardées (un réimport les retrouve).
    await tx.execute(sql`
      DELETE FROM import_links WHERE run_id = ${runId}
        AND NOT (created AND entity_id = ANY(${`{${[...kept].join(",")}}`}::uuid[]))`);
    await tx.execute(sql`
      UPDATE import_runs SET status = 'reverted', finished_at = now(),
        report = coalesce(report, '{}'::jsonb) || jsonb_build_object('revert', ${JSON.stringify(report)}::jsonb)
      WHERE id = ${runId}`);
    return report;
  });
}
