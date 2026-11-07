/**
 * Contexte d'exécution injecté dans les fonctions de domaine.
 * Isoler l'horloge et la génération d'identifiants garde le domaine **pur**
 * et déterministe en test (architecture §3 : `domain` sans base ni réseau).
 */
export interface DomainCtx {
  /** Instant courant, ISO-8601. */
  now: string;
  /** Génère un identifiant (UUID v7 en production). */
  newId: () => string;
  /** Acteur à l'origine du changement (pour l'audit). */
  actor: string;
  /** Provenance (web, mobile, migration, plugin). */
  origin: "web" | "mobile" | "migration" | "plugin";
}
