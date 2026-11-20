import type { CropPlanDraft, CropPlanParcelKey } from "@fourmy/contracts";
import { parcelKeyOf, type CropPlanBaseParcel, type CropPlanOrigin, type ResolvedParcel } from "./model.js";

/**
 * Parcellaire du brouillon (conception §3.3) : les découpes et fusions sont
 * rejouées dans l'ordre sur le parcellaire de départ. Chaque parcelle
 * garde ses origines (parcelles de départ et parts de surface), pour
 * l'historique des contrôles (§4.6).
 */

export interface ResolveIssue {
  /** Rang de l'opération en cause. */
  operation: number;
  message: string;
}

export interface ResolvedPlan {
  parcels: ResolvedParcel[];
  byKey: Map<CropPlanParcelKey, ResolvedParcel>;
  issues: ResolveIssue[];
}

/** Écart toléré entre la somme des morceaux et la surface d'origine (arrondis du dessin). */
const AREA_TOLERANCE = 0.01;

function combine(origins: CropPlanOrigin[]): CropPlanOrigin[] {
  const by = new Map<string, number>();
  for (const o of origins) by.set(o.parcelId, (by.get(o.parcelId) ?? 0) + o.share);
  return [...by].map(([parcelId, share]) => ({ parcelId, share }));
}

export function resolveParcels(base: CropPlanBaseParcel[], draft: CropPlanDraft): ResolvedPlan {
  const current = new Map<CropPlanParcelKey, ResolvedParcel>();
  for (const p of base) {
    const key = parcelKeyOf(p.id);
    current.set(key, { key, name: p.name, areaM2: p.areaM2, existing: true, origins: [{ parcelId: p.id, share: 1 }] });
  }
  const issues: ResolveIssue[] = [];
  const seen = new Set<string>(current.keys());

  draft.operations.forEach((op, i) => {
    const sources = op.kind === "split" ? [op.source] : op.sources;
    const pieces = op.kind === "split" ? op.pieces : [op.result];
    const missingSources = sources.filter((k) => !current.has(k));
    if (missingSources.length) {
      issues.push({ operation: i, message: `Parcelle inconnue ou déjà transformée : ${missingSources.join(", ")}.` });
      return;
    }
    if (new Set(sources).size !== sources.length) {
      issues.push({ operation: i, message: "Une parcelle est fusionnée avec elle-même." });
      return;
    }
    const dup = pieces.find((p) => seen.has(p.key));
    if (dup) {
      issues.push({ operation: i, message: `Clé de parcelle déjà employée : ${dup.key}.` });
      return;
    }
    const src = sources.map((k) => current.get(k)!);
    const srcArea = src.reduce((s, p) => s + p.areaM2, 0);
    const piecesArea = pieces.reduce((s, p) => s + p.areaM2, 0);
    if (srcArea > 0 && Math.abs(piecesArea - srcArea) / srcArea > AREA_TOLERANCE) {
      issues.push({
        operation: i,
        message: `Surface des nouvelles parcelles (${Math.round(piecesArea)} m²) différente de celle d'origine (${Math.round(srcArea)} m²).`,
      });
    }
    for (const k of sources) current.delete(k);
    for (const piece of pieces) {
      // Découpe : chaque morceau hérite des origines de la source, au prorata de sa surface ;
      // fusion : le résultat hérite des origines de chaque source, au prorata de leur surface.
      const origins =
        op.kind === "split"
          ? src[0]!.origins
          : combine(src.flatMap((s) => s.origins.map((o) => ({ parcelId: o.parcelId, share: srcArea > 0 ? (o.share * s.areaM2) / srcArea : 0 }))));
      current.set(piece.key, { key: piece.key, name: piece.name, areaM2: piece.areaM2, existing: false, origins, effectiveOn: op.effectiveOn });
      seen.add(piece.key);
    }
  });

  const parcels = [...current.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { parcels, byKey: current, issues };
}
