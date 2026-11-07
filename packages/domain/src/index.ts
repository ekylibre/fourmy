/**
 * @fourmy/domain — logique métier pure (temps, stocks, interventions).
 * Aucune dépendance à la base ni au réseau (règle de frontière, archi §3) :
 * les fonctions décrivent des changements, la couche service les exécute.
 */
export * from "./ctx.js";
export * from "./time.js";
export * from "./stock.js";
export * from "./events.js";
export * from "./interventions.js";
