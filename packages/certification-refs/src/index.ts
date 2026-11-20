/**
 * @fourmy/certification-refs — référentiels des contrôles HVE et
 * Agriculture biologique (claudedocs/conception_controle_hve_ab.md §3), et
 * de la conditionnalité PAC pour l'assolement
 * (claudedocs/conception_assolement.md §4.2) : recopiés des textes table par table, chacun avec sa source ; aucune donnée
 * n'est modifiée par le code. Une mise à jour ajoute un fichier daté et
 * incrémente REFS_VERSION.
 */
export * from "./source.js";
export * from "./ab/conversion.js";
export * from "./ab/inao-catalogue.js";
export * from "./ab/copper.js";
export * from "./ab/copper-ephy.js";
export * from "./ab/annex-ii.js";
export * from "./hve/grid.js";
export * from "./hve/cmr/index.js";
export * from "./hve/ift-references.js";
export * from "./hve/regions.js";
export * from "./hve/lookup.js";
export * from "./hve/nitrogen-exports-2026.js";
export * from "./hve/iae.js";
export * from "./pac/bcae7-2026.js";

/** Version des référentiels, gardée avec chaque calcul de contrôle. */
export const REFS_VERSION = "2026-11-20.10";
