import type { ControlFinding } from "@fourmy/contracts";
import { cite, HVE_GRID_SOURCE } from "@fourmy/certification-refs";
import { finding, missing } from "../report.js";

/**
 * Item déclaratif (questionnaire HVE annuel, lot CT4b) : avec une réponse,
 * ses points ; sans, « données manquantes » (jamais de point d'office).
 */
export function declaredItem(ruleId: string, label: string, max: number, answer: { points: number; detail: string } | null, at: string): ControlFinding {
  const source = `Plan de contrôle HVE niveau 3 V4.4 (2024), §${ruleId.slice(4)} ; ${cite({ ...HVE_GRID_SOURCE, at })} ; déclaré dans le questionnaire annuel`;
  if (!answer) {
    return finding({
      ruleId,
      level: "missing",
      message: `${label} : à déclarer dans le questionnaire HVE annuel.`,
      points: { got: 0, max },
      missing: [missing(label, "questionnaire")],
      source,
    });
  }
  const got = Math.round(Math.min(answer.points, max) * 100) / 100;
  return finding({
    ruleId,
    level: "ok",
    message: `${label} : ${answer.detail} : ${got.toLocaleString("fr-FR")} point(s) (déclaré, pièces à présenter à l'audit).`,
    points: { got, max },
    source,
  });
}

/** Une réponse est-elle donnée (ni absente ni nulle) ? */
export const given = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;
