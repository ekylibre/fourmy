/**
 * @fourmy/contracts — le « gel » du jour 1 (Apache-2.0).
 * Schémas Zod, types, événements et contrats partagés par l'API, le web,
 * le mobile, les connecteurs et le migrateur. Règle de dépendance :
 * contracts ← domain ← db ← apps/*.
 */
export * from "./primitives.js";
export * from "./entities/core.js";
export * from "./entities/parcellaire.js";
export * from "./entities/batiments.js";
export * from "./entities/stocks.js";
export * from "./entities/interventions.js";
export * from "./events.js";
export * from "./sync.js";
export * from "./api.js";
