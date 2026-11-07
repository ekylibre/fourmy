import type { ValidRange } from "@fourmy/contracts";

/**
 * Versionnement d'un état (architecture §4.4).
 * On ne modifie jamais une version en place : on clôt la version courante à
 * l'instant `t` et on en ouvre une nouvelle. Fonctions pures qui décrivent le
 * changement ; la transaction est exécutée par la couche service.
 */

export class DomainError extends Error {}

/** Une version ouverte a une borne haute nulle. */
export function isOpen(v: { valid: ValidRange }): boolean {
  return v.valid.upper === null;
}

export interface VersionChange {
  /** Version à clore : sa borne haute passe à `at`. */
  close: { lower: string; upper: string } | null;
  /** Nouvelle version ouverte à partir de `at`. */
  openFrom: string;
}

/**
 * Calcule la clôture/ouverture pour versionner un état à l'instant `at`.
 * @param current version courante ouverte (ou null si première version)
 * @throws si `at` n'est pas strictement postérieur au début de la version courante
 */
export function planVersionChange(
  current: { valid: ValidRange } | null,
  at: string,
): VersionChange {
  if (current) {
    if (!isOpen(current)) {
      throw new DomainError("La version courante est déjà close.");
    }
    if (at <= current.valid.lower) {
      throw new DomainError(
        `La date de version (${at}) doit être postérieure au début de la version courante (${current.valid.lower}).`,
      );
    }
    return { close: { lower: current.valid.lower, upper: at }, openFrom: at };
  }
  return { close: null, openFrom: at };
}

/** Prédicat « valide à la date » pour une version (requête dans le temps). */
export function validAt(v: { valid: ValidRange }, at: string): boolean {
  const afterStart = v.valid.lower <= at;
  const beforeEnd = v.valid.upper === null || at < v.valid.upper;
  return afterStart && beforeEnd;
}
