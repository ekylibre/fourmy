/**
 * @fourmy/certification-refs — référentiels des contrôles HVE et
 * Agriculture biologique (claudedocs/conception_controle_hve_ab.md §3) :
 * recopiés des textes table par table, chacun avec sa source ; aucune donnée
 * n'est modifiée par le code. Une mise à jour ajoute un fichier daté et
 * incrémente REFS_VERSION.
 */
export * from "./source.js";
export * from "./ab/conversion.js";
export * from "./ab/inao-catalogue.js";

/** Version des référentiels, gardée avec chaque calcul de contrôle. */
export const REFS_VERSION = "2026-11-19.1";
