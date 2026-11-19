import { IMPORT_FORMAT_LABELS, type ImportDecisions, type ImportPreview, type ImportWarning } from "@fourmy/contracts";
import { harvestProcedure, operationTarget } from "./aee.js";
import type { FileAnalysis } from "./readers.js";
import type { ImportBundle } from "./model.js";

export interface PreviewContext {
  fileName: string;
  /** SIRET de la ferme dans Fourmy (null s'il n'est pas renseigné). */
  farmSiret: string | null;
  decisions: ImportDecisions;
}

/** Procédure proposée pour une unité de travail (récolte de grains d'après l'usage de la culture). */
function procedureOf(bundle: ImportBundle, code: string | null, category: string | null, parcelKey: string): string {
  const target = operationTarget(code, category);
  if (target.procedure !== "harvesting") return target.procedure;
  const parcel = bundle.parcels.find((p) => p.key === parcelKey);
  return harvestProcedure(parcel?.crop.aeeUsage);
}

/**
 * Aperçu d'un fichier analysé (avant tout rapprochement avec la ferme) :
 * contenu, opérations et procédures proposées, avertissements. Un
 * avertissement bloquant interdit l'écriture.
 */
export function buildPreview(analysis: FileAnalysis, ctx: PreviewContext): ImportPreview {
  const { format, bundle } = analysis;
  const warnings: ImportWarning[] = [];

  if (!bundle) {
    warnings.push({
      level: "blocking",
      message: `Fichier reconnu (${IMPORT_FORMAT_LABELS[format]}), mais sa lecture n'est pas encore disponible dans Fourmy.`,
    });
    return {
      format,
      fileName: ctx.fileName,
      readable: false,
      producedBy: null,
      exportedAt: null,
      campaigns: [],
      farm: { identity: { siret: null, pacage: null, name: null, email: null, address: null }, siretMatches: null },
      counts: { parcels: 0, areaHa: 0, history: 0, articles: 0, people: 0, workUnits: 0, capIslets: 0, capParcels: 0, landscape: 0 },
      operations: [],
      notImported: [],
      warnings,
      reconciliation: null,
    };
  }

  warnings.push(...bundle.warnings);

  const fileSiret = bundle.farm.siret;
  const siretMatches = fileSiret && ctx.farmSiret ? fileSiret === ctx.farmSiret : null;
  if (siretMatches === false) {
    warnings.push(
      ctx.decisions.confirmSiret
        ? { level: "info", message: `SIRET du fichier (${fileSiret}) différent de celui de la ferme : import confirmé.` }
        : {
            level: "blocking",
            message: `Ce fichier concerne le SIRET ${fileSiret}, la ferme a le SIRET ${ctx.farmSiret} : confirmez qu'il s'agit bien de votre ferme.`,
            ref: "siret",
          },
    );
  }

  const operations = new Map<string, { code: string | null; label: string; procedure: string; done: number; planned: number }>();
  for (const w of bundle.workUnits) {
    const procedure = procedureOf(bundle, w.operation.aeeCode, w.operation.category, w.parcelKey);
    const key = `${w.operation.aeeCode ?? ""}|${procedure}|${w.operation.label}`;
    const row = operations.get(key) ?? { code: w.operation.aeeCode, label: w.operation.label, procedure, done: 0, planned: 0 };
    row[w.status === "planned" ? "planned" : "done"]++;
    operations.set(key, row);
  }

  const areaM2 = bundle.parcels.reduce((sum, p) => sum + (p.areaM2 ?? 0), 0);
  return {
    format,
    fileName: ctx.fileName,
    readable: true,
    producedBy: bundle.producedBy,
    exportedAt: bundle.exportedAt,
    campaigns: [...bundle.campaigns].sort((a, b) => a - b),
    farm: { identity: bundle.farm, siretMatches },
    counts: {
      parcels: bundle.parcels.length,
      areaHa: Math.round(areaM2 / 100) / 100,
      history: bundle.history.length,
      articles: bundle.articles.length,
      people: bundle.people.length,
      workUnits: bundle.workUnits.length,
      capIslets: bundle.capRefs.filter((r) => r.kind === "islet").length,
      capParcels: bundle.capRefs.filter((r) => r.kind === "parcel").length,
      landscape: bundle.landscape.length,
    },
    operations: [...operations.values()].sort((a, b) => b.done + b.planned - (a.done + a.planned)),
    notImported: bundle.notImported,
    warnings,
    reconciliation: null,
  };
}

/** Un avertissement bloquant empêche l'écriture. */
export const isBlocked = (preview: ImportPreview): boolean => preview.warnings.some((w) => w.level === "blocking");

