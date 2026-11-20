import type { ControlFinding, ControlLevel, ControlMissing, ControlSection } from "@fourmy/contracts";

/**
 * Agrégation des constats de contrôle HVE et AB
 * (claudedocs/conception_controle_hve_ab.md §1, §5.1) : fonctions pures.
 *
 * Gravité, de la pire à la meilleure : danger > missing > warning > ok > na.
 * Une donnée manquante passe avant « à vérifier » : elle empêche de conclure
 * (NFR-3, pas de faux vert) ; « sans objet » ne compte jamais.
 */
const RANK: Record<ControlLevel, number> = { danger: 4, missing: 3, warning: 2, ok: 1, na: 0 };

export function worstControlLevel(levels: ControlLevel[]): ControlLevel {
  return levels.reduce<ControlLevel>((worst, l) => (RANK[l] > RANK[worst] ? l : worst), "na");
}

/**
 * Constat sans faux vert : une règle qui déclare des données manquantes ne
 * peut pas être conforme (elle passe en `missing`) ; un constat non
 * conforme le reste.
 */
export function finding(input: Omit<ControlFinding, "refs"> & { refs?: ControlFinding["refs"] }): ControlFinding {
  const f: ControlFinding = { ...input, refs: input.refs ?? {} };
  const missing = f.missing?.filter(Boolean) ?? [];
  if (missing.length && (f.level === "ok" || f.level === "na")) return { ...f, level: "missing", missing };
  return missing.length ? { ...f, missing } : { ...f, missing: undefined };
}

export function missing(what: string, where: ControlMissing["where"], id?: string): ControlMissing {
  return id ? { what, where, id } : { what, where };
}

/**
 * Section : indicateur HVE (avec points) ou groupe de règles AB.
 * - Sans points : le pire constat.
 * - Avec points (HVE) : un constat non conforme (CMR1…) l'emporte ; sous le
 *   minimum, « données manquantes » s'il en manque (le score n'est qu'un
 *   minimum), sinon non conforme ; au minimum ou au-dessus, conforme, ou « à
 *   vérifier » si un constat le demande (des données manquantes ne pourraient
 *   qu'ajouter des points).
 */
export function section(
  id: string,
  label: string,
  findings: ControlFinding[],
  /** Seuil de l'indicateur ; maximum : somme des maxima des items s'il n'est pas donné. */
  points?: { min: number; max?: number },
): ControlSection {
  if (!points) return { id, label, level: worstControlLevel(findings.map((f) => f.level)), findings };
  // Indicateur sans objet (exploitation non irrigante) : validé d'office, sans points.
  if (findings.every((f) => f.level === "na")) return { id, label, level: "na", findings };
  const got = Math.round(findings.reduce((sum, f) => sum + (f.points?.got ?? 0), 0) * 100) / 100;
  const levels = findings.map((f) => f.level);
  let level: ControlLevel;
  if (levels.includes("danger")) level = "danger";
  else if (got < points.min) level = levels.includes("missing") ? "missing" : "danger";
  else level = levels.some((l) => l === "warning" || l === "missing") ? "warning" : "ok";
  const max = points.max ?? Math.round(findings.reduce((sum, f) => sum + (f.points?.max ?? 0), 0) * 100) / 100;
  return { id, label, level, points: { got, max, min: points.min }, findings };
}

/** Verdict d'un rapport : la pire section ; sans section, « sans objet ». */
export function verdictOf(sections: ControlSection[]): ControlLevel {
  return worstControlLevel(sections.map((s) => s.level));
}
