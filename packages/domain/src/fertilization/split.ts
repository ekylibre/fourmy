import type { PlannedApplication } from "@fourmy/contracts";
import type { CropGroup } from "@fourmy/fertilization-refs";
import { isMaizeOrSorghum, isStrawCereal } from "./crops.js";

/**
 * Apports proposés pour une dose (lot AG, FR-FERT-13), selon le PAR 7
 * Nouvelle-Aquitaine (guide, tableaux 6 à 8) : premier apport plafonné à
 * 50 kg sur céréales d'hiver et maïs semé avant le 1er mai ; céréales en 2
 * apports de 110 à 160 kg, 3 au-delà ; maïs en 2 apports au moins au-delà
 * de 120 kg. Une proposition, que l'exploitant modifie.
 */
export function splitDose(dose: number, crop: CropGroup, opts: { nBefore4Leaves?: number; steeringReserve?: number } = {}): PlannedApplication[] {
  const app = (stage: string, n: number, reserved = false): PlannedApplication => ({ stage, plannedOn: null, articleId: null, nKgHa: Math.max(0, Math.round(n)), reservedForSteering: reserved });
  if (!(dose > 0)) return [];
  const reserve = opts.steeringReserve ?? 0;
  if (isMaizeOrSorghum(crop)) {
    const n4 = Math.min(opts.nBefore4Leaves ?? 0, dose);
    const rest = dose - n4;
    const out: PlannedApplication[] = [];
    if (n4 > 0) out.push(app("Avant 4 feuilles (semis)", n4));
    if (rest <= 0) return out;
    if (n4 === 0 && dose > 120) {
      const first = Math.min(50, Math.round(dose / 2));
      out.push(app("Avant 4 feuilles", first));
      const left = dose - first;
      if (reserve > 0 && left > reserve) out.push(app("4 à 8 feuilles", left - reserve), app("Pilotage, avant floraison", reserve, true));
      else out.push(app("4 à 8 feuilles", left));
      return out;
    }
    if (reserve > 0 && rest > reserve) out.push(app("4 à 8 feuilles", rest - reserve), app("Pilotage, avant floraison", reserve, true));
    else out.push(app("4 à 8 feuilles", rest));
    return out;
  }
  if (isStrawCereal(crop)) {
    const first = Math.min(50, dose);
    const left = dose - first;
    if (left <= 0) return [app("Tallage", first)];
    if (dose <= 160) {
      if (reserve > 0 && left > reserve) return [app("Tallage", first), app("Épi 1 cm", left - reserve), app("Dernière feuille (pilotage)", reserve, true)];
      return [app("Tallage", first), app("Épi 1 cm", left)];
    }
    const last = Math.max(reserve, 40);
    return [app("Tallage", first), app("Épi 1 cm", left - last), app("Dernière feuille", last, reserve > 0)];
  }
  return [app("Apport", dose)];
}

/**
 * Pilotage (lot AJ, FR-FERT-17) : la dernière mesure fixe l'apport de
 * pilotage. La dose permise devient la dose du plan, moins l'apport réservé
 * au pilotage, plus la dose conseillée ; sans mesure, c'est la dose du plan.
 */
export function steeringAllowance(planDose: number, reservedKgNHa: number, measurements: { measuredOn: string; advisedKgNHa: number }[]): number {
  const last = [...measurements].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn)).at(-1);
  return last ? Math.round(planDose - reservedKgNHa + last.advisedKgNHa) : planDose;
}
