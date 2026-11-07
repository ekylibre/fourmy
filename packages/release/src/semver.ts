import type { ParsedCommit } from "./conventional.js";

/**
 * Version sémantique calculée depuis l'historique : départ 0.1.0 ;
 * `feat` → mineure, `fix` → correctif ; une rupture → majeure à partir de
 * 1.0 (avant 1.0, une rupture passe à la mineure suivante, usage courant).
 */
export type Bump = "major" | "minor" | "patch" | null;

export function bumpOf(commit: ParsedCommit): Bump {
  if (commit.breaking && (commit.type === "feat" || commit.type === "fix")) return "major";
  if (commit.type === "feat") return "minor";
  if (commit.type === "fix") return "patch";
  return null;
}

export function applyBump(version: string, bump: Bump): string {
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  switch (bump) {
    case "major":
      return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return version;
  }
}

export const INITIAL_VERSION = "0.1.0";
