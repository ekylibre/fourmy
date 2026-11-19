/**
 * @fourmy/importers — imports de fichiers agricoles (EDI DAPLOS, export JSON
 * de Geofolia, dossier PAC XML de TelePAC) vers un modèle commun, sans accès
 * à la base ni au réseau (claudedocs/conception_import_onboarding.md §4).
 * Le rapprochement avec la ferme et l'écriture se font dans l'API.
 */
export * from "./model.js";
export * from "./errors.js";
export * from "./detect.js";
export * from "./aee.js";
export * from "./geo.js";
export * from "./readers.js";
export * from "./preview.js";
export * from "./geofolia.js";
export * from "./interventions.js";
export * from "./covers.js";

import { registerReader } from "./readers.js";
import { readGeofolia } from "./geofolia.js";

// Lecteurs disponibles (lots IM2 à IM4).
registerReader("geofolia", readGeofolia);
