import type { CropPlanBlocker, CropPlanChange, CropPlanDraft, CropPlanParcelKey, CropPlanProductionFields } from "@fourmy/contracts";
import { parcelKeyOf } from "./model.js";
import type { ResolvedPlan } from "./resolve.js";

/**
 * Changements qu'appliquerait la validation (conception §5.2, §6) :
 * comparaison du brouillon avec les productions de la campagne en base.
 * Pur et testable sans base ; le dépôt applique la liste telle quelle.
 */

/** Production de la campagne en base. */
export interface ExistingProduction extends CropPlanProductionFields {
  id: string;
  landParcelId: string;
  /** Des interventions réalisées portent sur cette production. */
  hasDoneInterventions: boolean;
}

export interface CropPlanDiff {
  changes: CropPlanChange[];
  blockers: CropPlanBlocker[];
}

const fields = (a: CropPlanProductionFields): CropPlanProductionFields => ({
  activityId: a.activityId,
  role: a.role,
  startedOn: a.startedOn,
  stoppedOn: a.stoppedOn,
});
const same = (a: CropPlanProductionFields, b: CropPlanProductionFields) =>
  a.activityId === b.activityId && a.role === b.role && a.startedOn === b.startedOn && a.stoppedOn === b.stoppedOn;

export function diffCropPlan(
  draft: CropPlanDraft,
  resolved: ResolvedPlan,
  existing: ExistingProduction[],
  opts: { campaignExists: boolean },
): CropPlanDiff {
  const changes: CropPlanChange[] = [];
  const blockers: CropPlanBlocker[] = [];

  if (!opts.campaignExists) changes.push({ kind: "campaign.create", year: draft.year });

  for (const issue of resolved.issues) {
    blockers.push({ code: "operation", message: `Découpe ou fusion n° ${issue.operation + 1} : ${issue.message}`, keys: [] });
  }
  for (const op of draft.operations) {
    if (op.kind === "split") {
      changes.push({ kind: "parcel.split", source: op.source, pieces: op.pieces.map(({ key, name, areaM2 }) => ({ key, name, areaM2 })), effectiveOn: op.effectiveOn });
    } else {
      const { key, name, areaM2 } = op.result;
      changes.push({ kind: "parcel.merge", sources: op.sources, result: { key, name, areaM2 }, effectiveOn: op.effectiveOn });
    }
  }

  // Cultures prévues sur une parcelle qui n'existe plus (découpée, fusionnée) ou inconnue.
  const unknown = draft.assignments.filter((a) => !resolved.byKey.has(a.key));
  if (unknown.length) {
    blockers.push({
      code: "unknown-parcel",
      message: `${unknown.length} culture(s) prévue(s) sur une parcelle découpée, fusionnée ou inconnue.`,
      keys: [...new Set(unknown.map((a) => a.key))],
    });
  }

  // Parcelles sans culture principale ni « sans culture ».
  const mainKeys = new Set(draft.assignments.filter((a) => a.role === "main").map((a) => a.key));
  const fallowKeys = new Set(draft.fallow.map((f) => f.key));
  const unassigned = resolved.parcels.filter((p) => !mainKeys.has(p.key) && !fallowKeys.has(p.key));
  if (unassigned.length) {
    blockers.push({
      code: "unassigned",
      message: `${unassigned.length} parcelle(s) sans culture prévue : ${unassigned.map((p) => p.name).join(", ")}.`,
      keys: unassigned.map((p) => p.key),
    });
  }

  const byId = new Map(existing.map((p) => [p.id, p]));
  const kept = new Set<string>();
  const dupes = new Set<string>();
  for (const a of draft.assignments) {
    if (!resolved.byKey.has(a.key)) continue;
    const after = fields(a);
    const prod = a.productionId ? byId.get(a.productionId) : undefined;
    if (a.productionId && kept.has(a.productionId)) {
      dupes.add(a.key);
      continue;
    }
    if (prod && parcelKeyOf(prod.landParcelId) === a.key) {
      kept.add(prod.id);
      if (!same(prod, after)) changes.push({ kind: "production.update", productionId: prod.id, key: a.key, before: fields(prod), after });
    } else {
      // Production d'une autre parcelle (morceau d'une découpe) ou disparue : nouvelle production.
      changes.push({ kind: "production.create", assignmentId: a.id, key: a.key, after });
    }
  }
  if (dupes.size) {
    blockers.push({ code: "duplicate-production", message: "Une même production est reprise deux fois.", keys: [...dupes] });
  }

  const blocked: CropPlanParcelKey[] = [];
  for (const prod of existing) {
    if (kept.has(prod.id)) continue;
    const key = parcelKeyOf(prod.landParcelId);
    if (prod.hasDoneInterventions) blocked.push(key);
    else changes.push({ kind: "production.delete", productionId: prod.id, key, before: fields(prod) });
  }
  if (blocked.length) {
    blockers.push({
      code: "done-interventions",
      message: `${blocked.length} production(s) retirée(s) de l'assolement portent des interventions réalisées : gardez-les, ou avancez leur date de fin.`,
      keys: [...new Set(blocked)],
    });
  }

  return { changes, blockers };
}
