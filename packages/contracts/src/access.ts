import { z } from "zod";

/**
 * Droits d'accès par module (claudedocs/conception_api_mcp.md §3, lot AM1).
 * Un accès — membre restreint, clé d'API, application OAuth — porte pour
 * chaque module un niveau, et un périmètre d'activités.
 */

/** Les 11 modules ouverts aux accès restreints (besoins §1, Q7). */
export const accessModules = [
  "farm",
  "parcels",
  "activities",
  "interventions",
  "phyto",
  "fertilization",
  "stocks",
  "equipments",
  "people",
  "economics",
  "certifications",
] as const;
export const accessModule = z.enum(accessModules);
export type AccessModule = z.infer<typeof accessModule>;

/** `write` = lecture + propositions (B6) ; jamais d'écriture directe pour un accès restreint. */
export const accessLevel = z.enum(["none", "read", "write"]);
export type AccessLevel = z.infer<typeof accessLevel>;

/** Activités couvertes : toutes (y compris celles créées plus tard) ou une liste. */
export const accessActivities = z.union([z.literal("all"), z.array(z.uuid()).min(1).max(200)]);
export type AccessActivities = z.infer<typeof accessActivities>;

/** Droits d'un accès : un module absent vaut `none`. */
export const accessGrant = z.object({
  modules: z.partialRecord(accessModule, accessLevel),
  activities: accessActivities,
});
export type AccessGrant = z.infer<typeof accessGrant>;

export const ACCESS_MODULE_LABELS: Record<AccessModule, string> = {
  farm: "Ferme",
  parcels: "Parcellaire",
  activities: "Activités et assolement",
  interventions: "Interventions",
  phyto: "Phytosanitaire et registres",
  fertilization: "Fertilisation",
  stocks: "Stocks et semences",
  equipments: "Matériels",
  people: "Personnes et équipes",
  economics: "Économique",
  certifications: "Certifications",
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  none: "Aucun accès",
  read: "Lecture",
  write: "Lecture et propositions",
};
