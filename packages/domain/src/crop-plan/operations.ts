import type { CropPlanBlocker, CropPlanContext, CropPlanDraft } from "@fourmy/contracts";
import type { ResolvedPlan } from "./resolve.js";

/**
 * Découpes et fusions de l'assolement (lot AS3, conception §3.4) : date
 * d'effet proposée et vérifications qui ne demandent pas la base.
 * Règle retenue le 20/11/2026 : le lendemain de la dernière fin de
 * production de la parcelle d'origine, sinon le 1er janvier de la campagne ;
 * modifiable.
 */

const nextDay = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Date d'effet proposée pour une découpe ou une fusion des parcelles de départ `parcelIds`. */
export function defaultEffectiveOn(context: Pick<CropPlanContext, "year" | "parcels">, parcelIds: string[]): string {
  const ends = context.parcels.filter((p) => parcelIds.includes(p.id) && p.lastStoppedOn).map((p) => p.lastStoppedOn!);
  const last = ends.sort().at(-1);
  const floor = `${context.year - 1}-01-01`;
  if (last && last >= floor) return nextDay(last);
  return `${context.year}-01-01`;
}

/** Bloquants des découpes et fusions vérifiables sans la base (date d'effet, cultures des morceaux). */
export function operationBlockers(draft: CropPlanDraft, resolved: ResolvedPlan, context: Pick<CropPlanContext, "year" | "parcels">): CropPlanBlocker[] {
  const out: CropPlanBlocker[] = [];
  const base = new Map(context.parcels.map((p) => [`p:${p.id}`, p]));
  const from = `${draft.year - 1}-01-01`;
  const to = `${draft.year}-12-31`;
  for (const op of draft.operations) {
    const sources = op.kind === "split" ? [op.source] : op.sources;
    const pieces = op.kind === "split" ? op.pieces : [op.result];
    const names = pieces.map((p) => p.name).join(", ");
    if (op.effectiveOn < from || op.effectiveOn > to) {
      out.push({ code: "effective-date", message: `${names} : date d'effet hors de la campagne (du ${from} au ${to}).`, keys: pieces.map((p) => p.key) });
    }
    for (const key of sources) {
      const p = base.get(key);
      if (!p) continue; // morceau d'une découpe précédente du brouillon
      if (p.lastStoppedOn && op.effectiveOn <= p.lastStoppedOn) {
        out.push({ code: "effective-date", message: `${p.name} : une culture y est en place jusqu'au ${p.lastStoppedOn} ; la date d'effet doit suivre.`, keys: [key] });
      }
      if (op.effectiveOn <= p.validFrom.slice(0, 10)) {
        out.push({ code: "effective-date", message: `${p.name} : la date d'effet doit suivre le début de la version actuelle de la parcelle (${p.validFrom.slice(0, 10)}).`, keys: [key] });
      }
    }
    // Une culture prévue sur un morceau ne peut commencer avant que le morceau existe.
    for (const piece of pieces) {
      if (!resolved.byKey.has(piece.key)) continue;
      const early = draft.assignments.find((a) => a.key === piece.key && a.startedOn && a.startedOn < op.effectiveOn);
      if (early) {
        out.push({ code: "effective-date", message: `${piece.name} : culture prévue à partir du ${early.startedOn}, avant la date d'effet (${op.effectiveOn}).`, keys: [piece.key] });
      }
    }
  }
  return out;
}
